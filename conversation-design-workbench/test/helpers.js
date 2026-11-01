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

export function fakeClaude(reply = (req) => `You asked: ${req.messages.at(-1).content.split("\n\n").at(-1)}`) {
  const calls = [];
  return {
    available: true,
    calls,
    async complete(req) {
      calls.push(req);
      return { text: reply(req), model: req.model, usage: { input_tokens: 100, output_tokens: 20 }, stopReason: "end_turn", refused: false };
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
