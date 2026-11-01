// Finding the passages that answer a question, and building what Claude is sent.

import { cosine, toPgVector } from "./embeddings.js";
import { voyageCost } from "./pricing.js";
import { logUsage } from "./usage.js";

export const DEFAULT_BOT = {
  systemPrompt:
    "You are a friendly, helpful assistant. Answer questions clearly and briefly, in plain language. If the user's question is unclear, ask one short clarifying question.",
  model: "claude-opus-5-5",
  effort: "low",
  topK: 5,
  maxTokens: 1024,
  noAnswerMessage: "Sorry, I don't have information about that. Could you ask in a different way, or ask about something else?",
};

// The part of the system prompt the app adds to every bot, shown in the app so it is never hidden.
export function groundingRules(noAnswerMessage) {
  return [
    "Each user message comes with passages retrieved from the knowledge base, inside <passages> tags. The user cannot see these passages.",
    "Base factual answers only on those passages. Do not add facts from elsewhere.",
    `If the passages do not contain the information needed, reply with this message, adapted only as far as the conversation requires: "${noAnswerMessage}"`,
    "Do not mention passages, documents or a knowledge base unless the user asks where the information comes from.",
  ].join("\n");
}

export function buildSystemPrompt(settings) {
  return `${settings.systemPrompt.trim()}\n\n# How to use the knowledge base\n${groundingRules(settings.noAnswerMessage)}`;
}

export function sanitiseSettings(input = {}, base = DEFAULT_BOT) {
  const s = { ...base, ...input };
  return {
    systemPrompt: String(s.systemPrompt ?? "").slice(0, 20_000),
    model: String(s.model || base.model),
    effort: ["low", "medium", "high"].includes(s.effort) ? s.effort : "low",
    topK: Math.min(20, Math.max(1, Math.round(Number(s.topK) || 5))),
    maxTokens: Math.min(8000, Math.max(100, Math.round(Number(s.maxTokens) || 1024))),
    noAnswerMessage: String(s.noAnswerMessage ?? "").slice(0, 1000) || DEFAULT_BOT.noAnswerMessage,
  };
}

function keywordQuery(text) {
  const words = (String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).slice(0, 30);
  return [...new Set(words)].join(" | ");
}

async function keywordSearch(db, projectId, query, k) {
  const tsquery = keywordQuery(query);
  if (!tsquery) return [];
  return db.query(
    `SELECT c.id, c.text, c.idx, c.document_id, d.title AS document_title,
            ts_rank(to_tsvector('english', c.text), to_tsquery('english', $2)) AS score
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.project_id = $1 AND to_tsvector('english', c.text) @@ to_tsquery('english', $2)
      ORDER BY score DESC LIMIT $3`,
    [projectId, tsquery, k],
  );
}

// Returns { mode, passages: [{ chunkId, documentId, documentTitle, idx, score, text }] }.
export async function retrieve({ db, embedder }, projectId, query, k) {
  const [{ embedded }] = await db.query("SELECT count(*)::int AS embedded FROM chunks WHERE project_id = $1 AND embedded", [projectId]);
  let rows;
  let mode;
  let warning;
  let queryEmbedding;
  if (embedder.available && embedded > 0) {
    try {
      queryEmbedding = await embedder.embed([query], "query");
    } catch (err) {
      // Keep the chat working if Voyage AI is down or over its limit.
      warning = `Meaning-based search failed, so keyword search was used. ${err.message}`;
    }
  }
  if (queryEmbedding) {
    mode = "meaning";
    const { vectors, tokens } = queryEmbedding;
    await logUsage(db, { projectId, provider: "voyage", model: embedder.model, kind: "search", inputTokens: tokens, costUsd: voyageCost(embedder.model, tokens) });
    const vector = vectors[0];
    if (db.vector) {
      rows = await db.query(
        `SELECT c.id, c.text, c.idx, c.document_id, d.title AS document_title,
                1 - (c.embedding <=> $2::vector) AS score
           FROM chunks c JOIN documents d ON d.id = c.document_id
          WHERE c.project_id = $1 AND c.embedding IS NOT NULL
          ORDER BY c.embedding <=> $2::vector LIMIT $3`,
        [projectId, toPgVector(vector), k],
      );
    } else {
      const all = await db.query(
        `SELECT c.id, c.text, c.idx, c.document_id, d.title AS document_title, c.embedding_json
           FROM chunks c JOIN documents d ON d.id = c.document_id
          WHERE c.project_id = $1 AND c.embedded`,
        [projectId],
      );
      rows = all
        .map(({ embedding_json, ...row }) => ({ ...row, score: cosine(vector, embedding_json) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }
  } else {
    mode = "keyword";
    rows = await keywordSearch(db, projectId, query, k);
  }
  return {
    mode,
    ...(warning ? { warning } : {}),
    passages: rows.map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      idx: r.idx,
      score: Math.round(Number(r.score) * 1000) / 1000,
      text: r.text,
    })),
  };
}

export function passagesBlock(passages) {
  if (!passages.length) return "<passages>\n(No relevant passages were found.)\n</passages>";
  const body = passages
    .map((p, i) => `<passage n="${i + 1}" source="${p.documentTitle.replace(/"/g, "'")}">\n${p.text}\n</passage>`)
    .join("\n");
  return `<passages>\n${body}\n</passages>`;
}

// history: earlier messages [{ role, text }]; the newest user turn gets the passages.
export function buildMessages(history, userText, passages) {
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.text)
    .map((m) => ({ role: m.role, content: m.text }));
  messages.push({ role: "user", content: `${passagesBlock(passages)}\n\n${userText}` });
  return messages;
}
