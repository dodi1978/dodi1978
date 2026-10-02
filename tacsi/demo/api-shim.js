// Shareable link build: answers the app's /api calls inside the browser, so
// TACSI runs as a single claude.ai page with no server of its own.
//
// - Conversation and report: Claude through the viewer's own claude.ai
//   account (the page's `sample` capability). If that is unavailable or
//   fails, the offline demo engine answers instead.
// - Shared cases: the page's `db` capability, so anyone the link is shared
//   with can see them in the staff view. Falls back to this browser only.

import { z } from "zod";
import { demoTurn, demoReport, detectRisk } from "../src/demo.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";
import { TurnSchema, ReportSchema } from "../src/schemas.js";
import { toMessages, reportRequest, coerceTurn, coerceReport } from "../src/conversation.js";
import { SERVICES } from "../src/knowledge/services.js";
import { CONCEPTS } from "../src/knowledge/concepts.js";

window.TACSI_STATIC = true;

const PIN = "1234";
const LOCAL_KEY = "tacsi-demo-cases";
const use = (name) => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
const samplePromise = use("sample");
const dbPromise = use("db");

// Codes after which Claude will not work for the rest of this visit.
const PERMANENT = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);
let aiOff = false;

const formatNote = (schema) =>
  `Reply with only one JSON object, no other text, matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;

async function askClaude(turns, coerce, modelTier) {
  const sample = aiOff ? null : await samplePromise;
  if (!sample) throw new Error("Claude is not available here");
  try {
    return coerce(await sample.json(turns, { cache: false, modelTier }));
  } catch (e) {
    if (PERMANENT.has(e?.code)) aiOff = true;
    throw e;
  }
}

async function turn(body) {
  const session = body.session ?? {};
  const demo = demoTurn({ history: body.history, session, demoState: body.demoState });
  try {
    const messages = toMessages(body.history, session);
    const instructions = `${SYSTEM_PROMPT}\n\n${formatNote(TurnSchema)}`;
    // "quick" keeps the conversation responsive; the report uses the default tier.
    const result = await askClaude([{ role: "user", content: instructions }, ...messages], coerceTurn, "quick");
    const lastUser = [...body.history].reverse().find((m) => m.role === "user")?.text ?? "";
    const keywordRisk = detectRisk(lastUser);
    if (keywordRisk.level === "immediate" && result.risk.level !== "immediate") result.risk = keywordRisk;
    return { engine: "ai", result, demoState: demo.state };
  } catch (e) {
    console.warn("Claude turn failed, using demo engine:", e?.code ?? e?.message);
    return { engine: "demo-fallback", result: demo.result, demoState: demo.state };
  }
}

async function report(body) {
  try {
    const content = `${SYSTEM_PROMPT}\n\n${reportRequest({ history: body.history, session: body.session ?? {} })}\n\n${formatNote(ReportSchema)}`;
    return { engine: "ai", report: await askClaude([{ role: "user", content }], coerceReport, "default") };
  } catch (e) {
    console.warn("Claude report failed, using demo engine:", e?.code ?? e?.message);
    return { engine: "demo-fallback", report: demoReport(body) };
  }
}

// ---------- Case store: shared db, else this browser ----------

const local = {
  memory: [],
  all() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    } catch {
      return this.memory;
    }
  },
  save(cases) {
    this.memory = cases;
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(cases));
    } catch {}
  },
};

// Viewers below Contributor can read shared cases but not write them.
let canWriteShared = true;
const shared = () => dbPromise;

async function listCases() {
  const db = await shared();
  if (db) {
    try {
      const snap = await db.collection("cases").orderBy("createdAt", "desc").limit(100).get();
      return [...snap.docs.map((d) => d.data()), ...local.all().reverse()];
    } catch {}
  }
  return local.all().reverse();
}

async function getCase(ref) {
  const db = await shared();
  if (db) {
    try {
      const doc = await db.doc(`cases/${ref}`).get();
      if (doc.exists) return { ...doc.data() };
    } catch {}
  }
  return local.all().find((c) => c.reference === ref);
}

async function saveCase(c) {
  const db = await shared();
  if (db && canWriteShared && c.store !== "local") {
    try {
      await db.doc(`cases/${c.reference}`).set(c);
      return;
    } catch (e) {
      // Viewers without write access (or no store): keep it in this browser.
      if (e?.code !== "unavailable") canWriteShared = false;
    }
  }
  const cases = local.all().filter((x) => x.reference !== c.reference);
  local.save([...cases, { ...c, store: "local" }]);
}

// ---------- Fake /api ----------

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function handle(method, path, body, pin) {
  if (method === "GET" && path === "/api/health") return json(200, { ok: true, mode: (await samplePromise) ? "ai" : "demo" });
  if (method === "GET" && path === "/api/knowledge") return json(200, { services: SERVICES, concepts: CONCEPTS });
  if (method === "POST" && path === "/api/turn") return json(200, await turn(body));
  if (method === "POST" && path === "/api/report") return json(200, await report(body));
  if (method === "POST" && path === "/api/cases") {
    if (!body.consent) return json(400, { error: "Consent is needed to share a case" });
    const reference = `TAC-${1000 + Math.floor(Math.random() * 9000)}`;
    await saveCase(
      { reference, createdAt: new Date().toISOString(), session: body.session ?? {}, engine: body.engine ?? "unknown", report: body.report, transcript: body.history ?? [], status: "new" },
    );
    return json(201, { reference });
  }
  if (path.startsWith("/api/cases")) {
    if (pin !== PIN) return json(401, { error: "Staff PIN needed" });
    const ref = path.split("/")[3];
    if (!ref) {
      const cases = await listCases();
      return json(200, {
        cases: cases.map((c) => ({ reference: c.reference, createdAt: c.createdAt, status: c.status, language: c.session?.languageName, place: c.session?.place, headline: c.report.staff.headline, priority: c.report.staff.priority })),
      });
    }
    const found = await getCase(ref);
    if (!found) return json(404, { error: "No case with that reference" });
    if (method === "PATCH" && ["new", "in-progress", "closed"].includes(body.status)) {
      found.status = body.status;
      await saveCase(found);
    }
    return json(200, found);
  }
  return json(404, { error: "Not found" });
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  const at = url.pathname.indexOf("/api/");
  if (at === -1) return realFetch(input, init);
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  return handle(method, url.pathname.slice(at), body, new Headers(init.headers).get("x-staff-pin"));
};

// ---------- Citizen screen / staff view switch (#staff) ----------

function syncView() {
  const staff = location.hash.startsWith("#staff");
  document.getElementById("main").hidden = staff;
  document.getElementById("staff-root").hidden = !staff;
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", syncView);
syncView();
