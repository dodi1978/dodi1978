import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiTurn, aiReport, aiConfigured } from "./src/ai.js";
import { demoTurn, demoReport, detectRisk } from "./src/demo.js";
import { SERVICES } from "./src/knowledge/services.js";
import { CONCEPTS } from "./src/knowledge/concepts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const STAFF_PIN = process.env.TACSI_STAFF_PIN || "1234";
const MAX_BODY = 256 * 1024;

// Prototype only: cases live in memory and vanish on restart. Do not use real personal data.
const cases = new Map();

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function validHistory(history) {
  return Array.isArray(history) && history.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string");
}

const rank = { none: 0, concern: 1, immediate: 2 };

function useAI(body) {
  return aiConfigured() && body.engine !== "demo";
}

async function handleTurn(body) {
  if (!validHistory(body.history)) throw Object.assign(new Error("Bad history"), { status: 400 });
  const session = body.session ?? {};
  // The demo engine always runs: it keeps keyword state and acts as a safety net.
  const demo = demoTurn({ history: body.history, session, demoState: body.demoState });
  if (!useAI(body)) return { engine: "demo", result: demo.result, demoState: demo.state };
  try {
    const result = await aiTurn({ history: body.history, session });
    // Never let the AI downgrade a risk that plain keyword matching found.
    const lastUser = [...body.history].reverse().find((m) => m.role === "user")?.text ?? "";
    const keywordRisk = detectRisk(lastUser);
    if (keywordRisk.level === "immediate" && rank[result.risk.level] < rank.immediate) {
      result.risk = keywordRisk;
    }
    return { engine: "ai", result, demoState: demo.state };
  } catch (err) {
    console.error("AI turn failed, using demo engine:", err.message);
    return { engine: "demo-fallback", result: demo.result, demoState: demo.state };
  }
}

async function handleReport(body) {
  if (!validHistory(body.history)) throw Object.assign(new Error("Bad history"), { status: 400 });
  const session = body.session ?? {};
  if (!useAI(body)) return { engine: "demo", report: demoReport(body) };
  try {
    return { engine: "ai", report: await aiReport({ history: body.history, session }) };
  } catch (err) {
    console.error("AI report failed, using demo engine:", err.message);
    return { engine: "demo-fallback", report: demoReport(body) };
  }
}

function newReference() {
  let ref;
  do ref = `TAC-${randomInt(1000, 10000)}`;
  while (cases.has(ref));
  return ref;
}

function staffAllowed(req) {
  return req.headers["x-staff-pin"] === STAFF_PIN;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  if (p === "/staff") p = "/staff.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, mode: aiConfigured() ? "ai" : "demo" });
    }
    if (req.method === "GET" && url.pathname === "/api/knowledge") {
      return send(res, 200, { services: SERVICES, concepts: CONCEPTS });
    }
    if (req.method === "POST" && url.pathname === "/api/turn") {
      return send(res, 200, await handleTurn(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/report") {
      return send(res, 200, await handleReport(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/cases") {
      const body = await readJson(req);
      if (!body.consent) return send(res, 400, { error: "Consent is needed to share a case" });
      if (!body.report?.staff) return send(res, 400, { error: "Missing report" });
      const reference = newReference();
      cases.set(reference, {
        reference,
        createdAt: new Date().toISOString(),
        session: body.session ?? {},
        engine: body.engine ?? "unknown",
        report: body.report,
        transcript: validHistory(body.history) ? body.history : [],
        status: "new",
      });
      return send(res, 201, { reference });
    }
    if (url.pathname.startsWith("/api/cases")) {
      if (!staffAllowed(req)) return send(res, 401, { error: "Staff PIN needed" });
      const ref = url.pathname.split("/")[3];
      if (req.method === "GET" && !ref) {
        const list = [...cases.values()].reverse().map((c) => ({
          reference: c.reference,
          createdAt: c.createdAt,
          status: c.status,
          language: c.session.languageName,
          place: c.session.place,
          headline: c.report.staff.headline,
          priority: c.report.staff.priority,
        }));
        return send(res, 200, { cases: list });
      }
      const found = cases.get(ref);
      if (!found) return send(res, 404, { error: "No case with that reference" });
      if (req.method === "GET") return send(res, 200, found);
      if (req.method === "PATCH") {
        const body = await readJson(req);
        if (["new", "in-progress", "closed"].includes(body.status)) found.status = body.status;
        return send(res, 200, found);
      }
    }
    if (req.method === "GET") return serveStatic(req, res);
    send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    send(res, err.status ?? 500, { error: err.status ? err.message : "Something went wrong" });
    if (!err.status) console.error(err);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`TACSI running on http://localhost:${PORT}  (engine: ${aiConfigured() ? "Claude AI" : "offline demo"})`);
    console.log(`Staff view: http://localhost:${PORT}/staff  (PIN: ${STAFF_PIN === "1234" ? "1234 - set TACSI_STAFF_PIN to change" : "set by TACSI_STAFF_PIN"})`);
  });
}
