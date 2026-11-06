// The whole API as one function: Request in, Response out (web-standard Fetch API).
// Netlify (netlify/functions/api.mjs) and the plain Node server (server.js) both
// wrap this, so moving between hosts does not touch the app itself.

import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { extractFromFile, extractFromUrl, chunkText, normalise, DocumentError } from "./documents.js";
import { toPgVector } from "./embeddings.js";
import { claudeCost, voyageCost, MODELS, EFFORTS, modelInfo } from "./pricing.js";
import { DEFAULT_BOT, sanitiseSettings, retrieve, buildSystemPrompt, buildMessages, groundingRules } from "./rag.js";
import { logUsage, projectUsage } from "./usage.js";
import { STARTER_PERSONAS, sanitisePersona } from "./personas.js";
import { planConversation, assignScenarios, mayEndFrom, personaTurn, rateConversation, generateQuestions, generatePersonas, identifyUserTypes, draftPersonaFromResearch } from "./simulate.js";
import { parseImport, personasFromRows, readTableFile } from "./importer.js";
import { GAAFFE, frameworkOf, sanitiseFramework } from "./framework.js";

const COOKIE = "cdw_session";
const EMBED_BATCH = 48;
const SESSION_DAYS = 30;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

async function readBody(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "The request was not valid JSON.");
  }
}

function sessionToken(passphrase) {
  return createHmac("sha256", passphrase).update("conversation-design-workbench/session/v1").digest("hex");
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function requireText(value, field, max = 500) {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, `${field} is required.`);
  return text.slice(0, max);
}

// Each route: [method, pattern, handler(ctx, params, body)]
function routes() {
  return [
    ["GET", "/api/session", sessionInfo],
    ["GET", "/api/projects", listProjects],
    ["POST", "/api/projects", createProject],
    ["GET", "/api/projects/:id", getProject],
    ["PATCH", "/api/projects/:id", updateProject],
    ["DELETE", "/api/projects/:id", deleteProject],
    ["POST", "/api/projects/:id/duplicate", duplicateProject],
    ["GET", "/api/projects/:id/documents", listDocuments],
    ["POST", "/api/projects/:id/documents", addDocument],
    ["POST", "/api/projects/:id/embed", embedPending],
    ["POST", "/api/projects/:id/search", searchProject],
    ["GET", "/api/documents/:id", getDocument],
    ["DELETE", "/api/documents/:id", deleteDocument],
    ["GET", "/api/projects/:id/bot", getBot],
    ["PUT", "/api/projects/:id/bot", saveBotDraft],
    ["POST", "/api/projects/:id/bot/versions", saveBotVersion],
    ["GET", "/api/projects/:id/conversations", listConversations],
    ["POST", "/api/projects/:id/conversations", createConversation],
    ["GET", "/api/conversations/:id", getConversation],
    ["PATCH", "/api/conversations/:id", updateConversation],
    ["DELETE", "/api/conversations/:id", deleteConversation],
    ["POST", "/api/conversations/:id/messages", sendMessage],
    ["GET", "/api/projects/:id/personas", listPersonas],
    ["POST", "/api/projects/:id/personas", createPersona],
    ["POST", "/api/projects/:id/personas/starter", addStarterPersonas],
    ["POST", "/api/projects/:id/personas/generate", generatePersonasRoute],
    ["PATCH", "/api/personas/:id", updatePersona],
    ["DELETE", "/api/personas/:id", deletePersona],
    ["POST", "/api/personas/:id/duplicate", duplicatePersona],
    ["GET", "/api/projects/:id/framework", getFramework],
    ["PUT", "/api/projects/:id/framework", saveFramework],
    ["POST", "/api/projects/:id/personas/import", importPersonas],
    ["POST", "/api/projects/:id/personas/research/types", researchTypes],
    ["POST", "/api/projects/:id/personas/research/draft", researchDraft],
    ["GET", "/api/projects/:id/runs", listRuns],
    ["POST", "/api/projects/:id/runs", createRun],
    ["DELETE", "/api/runs/:id", deleteRun],
    ["POST", "/api/conversations/:id/step", simulateStep],
    ["POST", "/api/projects/:id/questions/generate", generateQuestionsRoute],
    ["POST", "/api/projects/:id/conversations/written", createWrittenConversation],
    ["POST", "/api/projects/:id/import", importConversations],
  ].map(([method, pattern, handler]) => {
    const names = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), "([^/]+)"))}$`);
    return { method, regex, names, handler };
  });
}

export function createApp({ db, claude, embedder, passphrase, fetchImpl = fetch, secureCookies = true }) {
  const table = routes();
  const ctx = { db, claude, embedder, fetchImpl };

  async function login(request) {
    if (!passphrase) throw new HttpError(503, "No passphrase is set. Add WORKBENCH_PASSPHRASE to the site's environment variables.");
    const body = await readBody(request);
    if (!sameText(body.passphrase ?? "", passphrase)) {
      await new Promise((r) => setTimeout(r, 400));
      throw new HttpError(401, "That passphrase is not right.");
    }
    const cookie = `${COOKIE}=${sessionToken(passphrase)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookies ? "; Secure" : ""}`;
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  function logout() {
    return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? "; Secure" : ""}` });
  }

  function authorised(request) {
    return Boolean(passphrase) && sameText(readCookie(request, COOKIE), sessionToken(passphrase));
  }

  return {
    async handle(request) {
      const url = new URL(request.url);
      try {
        if (url.pathname === "/api/login" && request.method === "POST") return await login(request);
        if (url.pathname === "/api/logout" && request.method === "POST") return logout();
        if (!url.pathname.startsWith("/api/")) throw new HttpError(404, "Not found.");
        if (!authorised(request)) throw new HttpError(401, passphrase ? "Please enter the passphrase." : "No passphrase is set. Add WORKBENCH_PASSPHRASE to the site's environment variables.");
        if (!ctx.db) throw new HttpError(503, "No database is connected. See the setup guide (DEPLOY.md).");
        for (const route of table) {
          if (route.method !== request.method) continue;
          const match = route.regex.exec(url.pathname);
          if (!match) continue;
          const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(match[i + 1])]));
          const body = ["POST", "PUT", "PATCH"].includes(request.method) ? await readBody(request) : {};
          const result = await route.handler(ctx, params, body, url);
          return json(result ?? { ok: true });
        }
        throw new HttpError(404, "Not found.");
      } catch (err) {
        const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
        if (status === 500) console.error(err);
        return json({ error: status === 500 ? "Something went wrong on the server." : err.message }, status);
      }
    },
  };
}

