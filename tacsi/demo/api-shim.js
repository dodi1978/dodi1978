// Static demo build: answers the app's /api calls in the browser with the
// offline demo engine, so TACSI can be shared as a single link with no server.
// Shared cases are kept in this browser's localStorage only.

import { demoTurn, demoReport } from "../src/demo.js";
import { SERVICES } from "../src/knowledge/services.js";
import { CONCEPTS } from "../src/knowledge/concepts.js";

window.TACSI_STATIC = true;

const KEY = "tacsi-demo-cases";
const PIN = "1234";
let memory = [];

function loadCases() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return memory;
  }
}
function saveCases(cases) {
  memory = cases;
  try {
    localStorage.setItem(KEY, JSON.stringify(cases));
  } catch {}
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function handle(method, path, body, pin) {
  if (method === "GET" && path === "/api/health") return json(200, { ok: true, mode: "demo" });
  if (method === "GET" && path === "/api/knowledge") return json(200, { services: SERVICES, concepts: CONCEPTS });
  if (method === "POST" && path === "/api/turn") {
    const { result, state } = demoTurn(body);
    return json(200, { engine: "demo", result, demoState: state });
  }
  if (method === "POST" && path === "/api/report") return json(200, { engine: "demo", report: demoReport(body) });
  if (method === "POST" && path === "/api/cases") {
    if (!body.consent) return json(400, { error: "Consent is needed to share a case" });
    const cases = loadCases();
    let reference;
    do reference = `TAC-${1000 + Math.floor(Math.random() * 9000)}`;
    while (cases.some((c) => c.reference === reference));
    cases.push({ reference, createdAt: new Date().toISOString(), session: body.session ?? {}, engine: "demo", report: body.report, transcript: body.history ?? [], status: "new" });
    saveCases(cases);
    return json(201, { reference });
  }
  if (path.startsWith("/api/cases")) {
    if (pin !== PIN) return json(401, { error: "Staff PIN needed" });
    const cases = loadCases();
    const ref = path.split("/")[3];
    if (!ref) {
      return json(200, {
        cases: [...cases].reverse().map((c) => ({ reference: c.reference, createdAt: c.createdAt, status: c.status, language: c.session.languageName, place: c.session.place, headline: c.report.staff.headline, priority: c.report.staff.priority })),
      });
    }
    const found = cases.find((c) => c.reference === ref);
    if (!found) return json(404, { error: "No case with that reference" });
    if (method === "PATCH" && ["new", "in-progress", "closed"].includes(body.status)) {
      found.status = body.status;
      saveCases(cases);
    }
    return json(200, found);
  }
  return json(404, { error: "Not found" });
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  const path = url.pathname.slice(url.pathname.indexOf("/api/"));
  if (!url.pathname.includes("/api/")) return realFetch(input, init);
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  const headers = new Headers(init.headers);
  return handle(method, path.split("?")[0], body, headers.get("x-staff-pin"));
};
