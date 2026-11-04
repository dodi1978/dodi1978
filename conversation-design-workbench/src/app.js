// The whole API as one function: Request in, Response out (web-standard Fetch API).
// Netlify (netlify/functions/api.mjs) and the plain Node server (server.js) both
// wrap this, so moving between hosts does not touch the app itself.

import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { extractFromFile, extractFromUrl, chunkText, normalise, DocumentError } from "./documents.js";
import { toPgVector } from "./embeddings.js";
import { claudeCost, voyageCost, MODELS, EFFORTS, modelInfo } from "./pricing.js";
import { DEFAULT_BOT, sanitiseSettings, retrieve, buildSystemPrompt, buildMessages, groundingRules } from "./rag.js";
import { logUsage, projectUsage } from "./usage.js";

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
  await db.query("INSERT INTO projects (id, name, description, bot_draft) VALUES ($1, $2, $3, $4)", [newId, `${source.name} (copy)`, source.description, JSON.stringify(source.bot_draft)]);
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
    title: c.title, meta: c.meta, messageCount: c.message_count ?? undefined, createdAt: c.created_at, updatedAt: c.updated_at,
  };
}

async function listConversations({ db }, { id }) {
  await loadProject(db, id);
  const rows = await db.query(
    `SELECT c.*, v.version_no, (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c LEFT JOIN bot_versions v ON v.id = c.bot_version_id
      WHERE c.project_id = $1 ORDER BY c.updated_at DESC`,
    [id],
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
  await db.query("INSERT INTO conversations (id, project_id, bot_version_id, source, title) VALUES ($1, $2, $3, $4, $5)", [convId, id, versionId, "hand-written", title]);
  await touch(db, id);
  return getConversation({ db }, { id: convId });
}

async function loadConversation(db, id) {
  const [conv] = await db.query(
    "SELECT c.*, v.version_no, v.settings FROM conversations c LEFT JOIN bot_versions v ON v.id = c.bot_version_id WHERE c.id = $1",
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

async function sendMessage(ctx, { id }, body) {
  const { db, claude } = ctx;
  const conv = await loadConversation(db, id);
  if (!conv.settings) throw new HttpError(400, "This conversation's bot version was deleted.");
  const userText = requireText(body.text, "Message", 8000);
  const settings = sanitiseSettings(conv.settings);
  const history = await db.query("SELECT role, text FROM messages WHERE conversation_id = $1 ORDER BY idx", [id]);

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
  const cost = claudeCost(reply.model, reply.usage);
  await logUsage(db, {
    projectId: conv.project_id, provider: "anthropic", model: reply.model, kind: "chat",
    inputTokens: (reply.usage?.input_tokens ?? 0) + (reply.usage?.cache_read_input_tokens ?? 0) + (reply.usage?.cache_creation_input_tokens ?? 0),
    outputTokens: reply.usage?.output_tokens ?? 0, costUsd: cost,
  });

  const userMessage = await insertMessage(db, id, history.length, "user", userText, {});
  const botText = reply.refused ? "[The model declined to answer this message.]" : reply.text || "[Empty reply]";
  const botMessage = await insertMessage(db, id, history.length + 1, "assistant", botText, {
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
  await db.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [id]);
  await touch(db, conv.project_id);
  return { messages: [userMessage, botMessage] };
}