// ---------- session ----------

async function sessionInfo({ db, claude, embedder }) {
  return {
    ok: true,
    claude: claude.available,
    voyage: embedder.available,
    vectorDatabase: Boolean(db.vector),
    models: MODELS.map(({ id, label }) => ({ id, label })),
    efforts: EFFORTS,
    groundingRules: groundingRules("{no-answer message}"),
  };
}

// ---------- projects ----------

async function loadProject(db, id) {
  const [project] = await db.query("SELECT * FROM projects WHERE id = $1", [id]);
  if (!project) throw new HttpError(404, "That project does not exist.");
  return project;
}

function projectSummary(p) {
  return { id: p.id, name: p.name, description: p.description, createdAt: p.created_at, updatedAt: p.updated_at };
}

async function listProjects({ db }) {
  const rows = await db.query(
    `SELECT p.*,
            (SELECT count(*)::int FROM documents d WHERE d.project_id = p.id) AS document_count,
            (SELECT count(*)::int FROM conversations c WHERE c.project_id = p.id) AS conversation_count
       FROM projects p ORDER BY p.updated_at DESC`,
  );
  return { projects: rows.map((p) => ({ ...projectSummary(p), documentCount: p.document_count, conversationCount: p.conversation_count })) };
}

async function insertVersion(db, projectId, settings, label) {
  const [{ next }] = await db.query("SELECT COALESCE(max(version_no), 0) + 1 AS next FROM bot_versions WHERE project_id = $1", [projectId]);
  const id = randomUUID();
  await db.query("INSERT INTO bot_versions (id, project_id, version_no, label, settings) VALUES ($1, $2, $3, $4, $5)", [id, projectId, next, label, JSON.stringify(settings)]);
  return { id, versionNo: next, label, settings };
}

async function createProject({ db }, _params, body) {
  const id = randomUUID();
  const name = requireText(body.name, "Project name", 200);
  const description = String(body.description ?? "").slice(0, 2000);
  const draft = sanitiseSettings({});
  await db.query("INSERT INTO projects (id, name, description, bot_draft) VALUES ($1, $2, $3, $4)", [id, name, description, JSON.stringify(draft)]);
  await insertVersion(db, id, draft, "Starting version");
  return { project: projectSummary(await loadProject(db, id)) };
}

async function getProject({ db }, { id }) {
  const project = await loadProject(db, id);
  const [counts] = await db.query(
    `SELECT (SELECT count(*)::int FROM documents WHERE project_id = $1) AS documents,
            (SELECT count(*)::int FROM chunks WHERE project_id = $1) AS passages,
            (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND embedded) AS embedded,
            (SELECT count(*)::int FROM bot_versions WHERE project_id = $1) AS versions,
            (SELECT count(*)::int FROM conversations WHERE project_id = $1) AS conversations,
            (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.project_id = $1) AS messages`,
    [id],
  );
  const recent = await db.query(
    `SELECT 'conversation' AS type, title AS name, updated_at AS at FROM conversations WHERE project_id = $1
     UNION ALL SELECT 'document', title, created_at FROM documents WHERE project_id = $1
     UNION ALL SELECT 'bot version', 'Version ' || version_no || CASE WHEN label <> '' THEN ': ' || label ELSE '' END, created_at FROM bot_versions WHERE project_id = $1
     ORDER BY at DESC LIMIT 8`,
    [id],
  );
  return { project: projectSummary(project), counts, recent, usage: await projectUsage(db, id) };
}

async function touch(db, projectId) {
  await db.query("UPDATE projects SET updated_at = now() WHERE id = $1", [projectId]);
}

async function updateProject({ db }, { id }, body) {
  const project = await loadProject(db, id);
  const name = body.name !== undefined ? requireText(body.name, "Project name", 200) : project.name;
  const description = body.description !== undefined ? String(body.description).slice(0, 2000) : project.description;
  await db.query("UPDATE projects SET name = $2, description = $3, updated_at = now() WHERE id = $1", [id, name, description]);
  return { project: projectSummary(await loadProject(db, id)) };
}

async function deleteProject({ db }, { id }) {
  await loadProject(db, id);
  await db.query("DELETE FROM projects WHERE id = $1", [id]);
  return { ok: true };
}

