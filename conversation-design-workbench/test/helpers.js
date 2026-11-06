import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../src/app.js";
import { fromPglite, connectPostgres, migrate, EMBEDDING_DIMENSIONS } from "../src/db.js";

export const PASSPHRASE = "test-passphrase";

// A stand-in for Voyage AI: hashes words into a vector, so texts sharing words are "close".
export function fakeEmbedder({ available = true, fail = false } = {}) {
  const calls = [];
  return {
    available,
    model: "voyage-4",
    calls,
    async embed(texts, inputType) {
      calls.push({ texts, inputType });
      if (fail) throw new Error("Voyage AI is down.");
      const vectors = texts.map((t) => {
        const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
        for (const word of t.toLowerCase().match(/[a-z]{3,}/g) || []) {
          let h = 0;
          for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % EMBEDDING_DIMENSIONS;
          v[h] += 1;
        }
        v[0] += 0.01;
        return v;
      });
      return { vectors, tokens: texts.join(" ").split(/\s+/).length };
    },
  };
}

// A stand-in for the simulated user and generators: answers structured-output requests.
export function defaultJson(req) {
  const props = req.schema.properties;
  const prompt = req.messages.at(-1).content;
  if (props.action) {
    const turn = Number(/message number (\d+)/.exec(prompt)?.[1] ?? 1);
    const mayEnd = /you may end/.test(prompt);
    return { goal: "Find out about late fees", action: mayEnd ? "end" : "send", message: mayEnd ? "Thanks, that helps." : `Question ${turn} about late fees?`, end_reason: mayEnd ? "goal_met" : "none" };
  }
  if (props.score) return { score: 4, comment: "Quick and clear." };
  if (props.questions) {
    const count = Number(/Write (\d+) different/.exec(prompt)?.[1] ?? 3);
    return { questions: Array.from({ length: count }, (_, i) => ({ text: `How much are late fees, version ${i + 1}?`, in_scope: i % 2 === 0 })) };
  }
  if (props.personas) {
    const count = Number(/Create (\d+) distinct/.exec(prompt)?.[1] ?? 2);
    return { personas: Array.from({ length: count }, (_, i) => ({ name: `Generated ${i + 1}`, description: "A student.", goal: "", communication_style: "Casual.", language_background: "English.", give_up_pct: 10, ask_human_pct: 5, misunderstand_pct: 0, adversarial: false })) };
  }
  throw new Error("Unexpected schema");
}

export function fakeClaude(reply = (req) => `You asked: ${req.messages.at(-1).content.split("\n\n").at(-1)}`, json = defaultJson) {
  const calls = [];
  return {
    available: true,
    calls,
    async complete(req) {
      calls.push(req);
      const usage = { input_tokens: 100, output_tokens: 20 };
      if (req.schema) {
        const data = json(req);
        return { json: data, text: JSON.stringify(data), model: req.model ?? "claude-opus-5-5", usage, stopReason: "end_turn", refused: false };
      }
      return { text: reply(req), model: req.model, usage, stopReason: "end_turn", refused: false };
    },
  };
}

export async function makeDb() {
  if (process.env.TEST_DATABASE_URL) {
    const db = await migrate(connectPostgres(process.env.TEST_DATABASE_URL));
    for (const table of ["usage_log", "messages", "conversations", "bot_versions", "chunks", "documents", "projects"]) await db.query(`DELETE FROM ${table}`);
    return db;
  }
  return migrate(fromPglite(new PGlite()));
}

export async function makeApp(overrides = {}) {
  const db = overrides.db ?? (await makeDb());
  const claude = overrides.claude ?? fakeClaude();
  const embedder = overrides.embedder ?? fakeEmbedder();
  const app = createApp({ db, claude, embedder, passphrase: PASSPHRASE, secureCookies: false, fetchImpl: overrides.fetchImpl });
  let cookie = "";
  async function call(method, path, body, { auth = true } = {}) {
    const headers = { "content-type": "application/json" };
    if (auth && cookie) headers.cookie = cookie;
    const response = await app.handle(new Request(`http://test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
  }
  async function login() {
    const res = await call("POST", "/api/login", { passphrase: PASSPHRASE }, { auth: false });
    cookie = res.headers.get("set-cookie").split(";")[0];
    return res;
  }
  return { app, db, claude, embedder, call, login };
}
