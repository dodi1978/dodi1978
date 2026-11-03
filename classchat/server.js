import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
// Online, set a teacher code so only you can start sessions. Empty = anyone can (fine on your own computer).
const TEACHER_CODE = process.env.CLASSCHAT_TEACHER_CODE || "";
const MAX_BODY = 16 * 1024;
const MAX_TEXT = 500;
const MAX_NAME = 30;
const MAX_MESSAGES = 2000;
const MAX_ROOMS = 200;
const IDLE_MS = 12 * 60 * 60 * 1000; // a session disappears after 12 hours without activity
const BURST = { count: 5, windowMs: 10_000 }; // at most 5 messages per person per 10 seconds

// Sessions live in memory only: nothing is written to disk, and everything vanishes on restart.
const rooms = new Map();

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" };
// No 0/O, 1/I/L: codes are read off a projector.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw fail(413, "Request too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw fail(400, "Invalid JSON");
  }
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function newCode() {
  for (;;) {
    let code = "";
    for (let i = 0; i < 5; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

const token = () => randomBytes(18).toString("base64url");

// What one viewer sees of a message. In anonymous mode students see classmates as "Classmate";
// the teacher still sees names so they can deal with unkind messages.
function viewMessage(m, room, viewer) {
  const hide = room.anonymous && viewer?.role === "student" && m.role === "student" && m.authorId !== viewer.id;
  return {
    id: m.id,
    authorId: hide ? "anon" : m.authorId,
    name: hide ? "Classmate" : m.name,
    role: m.role,
    text: m.text,
    at: m.at,
    likes: m.likes.size,
    likedByMe: viewer ? m.likes.has(viewer.id) : false,
    pinned: m.pinned,
    replyTo: m.replyTo,
  };
}

function snapshot(room, who) {
  return { me: { id: who.id, name: who.name, role: who.role }, state: roomState(room), messages: room.messages.map((m) => viewMessage(m, room, who)) };
}

function roomState(room) {
  return { title: room.title, paused: room.paused, anonymous: room.anonymous, online: onlineCount(room) };
}

function onlineCount(room) {
  const ids = new Set();
  for (const c of room.clients) if (c.role === "student") ids.add(c.who.id);
  return ids.size;
}

function sendEvent(client, event, data) {
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room, event, data) {
  for (const c of room.clients) sendEvent(c, event, data);
}

function broadcastMessage(room, event, m) {
  for (const c of room.clients) sendEvent(c, event, viewMessage(m, room, c.who));
}

function touch(room) {
  room.lastActive = Date.now();
}

function getRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw fail(404, "No class session with that code. Check the code with your teacher.");
  return room;
}

// Who is making this request? Teachers send their teacher key, students their join token.
function identify(req, room, url) {
  const key = req.headers["x-teacher-key"] || url.searchParams.get("key");
  if (key && sameSecret(key, room.teacherKey)) return { id: "teacher", name: room.teacherName, role: "teacher" };
  const t = req.headers["x-token"] || url.searchParams.get("token");
  const p = t && room.participants.get(t);
  if (p) return { ...p, role: "student" };
  throw fail(401, "Please join the session again.");
}

function requireTeacher(who) {
  if (who.role !== "teacher") throw fail(403, "Only the teacher can do that.");
}

function rateLimited(room, who) {
  const now = Date.now();
  const recent = (room.recent.get(who.id) || []).filter((t) => now - t < BURST.windowMs);
  if (recent.length >= BURST.count) return true;
  recent.push(now);
  room.recent.set(who.id, recent);
  return false;
}

function findMessage(room, id) {
  const m = room.messages.find((x) => x.id === Number(id));
  if (!m) throw fail(404, "That message no longer exists.");
  return m;
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "rooms", CODE, ...]
  const method = req.method;

  if (parts[1] === "config" && method === "GET") {
    return send(res, 200, { teacherCodeRequired: Boolean(TEACHER_CODE) });
  }

  if (parts[1] !== "rooms") throw fail(404, "Not found");

  // Start a new class session.
  if (parts.length === 2 && method === "POST") {
    const body = await readJson(req);
    if (TEACHER_CODE && !sameSecret(body.teacherCode || "", TEACHER_CODE)) throw fail(403, "That teacher code is not right.");
    if (rooms.size >= MAX_ROOMS) throw fail(503, "Too many sessions are open. Try again later.");
    const code = newCode();
    const room = {
      code,
      title: cleanText(body.title, 80) || "Class chat",
      teacherName: cleanText(body.teacherName, MAX_NAME) || "Teacher",
      teacherKey: token(),
      paused: false,
      anonymous: false,
      messages: [],
      nextId: 1,
      participants: new Map(),
      recent: new Map(),
      clients: new Set(),
      createdAt: Date.now(),
      lastActive: Date.now(),
    };
    rooms.set(code, room);
    return send(res, 201, { code, teacherKey: room.teacherKey, title: room.title });
  }

  const room = getRoom(parts[2]);
  const action = parts[3];

  // Anyone can check a code exists before typing their name.
  if (!action && method === "GET") return send(res, 200, { code: room.code, title: room.title });

  if (action === "join" && method === "POST") {
    const body = await readJson(req);
    const name = cleanText(body.name, MAX_NAME);
    if (!name) throw fail(400, "Please type a name.");
    if (room.participants.size >= 500) throw fail(503, "This session is full.");
    const t = token();
    const who = { id: "s" + randomBytes(6).toString("hex"), name };
    room.participants.set(t, who);
    touch(room);
    return send(res, 200, { token: t, id: who.id, name });
  }

  const who = identify(req, room, url);

  if (action === "stream" && method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const client = { res, role: who.role, who };
    room.clients.add(client);
    sendEvent(client, "snapshot", snapshot(room, who));
    broadcast(room, "state", roomState(room));
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(beat);
      room.clients.delete(client);
      broadcast(room, "state", roomState(room));
    });
    return;
  }

  if (action === "messages" && parts.length === 4 && method === "POST") {
    const body = await readJson(req);
    const text = cleanText(body.text, MAX_TEXT);
    if (!text) throw fail(400, "Message is empty.");
    if (who.role === "student" && room.paused) throw fail(423, "The teacher has paused the chat.");
    if (who.role === "student" && rateLimited(room, who)) throw fail(429, "Slow down a little – wait a few seconds.");
    const replyTo = body.replyTo && room.messages.some((m) => m.id === Number(body.replyTo)) ? Number(body.replyTo) : null;
    const m = { id: room.nextId++, authorId: who.id, name: who.name, role: who.role, text, at: Date.now(), likes: new Set(), pinned: false, replyTo };
    room.messages.push(m);
    if (room.messages.length > MAX_MESSAGES) room.messages.splice(0, room.messages.length - MAX_MESSAGES);
    touch(room);
    broadcastMessage(room, "message", m);
    return send(res, 201, viewMessage(m, room, who));
  }

  if (action === "messages" && parts.length === 6) {
    const m = findMessage(room, parts[4]);
    const op = parts[5];
    if (op === "like" && method === "POST") {
      if (m.likes.has(who.id)) m.likes.delete(who.id);
      else m.likes.add(who.id);
    } else if (op === "pin" && method === "POST") {
      requireTeacher(who);
      m.pinned = !m.pinned;
    } else if (op === "delete" && method === "POST") {
      if (who.role !== "teacher" && m.authorId !== who.id) throw fail(403, "You can only delete your own messages.");
      room.messages.splice(room.messages.indexOf(m), 1);
      touch(room);
      broadcast(room, "delete", { id: m.id });
      return send(res, 200, { ok: true });
    } else {
      throw fail(404, "Not found");
    }
    touch(room);
    broadcastMessage(room, "update", m);
    return send(res, 200, viewMessage(m, room, who));
  }

  if (action === "settings" && method === "POST") {
    requireTeacher(who);
    const body = await readJson(req);
    if (typeof body.paused === "boolean") room.paused = body.paused;
    const wasAnonymous = room.anonymous;
    if (typeof body.anonymous === "boolean") room.anonymous = body.anonymous;
    if (typeof body.title === "string" && cleanText(body.title, 80)) room.title = cleanText(body.title, 80);
    touch(room);
    // Names change for everyone, so give each viewer a fresh copy of the chat.
    if (wasAnonymous !== room.anonymous) for (const c of room.clients) sendEvent(c, "snapshot", snapshot(room, c.who));
    else broadcast(room, "state", roomState(room));
    return send(res, 200, roomState(room));
  }

  if (action === "clear" && method === "POST") {
    requireTeacher(who);
    room.messages = [];
    touch(room);
    broadcast(room, "cleared", {});
    return send(res, 200, { ok: true });
  }

  if (action === "end" && method === "POST") {
    requireTeacher(who);
    closeRoom(room);
    return send(res, 200, { ok: true });
  }

  throw fail(404, "Not found");
}

function closeRoom(room) {
  broadcast(room, "ended", {});
  for (const c of room.clients) c.res.end();
  rooms.delete(room.code);
}

async function serveStatic(res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/teacher") pathname = "/teacher.html";
  // Short join links: /j/ABCDE opens the student page for that session.
  if (/^\/j\/[A-Za-z0-9]{5}$/.test(pathname)) pathname = "/room.html";
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, { error: "Not found" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  try {
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") throw fail(405, "Method not allowed");
    return await serveStatic(res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Something went wrong." : err.message });
  }
});

// Tidy up sessions nobody has used for a while.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) if (now - room.lastActive > IDLE_MS) closeRoom(room);
}, 10 * 60 * 1000);
sweeper.unref();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`ClassChat running on http://localhost:${PORT}`);
    if (!TEACHER_CODE) console.log("No CLASSCHAT_TEACHER_CODE set: anyone can start a session. Set one before putting this online.");
  });
}