// Copies the chatbot (documents, passages with their embeddings, versions), not the conversations.
async function duplicateProject({ db }, { id }) {
  const source = await loadProject(db, id);
  const newId = randomUUID();
  await db.query("INSERT INTO projects (id, name, description, bot_draft, framework) VALUES ($1, $2, $3, $4, $5)", [newId, `${source.name} (copy)`, source.description, JSON.stringify(source.bot_draft), source.framework ? JSON.stringify(source.framework) : null]);
  const docs = await db.query("SELECT * FROM documents WHERE project_id = $1", [id]);
  for (const doc of docs) {
    const docId = randomUUID();
    await db.query(
      "INSERT INTO documents (id, project_id, title, source_type, source_ref, char_count, chunk_count, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [docId, newId, doc.title, doc.source_type, doc.source_ref, doc.char_count, doc.chunk_count, doc.created_at],
    );
    const vectorColumn = db.vector ? ", embedding" : "";
    await db.query(
      `INSERT INTO chunks (id, document_id, project_id, idx, text, embedded, embedding_json${vectorColumn})
       SELECT md5(random()::text || id), $1, $2, idx, text, embedded, embedding_json${vectorColumn} FROM chunks WHERE document_id = $3`,
      [docId, newId, doc.id],
    );
  }
  const versions = await db.query("SELECT * FROM bot_versions WHERE project_id = $1 ORDER BY version_no", [id]);
  for (const v of versions) {
    await db.query("INSERT INTO bot_versions (id, project_id, version_no, label, settings, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [randomUUID(), newId, v.version_no, v.label, JSON.stringify(v.settings), v.created_at]);
  }
  const personas = await db.query("SELECT * FROM personas WHERE project_id = $1 ORDER BY created_at", [id]);
  for (const p of personas) {
    await db.query("INSERT INTO personas (id, project_id, data, created_at) VALUES ($1, $2, $3, $4)", [randomUUID(), newId, JSON.stringify(p.data), p.created_at]);
  }
  return { project: projectSummary(await loadProject(db, newId)) };
}

// ---------- documents ----------

async function listDocuments({ db }, { id }) {
  await loadProject(db, id);
  const rows = await db.query(
    `SELECT d.*, (SELECT count(*)::int FROM chunks c WHERE c.document_id = d.id AND c.embedded) AS embedded_count
       FROM documents d WHERE d.project_id = $1 ORDER BY d.created_at DESC`,
    [id],
  );
  return {
    documents: rows.map((d) => ({
      id: d.id, title: d.title, sourceType: d.source_type, sourceRef: d.source_ref,
      charCount: d.char_count, chunkCount: d.chunk_count, embeddedCount: d.embedded_count, createdAt: d.created_at,
    })),
  };
}

async function addDocument({ db, fetchImpl }, { id }, body) {
  await loadProject(db, id);
  let extracted;
  if (body.url) extracted = await extractFromUrl(String(body.url).trim(), fetchImpl);
  else if (body.contentBase64) extracted = await extractFromFile(String(body.filename || "upload.txt"), Buffer.from(String(body.contentBase64), "base64"));
  else if (body.text) extracted = { title: requireText(body.title || "Pasted text", "Title", 300), text: String(body.text), sourceType: "pasted" };
  else throw new HttpError(400, "Add a file, a web address or some text.");
  const text = normalise(extracted.text);
  const chunks = chunkText(text);
  if (!chunks.length) throw new DocumentError("No text could be found in that document. If it is a scanned PDF, it needs text recognition (OCR) first.");
  const docId = randomUUID();
  const title = String(body.title || extracted.title || "Untitled").slice(0, 300);
  const sourceRef = String(body.url || body.filename || "").slice(0, 1000);
  await db.query(
    "INSERT INTO documents (id, project_id, title, source_type, source_ref, char_count, chunk_count) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [docId, id, title, extracted.sourceType, sourceRef, text.length, chunks.length],
  );
  // One statement for all passages keeps the request well within the time limit.
  const values = [];
  const params = [];
  chunks.forEach((chunk, i) => {
    const base = params.length;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    params.push(randomUUID(), docId, id, i, chunk);
  });
  for (let start = 0; start < values.length; start += 200) {
    const slice = values.slice(start, start + 200);
    const sliceParams = params.slice(start * 5, (start + slice.length) * 5);
    const renumbered = slice.map((_, j) => `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5})`);
    await db.query(`INSERT INTO chunks (id, document_id, project_id, idx, text) VALUES ${renumbered.join(", ")}`, sliceParams);
  }
  await touch(db, id);
  return { document: { id: docId, title, sourceType: extracted.sourceType, charCount: text.length, chunkCount: chunks.length, embeddedCount: 0 } };
}

// Embeds the next batch of passages that have no embedding yet. The page calls this
// repeatedly (with a progress bar) so no single request runs into the time limit.
async function embedPending({ db, embedder }, { id }) {
  await loadProject(db, id);
  if (!embedder.available) throw new HttpError(503, "Meaning-based search is not set up: add VOYAGE_API_KEY to the site's environment variables. Keyword search works meanwhile.");
  const pending = await db.query("SELECT id, text FROM chunks WHERE project_id = $1 AND NOT embedded ORDER BY document_id, idx LIMIT $2", [id, EMBED_BATCH]);
  if (pending.length) {
    const { vectors, tokens } = await embedder.embed(pending.map((c) => c.text), "document");
    for (let i = 0; i < pending.length; i++) {
      if (db.vector) {
        await db.query("UPDATE chunks SET embedded = true, embedding = $2::vector WHERE id = $1", [pending[i].id, toPgVector(vectors[i])]);
      } else {
        await db.query("UPDATE chunks SET embedded = true, embedding_json = $2 WHERE id = $1", [pending[i].id, JSON.stringify(vectors[i])]);
      }
    }
    await logUsage(db, { projectId: id, provider: "voyage", model: embedder.model, kind: "embed documents", inputTokens: tokens, costUsd: voyageCost(embedder.model, tokens) });
  }
  const [{ remaining, total }] = await db.query(
    "SELECT count(*) FILTER (WHERE NOT embedded)::int AS remaining, count(*)::int AS total FROM chunks WHERE project_id = $1",
    [id],
  );
  return { embeddedNow: pending.length, remaining, total };
}

async function searchProject(ctx, { id }, body) {
  await loadProject(ctx.db, id);
  const query = requireText(body.query, "Search text", 2000);
  const k = Math.min(20, Math.max(1, Number(body.k) || 5));
  return retrieve(ctx, id, query, k);
}

async function loadDocument(db, id) {
  const [doc] = await db.query("SELECT * FROM documents WHERE id = $1", [id]);
  if (!doc) throw new HttpError(404, "That document does not exist.");
  return doc;
}

async function getDocument({ db }, { id }) {
  const doc = await loadDocument(db, id);
  const chunks = await db.query("SELECT id, idx, text, embedded FROM chunks WHERE document_id = $1 ORDER BY idx", [id]);
  return {
    document: { id: doc.id, projectId: doc.project_id, title: doc.title, sourceType: doc.source_type, sourceRef: doc.source_ref, charCount: doc.char_count, chunkCount: doc.chunk_count, createdAt: doc.created_at },
    passages: chunks,
  };
}

async function deleteDocument({ db }, { id }) {
  const doc = await loadDocument(db, id);
  await db.query("DELETE FROM documents WHERE id = $1", [id]);
  await touch(db, doc.project_id);
  return { ok: true };
}

// ---------- bot ----------

function versionOut(v) {
  return { id: v.id, versionNo: v.version_no, label: v.label, settings: v.settings, createdAt: v.created_at };
}

async function getBot({ db }, { id }) {
  const project = await loadProject(db, id);
  const versions = await db.query("SELECT * FROM bot_versions WHERE project_id = $1 ORDER BY version_no DESC", [id]);
  return { draft: sanitiseSettings(project.bot_draft), versions: versions.map(versionOut), defaults: DEFAULT_BOT };
}

function checkModel(settings) {
  if (!modelInfo(settings.model)) throw new HttpError(400, "Choose one of the listed models.");
  return settings;
}

async function saveBotDraft({ db }, { id }, body) {
  await loadProject(db, id);
  const draft = checkModel(sanitiseSettings(body.draft ?? body));
  await db.query("UPDATE projects SET bot_draft = $2, updated_at = now() WHERE id = $1", [id, JSON.stringify(draft)]);
  return { draft };
}

async function saveBotVersion({ db }, { id }, body) {
  const project = await loadProject(db, id);
  const draft = checkModel(sanitiseSettings(body.draft ?? project.bot_draft));
  await db.query("UPDATE projects SET bot_draft = $2, updated_at = now() WHERE id = $1", [id, JSON.stringify(draft)]);
  const version = await insertVersion(db, id, draft, String(body.label ?? "").slice(0, 200));
  const [row] = await db.query("SELECT * FROM bot_versions WHERE id = $1", [version.id]);
  return { version: versionOut(row) };
}

// ---------- conversations ----------

function conversationOut(c) {
  return {
    id: c.id, projectId: c.project_id, botVersionId: c.bot_version_id, versionNo: c.version_no ?? null, source: c.source,
    title: c.title, personaId: c.persona_id ?? null, runId: c.run_id ?? null, runLabel: c.run_label ?? null,
    meta: c.meta, messageCount: c.message_count ?? undefined, createdAt: c.created_at, updatedAt: c.updated_at,
  };
}

// Optional filters: ?source=simulated&personaId=...&runId=...&versionId=...&kind=live
async function listConversations({ db }, { id }, _body, url) {
  await loadProject(db, id);
  const where = ["c.project_id = $1"];
  const params = [id];
  const q = url?.searchParams ?? new URLSearchParams();
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (q.get("source")) add("c.source = ?", q.get("source"));
  if (q.get("personaId")) add("c.persona_id = ?", q.get("personaId"));
  if (q.get("runId")) add("c.run_id = ?", q.get("runId"));
  if (q.get("versionId")) add("c.bot_version_id = ?", q.get("versionId"));
  if (q.get("scenario")) add("COALESCE(c.meta->'plan'->>'scenario', '') = ?", q.get("scenario"));
  if (q.get("kind") === "live") where.push("c.source = 'hand-written' AND COALESCE(c.meta->>'kind', 'live') = 'live'");
  const rows = await db.query(
    `SELECT c.*, v.version_no, r.label AS run_label, (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c LEFT JOIN bot_versions v ON v.id = c.bot_version_id LEFT JOIN runs r ON r.id = c.run_id
      WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC`,
    params,
  );
  return { conversations: rows.map(conversationOut) };
}

async function createConversation({ db }, { id }, body) {
  await loadProject(db, id);
  let versionId = body.botVersionId;
  if (versionId) {
    const [v] = await db.query("SELECT id FROM bot_versions WHERE id = $1 AND project_id = $2", [versionId, id]);
    if (!v) throw new HttpError(400, "That bot version does not belong to this project.");
  } else {
    const [latest] = await db.query("SELECT id FROM bot_versions WHERE project_id = $1 ORDER BY version_no DESC LIMIT 1", [id]);
    versionId = latest?.id ?? null;
  }
  if (!versionId) throw new HttpError(400, "Save a bot version first.");
  const convId = randomUUID();
  const [{ n }] = await db.query("SELECT count(*)::int + 1 AS n FROM conversations WHERE project_id = $1", [id]);
  const title = String(body.title || `Test chat ${n}`).slice(0, 200);
  await db.query("INSERT INTO conversations (id, project_id, bot_version_id, source, title, meta) VALUES ($1, $2, $3, $4, $5, $6)", [convId, id, versionId, "hand-written", title, JSON.stringify({ kind: "live" })]);
  await touch(db, id);
  return getConversation({ db }, { id: convId });
}

async function loadConversation(db, id) {
  const [conv] = await db.query(
    "SELECT c.*, v.version_no, v.settings, r.label AS run_label FROM conversations c LEFT JOIN bot_versions v ON v.id = c.bot_version_id LEFT JOIN runs r ON r.id = c.run_id WHERE c.id = $1",
    [id],
  );
  if (!conv) throw new HttpError(404, "That conversation does not exist.");
  return conv;
}

function messageOut(m) {
  return { id: m.id, idx: m.idx, role: m.role, text: m.text, meta: m.meta, createdAt: m.created_at };
}

async function getConversation({ db }, { id }) {
  const conv = await loadConversation(db, id);
  const messages = await db.query("SELECT * FROM messages WHERE conversation_id = $1 ORDER BY idx", [id]);
  return { conversation: conversationOut(conv), settings: conv.settings, messages: messages.map(messageOut) };
}

async function updateConversation({ db }, { id }, body) {
  await loadConversation(db, id);
  if (body.title !== undefined) await db.query("UPDATE conversations SET title = $2, updated_at = now() WHERE id = $1", [id, requireText(body.title, "Title", 200)]);
  return getConversation({ db }, { id });
}

async function deleteConversation({ db }, { id }) {
  await loadConversation(db, id);
  await db.query("DELETE FROM conversations WHERE id = $1", [id]);
  return { ok: true };
}

async function insertMessage(db, conversationId, idx, role, text, meta) {
  const id = randomUUID();
  await db.query("INSERT INTO messages (id, conversation_id, idx, role, text, meta) VALUES ($1, $2, $3, $4, $5, $6)", [id, conversationId, idx, role, text, JSON.stringify(meta)]);
  const [row] = await db.query("SELECT * FROM messages WHERE id = $1", [id]);
  return messageOut(row);
}

async function logClaude(db, projectId, reply, kind) {
  const cost = claudeCost(reply.model, reply.usage);
  await logUsage(db, {
    projectId, provider: "anthropic", model: reply.model, kind,
    inputTokens: (reply.usage?.input_tokens ?? 0) + (reply.usage?.cache_read_input_tokens ?? 0) + (reply.usage?.cache_creation_input_tokens ?? 0),
    outputTokens: reply.usage?.output_tokens ?? 0, costUsd: cost,
  });
  return cost;
}

// One user message and the bot's reply to it, saved to the conversation.
async function exchange(ctx, conv, userText, userMeta = {}) {
  const { db, claude } = ctx;
  if (!conv.settings) throw new HttpError(400, "This conversation's bot version was deleted.");
  const settings = sanitiseSettings(conv.settings);
  const history = await db.query("SELECT role, text FROM messages WHERE conversation_id = $1 ORDER BY idx", [conv.id]);
  const retrieval = await retrieve(ctx, conv.project_id, userText, settings.topK);
  const started = Date.now();
  const reply = await claude.complete({
    model: settings.model,
    effort: settings.effort,
    maxTokens: settings.maxTokens,
    system: buildSystemPrompt(settings),
    messages: buildMessages(history, userText, retrieval.passages),
  });
  const latencyMs = Date.now() - started;
  const cost = await logClaude(db, conv.project_id, reply, conv.source === "hand-written" ? "chat" : "chat (generated interactions)");

  const userMessage = await insertMessage(db, conv.id, history.length, "user", userText, userMeta);
  const botText = reply.refused ? "[The model declined to answer this message.]" : reply.text || "[Empty reply]";
  const botMessage = await insertMessage(db, conv.id, history.length + 1, "assistant", botText, {
    searchMode: retrieval.mode,
    ...(retrieval.warning ? { searchWarning: retrieval.warning } : {}),
    passages: retrieval.passages.map(({ chunkId, documentId, documentTitle, idx, score, text }) => ({ chunkId, documentId, documentTitle, idx, score, text })),
    model: reply.model,
    requestedModel: settings.model,
    stopReason: reply.stopReason,
    refused: reply.refused,
    noAnswer: botText.trim() === settings.noAnswerMessage.trim(),
    latencyMs,
    usage: reply.usage,
    costUsd: Math.round(cost * 1e6) / 1e6,
  });
  await db.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [conv.id]);
  await touch(db, conv.project_id);
  return [userMessage, botMessage];
}

