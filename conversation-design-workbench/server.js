// Plain Node server: for running the app on your own computer, or on Render
// (or any host that runs `npm start`). Netlify does not use this file.
//
// Without DATABASE_URL it stores data in a local folder (./.data) using PGlite,
// which needs the development dependencies (`npm install`).

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./src/runtime.js";
import { databaseUrl, fromPglite, migrate } from "./src/db.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 6 * 1024 * 1024;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };

async function localDatabase() {
  if (databaseUrl()) return undefined;
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR || path.join(here, ".data");
  console.log(`No DATABASE_URL set: storing data in ${dir}`);
  return migrate(fromPglite(new PGlite(dir)));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // The public chat page for real users lives at /c/<link code>.
  const page = pathname === "/" ? "index.html" : pathname.startsWith("/c/") ? "chat.html" : pathname;
  const file = path.normalize(path.join(PUBLIC, page));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "x-content-type-options": "nosniff" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}

const app = await buildApp(process.env, { db: await localDatabase() });

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/api/")) return serveStatic(req, res);
  try {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
    const proto = req.headers["x-forwarded-proto"] || "http";
    const request = new Request(`${proto}://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body });
    const response = await app.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(err.status || 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err.status === 413 ? "That upload is too large." : "Server error." }));
  }
});

server.listen(PORT, () => console.log(`Conversation Design Workbench on http://localhost:${PORT}`));