async function sendMessage(ctx, { id }, body) {
  const conv = await loadConversation(ctx.db, id);
  const userText = requireText(body.text, "Message", 8000);
  return { messages: await exchange(ctx, conv, userText) };
}

// ---------- personas ----------

function personaOut(row) {
  return { id: row.id, projectId: row.project_id, ...row.data, conversationCount: row.conversation_count ?? 0, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function loadPersona(db, id) {
  const [row] = await db.query("SELECT * FROM personas WHERE id = $1", [id]);
  if (!row) throw new HttpError(404, "That persona does not exist.");
  return row;
}

async function projectFramework(db, projectId) {
  return frameworkOf(await loadProject(db, projectId));
}

async function insertPersona(db, projectId, data, framework) {
  const persona = sanitisePersona(data, framework ?? (await projectFramework(db, projectId)));
  if (!persona.name) throw new HttpError(400, "Give the persona a name.");
  const id = randomUUID();
  await db.query("INSERT INTO personas (id, project_id, data) VALUES ($1, $2, $3)", [id, projectId, JSON.stringify(persona)]);
  return personaOut(await loadPersona(db, id));
}

async function listPersonas({ db }, { id }) {
  await loadProject(db, id);
  const rows = await db.query(
    `SELECT p.*, (SELECT count(*)::int FROM conversations c WHERE c.persona_id = p.id) AS conversation_count
       FROM personas p WHERE p.project_id = $1 ORDER BY p.created_at`,
    [id],
  );
  return { personas: rows.map(personaOut) };
}

async function createPersona({ db }, { id }, body) {
  await loadProject(db, id);
  return { persona: await insertPersona(db, id, body.persona ?? body) };
}

async function addStarterPersonas({ db }, { id }) {
  await loadProject(db, id);
  const existing = new Set((await db.query("SELECT data->>'name' AS name FROM personas WHERE project_id = $1", [id])).map((r) => r.name));
  let added = 0;
  for (const persona of STARTER_PERSONAS) {
    if (existing.has(persona.name)) continue;
    await insertPersona(db, id, persona);
    added++;
  }
  return { added };
}

async function samplePassages(db, projectId, n) {
  return db.query(
    "SELECT c.text, d.title AS \"documentTitle\" FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.project_id = $1 ORDER BY random() LIMIT $2",
    [projectId, n],
  );
}

async function generatePersonasRoute({ db, claude }, { id }, body) {
  await loadProject(db, id);
  const brief = requireText(body.brief, "Brief", 2000);
  const count = Math.min(5, Math.max(1, Number(body.count) || 3));
  const passages = await samplePassages(db, id, 4);
  const framework = await projectFramework(db, id);
  const result = await generatePersonas(claude, { model: body.model || undefined, brief, count, passages, framework });
  await logClaude(db, id, result, "generate personas");
  const personas = [];
  for (const p of result.personas) personas.push(await insertPersona(db, id, { ...p, source: `Generated by AI from the brief: ${brief}` }, framework));
  return { personas };
}

async function updatePersona({ db }, { id }, body) {
  const row = await loadPersona(db, id);
  const persona = sanitisePersona({ ...row.data, ...(body.persona ?? body) }, await projectFramework(db, row.project_id));
  if (!persona.name) throw new HttpError(400, "Give the persona a name.");
  await db.query("UPDATE personas SET data = $2, updated_at = now() WHERE id = $1", [id, JSON.stringify(persona)]);
  return { persona: personaOut(await loadPersona(db, id)) };
}

// Conversations keep a copy of the persona they were run with, so deleting it loses nothing.
async function deletePersona({ db }, { id }) {
  await loadPersona(db, id);
  await db.query("DELETE FROM personas WHERE id = $1", [id]);
  return { ok: true };
}

async function duplicatePersona({ db }, { id }) {
  const row = await loadPersona(db, id);
  return { persona: await insertPersona(db, row.project_id, { ...row.data, name: `${row.data.name} (copy)`.slice(0, 120) }) };
}

// ---------- runs: batches of generated conversations ----------

async function loadVersion(db, projectId, versionId) {
  if (versionId) {
    const [v] = await db.query("SELECT * FROM bot_versions WHERE id = $1 AND project_id = $2", [versionId, projectId]);
    if (!v) throw new HttpError(400, "That bot version does not belong to this project.");
    return v;
  }
  const [latest] = await db.query("SELECT * FROM bot_versions WHERE project_id = $1 ORDER BY version_no DESC LIMIT 1", [projectId]);
  if (!latest) throw new HttpError(400, "Save a bot version first.");
  return latest;
}

function runOut(r) {
  return {
    id: r.id, kind: r.kind, label: r.label, settings: r.settings, createdAt: r.created_at,
    total: r.total ?? 0, done: r.done ?? 0, failed: r.failed ?? 0,
  };
}

async function listRuns({ db }, { id }) {
  await loadProject(db, id);
  const rows = await db.query(
    `SELECT r.*,
            (SELECT count(*)::int FROM conversations c WHERE c.run_id = r.id) AS total,
            (SELECT count(*)::int FROM conversations c WHERE c.run_id = r.id AND c.meta->>'status' = 'done') AS done,
            (SELECT count(*)::int FROM conversations c WHERE c.run_id = r.id AND c.meta->>'status' = 'failed') AS failed
       FROM runs r WHERE r.project_id = $1 ORDER BY r.created_at DESC`,
    [id],
  );
  const pending = await db.query(
    `SELECT c.run_id, c.id FROM conversations c JOIN runs r ON r.id = c.run_id
      WHERE r.project_id = $1 AND COALESCE(c.meta->>'status', 'done') NOT IN ('done', 'failed') ORDER BY c.created_at`,
    [id],
  );
  return { runs: rows.map((r) => ({ ...runOut(r), pendingIds: pending.filter((p) => p.run_id === r.id).map((p) => p.id) })) };
}

const clampInt = (v, min, max, fallback) => Math.min(max, Math.max(min, Math.round(Number(v)) || fallback));

async function createRun({ db }, { id }, body) {
  const project = await loadProject(db, id);
  const framework = frameworkOf(project);
  const kind = body.kind;
  if (kind !== "simulated" && kind !== "questions") throw new HttpError(400, "Unknown kind of run.");
  const version = await loadVersion(db, id, body.botVersionId);
  const runId = randomUUID();
  const [{ n }] = await db.query("SELECT count(*)::int + 1 AS n FROM runs WHERE project_id = $1", [id]);
  const conversations = [];

  if (kind === "simulated") {
    const personaIds = Array.isArray(body.personaIds) ? body.personaIds : [];
    if (!personaIds.length) throw new HttpError(400, "Choose at least one persona.");
    const personas = [];
    for (const pid of personaIds) {
      const row = await loadPersona(db, pid);
      if (row.project_id !== id) throw new HttpError(400, "That persona belongs to another project.");
      personas.push(row);
    }
    const count = clampInt(body.count, 1, 100, personas.length);
    const minTurns = clampInt(body.minTurns, 1, 15, 2);
    const maxTurns = clampInt(body.maxTurns, minTurns, 15, Math.max(minTurns, 6));
    const simulatorModel = modelInfo(body.simulatorModel) ? body.simulatorModel : DEFAULT_BOT.model;
    const s = body.scenarios ?? {};
    const scenarios = { askHuman: clampInt(s.askHuman, 0, count, 0), giveUp: clampInt(s.giveUp, 0, count, 0), misread: clampInt(s.misread, 0, count, 0) };
    if (scenarios.askHuman + scenarios.giveUp + scenarios.misread > count) throw new HttpError(400, `The scenarios add up to more than the ${count} conversations in this run.`);
    if ((scenarios.giveUp || scenarios.misread) && maxTurns < 2) throw new HttpError(400, "Giving up and misreading a reply need conversations of at least 2 user messages. Raise the maximum.");
    const settings = { botVersionId: version.id, versionNo: version.version_no, personaIds, count, minTurns, maxTurns, simulatorModel, scenarios };
    const assigned = assignScenarios(count, scenarios);
    const label = String(body.label || `Run ${n}: ${count} simulated conversation${count === 1 ? "" : "s"}, v${version.version_no}`).slice(0, 200);
    await db.query("INSERT INTO runs (id, project_id, kind, label, settings) VALUES ($1, $2, $3, $4, $5)", [runId, id, kind, label, JSON.stringify(settings)]);
    for (let i = 0; i < count; i++) {
      const persona = personas[i % personas.length];
      const meta = {
        kind: "simulated", status: "pending", persona: persona.data, personaName: persona.data.name, framework,
        plan: planConversation(assigned[i], { minTurns, maxTurns }), simulatorModel,
      };
      conversations.push({ personaId: persona.id, title: `${persona.data.name} #${Math.floor(i / personas.length) + 1}`, meta });
    }
  } else {
    const questions = (Array.isArray(body.questions) ? body.questions : [])
      .map((q) => (typeof q === "string" ? { text: q } : q))
      .map((q) => ({ text: String(q.text ?? "").trim().slice(0, 4000), inScope: q.inScope, personaId: q.personaId || null }))
      .filter((q) => q.text);
    if (!questions.length) throw new HttpError(400, "Add at least one question.");
    if (questions.length > 200) throw new HttpError(400, "Run at most 200 questions at a time.");
    const personaNames = {};
    for (const pid of new Set(questions.map((q) => q.personaId).filter(Boolean))) {
      const row = await loadPersona(db, pid);
      personaNames[pid] = row.data;
    }
    const settings = { botVersionId: version.id, versionNo: version.version_no, count: questions.length };
    const label = String(body.label || `Run ${n}: ${questions.length} test question${questions.length === 1 ? "" : "s"}, v${version.version_no}`).slice(0, 200);
    await db.query("INSERT INTO runs (id, project_id, kind, label, settings) VALUES ($1, $2, $3, $4, $5)", [runId, id, kind, label, JSON.stringify(settings)]);
    for (const q of questions) {
      const persona = q.personaId ? personaNames[q.personaId] : null;
      const meta = {
        kind: "single_question", status: "pending", question: q.text,
        ...(typeof q.inScope === "boolean" ? { inScope: q.inScope } : {}),
        ...(persona ? { persona, personaName: persona.name } : {}),
      };
      conversations.push({ personaId: q.personaId, title: q.text.slice(0, 80), meta });
    }
  }

  const ids = [];
  for (const c of conversations) {
    const convId = randomUUID();
    ids.push(convId);
    await db.query(
      "INSERT INTO conversations (id, project_id, bot_version_id, source, title, persona_id, run_id, meta) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [convId, id, version.id, "simulated", c.title, c.personaId, runId, JSON.stringify(c.meta)],
    );
  }
  await touch(db, id);
  const [run] = await db.query("SELECT * FROM runs WHERE id = $1", [runId]);
  return { run: { ...runOut(run), total: ids.length }, conversationIds: ids };
}

async function deleteRun({ db }, { id }) {
  const [run] = await db.query("SELECT * FROM runs WHERE id = $1", [id]);
  if (!run) throw new HttpError(404, "That run does not exist.");
  await db.query("DELETE FROM runs WHERE id = $1", [id]);
  return { ok: true };
}

async function saveMeta(db, convId, meta) {
  await db.query("UPDATE conversations SET meta = $2, updated_at = now() WHERE id = $1", [convId, JSON.stringify(meta)]);
}

async function finishSimulated(ctx, conv, meta, outcome) {
  const messages = await ctx.db.query("SELECT role, text FROM messages WHERE conversation_id = $1 ORDER BY idx", [conv.id]);
  let rating = null;
  let rapport = null;
  if (messages.length) {
    const result = await rateConversation(ctx.claude, { model: meta.simulatorModel, persona: meta.persona, framework: meta.framework, goal: meta.goal || "", messages, outcome });
    await logClaude(ctx.db, conv.project_id, result, "simulated user");
    rating = result.rating;
    rapport = result.rapport;
  }
  const done = {
    ...meta, status: "done", outcome, rating, ...(rapport ? { rapportPerception: rapport } : {}),
    escalated: outcome === "asked_for_human", abandoned: outcome === "gave_up",
  };
  delete done.finishReason;
  await saveMeta(ctx.db, conv.id, done);
  return done;
}

// Moves one generated conversation forward by one step: one user message and the
// bot's reply, or the end-of-chat rating. Each step stays well within the time
// limit; the page calls this repeatedly and shows progress.
async function simulateStep(ctx, { id }) {
  const { db, claude } = ctx;
  const conv = await loadConversation(db, id);
  const meta = { ...conv.meta };
  if (!meta.kind || !["simulated", "single_question"].includes(meta.kind)) throw new HttpError(400, "Only generated conversations can be run.");
  if (meta.status === "done") return { done: true, meta, messages: [] };
  try {
    if (meta.kind === "single_question") {
      const added = await exchange(ctx, conv, meta.question, { generated: true });
      const finished = { ...meta, status: "done", outcome: "answered" };
      delete finished.error;
      await saveMeta(db, id, finished);
      return { done: true, meta: finished, messages: added };
    }

    if (meta.finishReason) {
      const finished = await finishSimulated(ctx, conv, meta, meta.finishReason);
      return { done: true, meta: finished, messages: [] };
    }
    const plan = meta.plan;
    const history = await db.query("SELECT role, text FROM messages WHERE conversation_id = $1 ORDER BY idx", [id]);
    const turnNo = history.filter((m) => m.role === "user").length + 1;
    if (plan.giveUpAtTurn && turnNo >= plan.giveUpAtTurn) return { done: true, meta: await finishSimulated(ctx, conv, meta, "gave_up"), messages: [] };
    if (turnNo > plan.turnLimit) return { done: true, meta: await finishSimulated(ctx, conv, meta, "max_turns"), messages: [] };

    meta.status = "running";
    // misunderstandPct: conversations planned before scenario mixes existed.
    const misunderstand = plan.misreadAtTurn === turnNo || (turnNo > 1 && Math.random() * 100 < (plan.misunderstandPct ?? 0));
    const passages = turnNo === 1 && !meta.goal ? await samplePassages(db, conv.project_id, 4) : [];
    const ask = (insist) => personaTurn(claude, { model: meta.simulatorModel, persona: meta.persona, framework: meta.framework, plan, goal: meta.goal, messages: history, turnNo, misunderstand, passages, insist });
    let result = await ask(false);
    await logClaude(db, conv.project_id, result, "simulated user");
    const mayEnd = turnNo >= mayEndFrom(plan) && plan.askHumanAtTurn !== turnNo;
    // The planned scenario must happen: if the simulated user tried to leave too early, ask once more.
    if (!mayEnd && !String(result.turn.message ?? "").trim()) {
      result = await ask(true);
      await logClaude(db, conv.project_id, result, "simulated user");
    }
    const turn = result.turn;
    if (!meta.goal && turn.goal) meta.goal = String(turn.goal).slice(0, 1000);
    const message = String(turn.message ?? "").trim().slice(0, 4000);
    const wantsEnd = turn.action === "end" && mayEnd;

    if (wantsEnd && !message) {
      const outcome = turn.end_reason === "gave_up" ? "gave_up" : turn.end_reason === "goal_met" ? "goal_met" : "other";
      return { done: true, meta: await finishSimulated(ctx, conv, meta, outcome), messages: [] };
    }
    if (!message) return { done: true, meta: await finishSimulated(ctx, conv, meta, "other"), messages: [] };

    const askedForHuman = plan.askHumanAtTurn === turnNo;
    const userMeta = { simulated: true, ...(misunderstand ? { misunderstanding: true } : {}), ...(askedForHuman ? { askedForHuman: true } : {}) };
    const added = await exchange(ctx, conv, message, userMeta);
    if (wantsEnd) meta.finishReason = turn.end_reason === "gave_up" ? "gave_up" : "goal_met";
    else if (askedForHuman) meta.finishReason = "asked_for_human";
    else if (turnNo >= plan.turnLimit) meta.finishReason = "max_turns";
    delete meta.error;
    await saveMeta(db, id, meta);
    return { done: false, meta, messages: added };
  } catch (err) {
    // Keep the run going: record the problem on this conversation and let the page move on.
    if (err.status === 429 || err.status === 503) throw err;
    const failed = { ...meta, error: err.message, failures: (meta.failures ?? 0) + 1 };
    if (failed.failures >= 3) failed.status = "failed";
    await saveMeta(db, id, failed);
    throw err;
  }
}

async function generateQuestionsRoute({ db, claude }, { id }, body) {
  await loadProject(db, id);
  const count = clampInt(body.count, 1, 20, 10);
  const outOfScopePct = clampInt(body.outOfScopePct, 0, 100, 0);
  const passages = await samplePassages(db, id, 8);
  if (!passages.length) throw new HttpError(400, "Add documents first, so the questions can be based on them.");
  const persona = body.personaId ? (await loadPersona(db, body.personaId)).data : null;
  const avoid = Array.isArray(body.avoid) ? body.avoid.map(String) : [];
  const result = await generateQuestions(claude, { model: body.model || undefined, count, outOfScopePct, persona, framework: await projectFramework(db, id), passages, avoid });
  await logClaude(db, id, result, "generate questions");
  return { questions: result.questions };
}

// ---------- hand-written and imported conversations ----------

function cleanMessages(list) {
  return (Array.isArray(list) ? list : [])
    .map((m) => ({ role: m.role === "assistant" || m.role === "bot" ? "assistant" : m.role === "user" ? "user" : null, text: String(m.text ?? "").trim().slice(0, 8000) }))
    .filter((m) => m.role && m.text);
}

async function insertMessages(db, convId, messages, metaFor = () => ({})) {
  for (let start = 0; start < messages.length; start += 100) {
    const slice = messages.slice(start, start + 100);
    const params = [];
    const rows = slice.map((m, j) => {
      const base = params.length;
      params.push(randomUUID(), convId, start + j, m.role, m.text, JSON.stringify(metaFor(m)));
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });
    await db.query(`INSERT INTO messages (id, conversation_id, idx, role, text, meta) VALUES ${rows.join(", ")}`, params);
  }
}

async function createWrittenConversation({ db }, { id }, body) {
  await loadProject(db, id);
  const messages = cleanMessages(body.messages);
  if (!messages.length) throw new HttpError(400, "Write at least one message.");
  let versionId = null;
  if (body.botVersionId) versionId = (await loadVersion(db, id, body.botVersionId)).id;
  let persona = null;
  if (body.personaId) persona = await loadPersona(db, body.personaId);
  const convId = randomUUID();
  const [{ n }] = await db.query("SELECT count(*)::int + 1 AS n FROM conversations WHERE project_id = $1", [id]);
  const title = String(body.title || `Written conversation ${n}`).slice(0, 200);
  const meta = { kind: "written", ...(persona ? { persona: persona.data, personaName: persona.data.name } : {}), ...(body.note ? { note: String(body.note).slice(0, 2000) } : {}) };
  await db.query(
    "INSERT INTO conversations (id, project_id, bot_version_id, source, title, persona_id, meta) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [convId, id, versionId, "hand-written", title, persona?.id ?? null, JSON.stringify(meta)],
  );
  await insertMessages(db, convId, messages, () => ({ written: true }));
  await touch(db, id);
  return getConversation({ db }, { id: convId });
}

async function importConversations({ db }, { id }, body) {
  await loadProject(db, id);
  const parsed = await parseImport({ filename: body.filename, contentBase64: body.contentBase64, text: body.text });
  const messageCount = parsed.reduce((n, c) => n + c.messages.length, 0);
  if (parsed.length > 2000 || messageCount > 20000) throw new HttpError(400, "That is more than 2,000 conversations or 20,000 messages. Split it into smaller files.");
  const summary = {
    conversations: parsed.length,
    messages: messageCount,
    preview: parsed.slice(0, 3).map((c) => ({ key: c.key, title: c.title, persona: c.persona, messages: c.messages.slice(0, 6), more: Math.max(0, c.messages.length - 6) })),
  };
  if (body.dryRun) return summary;

  const runId = randomUUID();
  const source = body.filename ? String(body.filename).slice(0, 200) : "pasted text";
  const label = String(body.label || `Import: ${source}`).slice(0, 200);
  await db.query("INSERT INTO runs (id, project_id, kind, label, settings) VALUES ($1, $2, $3, $4, $5)", [runId, id, "import", label, JSON.stringify({ source, ...summary, preview: undefined })]);
  for (const [i, c] of parsed.entries()) {
    const convId = randomUUID();
    const meta = { kind: "imported", status: "done", sourceKey: c.key, ...(c.persona ? { personaName: c.persona } : {}) };
    const title = (c.title || (parsed.length > 1 || c.key !== "1" ? `Imported ${c.key}` : `Imported conversation ${i + 1}`)).slice(0, 200);
    await db.query(
      "INSERT INTO conversations (id, project_id, bot_version_id, source, title, run_id, meta) VALUES ($1, $2, NULL, $3, $4, $5, $6)",
      [convId, id, "imported", title, runId, JSON.stringify(meta)],
    );
    await insertMessages(db, convId, c.messages, (m) => (m.sourceRow ? { sourceRow: m.sourceRow } : {}));
  }
  await touch(db, id);
  return { ...summary, runId, preview: undefined };
}

// ---------- rapport framework and persona import ----------

async function getFramework({ db }, { id }) {
  const project = await loadProject(db, id);
  return { framework: frameworkOf(project), isDefault: !project.framework, default: GAAFFE };
}

async function saveFramework({ db }, { id }, body) {
  await loadProject(db, id);
  if (body.reset) {
    await db.query("UPDATE projects SET framework = NULL, updated_at = now() WHERE id = $1", [id]);
  } else {
    const framework = sanitiseFramework(body.framework);
    await db.query("UPDATE projects SET framework = $2, updated_at = now() WHERE id = $1", [id, JSON.stringify(framework)]);
  }
  return getFramework({ db }, { id });
}

// A spreadsheet with one row per persona (or participant).
async function importPersonas({ db }, { id }, body) {
  const framework = await projectFramework(db, id);
  const rows = await readTableFile({ filename: body.filename, contentBase64: body.contentBase64 });
  const { personas, mapping, unmapped } = personasFromRows(rows, framework);
  if (!personas.length) throw new HttpError(400, "No personas found. The file needs a header row and one row per persona.");
  if (personas.length > 200) throw new HttpError(400, "That is more than 200 personas. Split the file.");
  const source = `Imported from ${String(body.filename || "a spreadsheet").slice(0, 200)}`;
  if (body.dryRun) return { count: personas.length, mapping, unmapped, preview: personas.slice(0, 3).map((p) => sanitisePersona(p, framework)) };
  const saved = [];
  for (const p of personas) saved.push(await insertPersona(db, id, { ...p, source }, framework));
  return { count: saved.length };
}

const MAX_RESEARCH_CHARS = 150_000;

async function researchText(body) {
  let text;
  if (body.contentBase64) text = (await extractFromFile(String(body.filename || "research.txt"), Buffer.from(String(body.contentBase64), "base64"))).text;
  else text = String(body.text ?? "");
  text = normalise(text);
  if (text.length < 200) throw new HttpError(400, "There is too little text to draft personas from. Add more research material.");
  if (text.length > MAX_RESEARCH_CHARS) throw new HttpError(400, `The material is ${Math.round(text.length / 1000)}k characters long; the limit is ${MAX_RESEARCH_CHARS / 1000}k. Split it, or use the most relevant parts.`);
  return text;
}

// Step 1: read the research material and find the distinct user types in it.
async function researchTypes({ db, claude }, { id }, body) {
  await loadProject(db, id);
  const text = await researchText(body);
  const count = body.count ? Math.min(6, Math.max(1, Number(body.count) || 3)) : 0;
  const result = await identifyUserTypes(claude, { model: body.model || undefined, research: text, count });
  await logClaude(db, id, result, "draft personas from research");
  if (!result.types.length) throw new HttpError(422, "No distinct user types could be found in that material.");
  return { types: result.types, text };
}

// Step 2: one persona per request, so each stays within the time limit.
async function researchDraft({ db, claude }, { id }, body) {
  const framework = await projectFramework(db, id);
  const text = await researchText(body);
  const type = { name: requireText(body.type?.name, "User type", 200), summary: String(body.type?.summary ?? "").slice(0, 1000) };
  const result = await draftPersonaFromResearch(claude, { model: body.model || undefined, research: text, type, framework });
  await logClaude(db, id, result, "draft personas from research");
  if (!result.persona) throw new HttpError(502, "The persona could not be drafted. Try again.");
  const source = `Drafted by AI from ${String(body.sourceLabel || "research material").slice(0, 200)}: check against the data`;
  const persona = await insertPersona(db, id, { ...result.persona, source }, framework);
  return { persona, droppedQuotes: result.droppedQuotes };
}
