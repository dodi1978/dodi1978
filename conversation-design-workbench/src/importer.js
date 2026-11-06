// Turning existing transcripts (CSV, Excel or pasted text) into conversations.

import readXlsxFile from "read-excel-file/node";

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const USER_WORDS = ["user", "customer", "human", "client", "participant", "visitor", "caller", "student", "u", "q", "question", "me"];
const BOT_WORDS = ["bot", "assistant", "agent", "chatbot", "ai", "system", "b", "a", "answer", "advisor", "adviser", "claude", "model"];

export function normaliseRole(label) {
  const word = String(label ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (USER_WORDS.includes(word)) return "user";
  if (BOT_WORDS.includes(word)) return "assistant";
  return null;
}

// RFC 4180 CSV: quoted fields, doubled quotes, commas/semicolons/tabs, newlines inside quotes.
export function parseCsv(text) {
  const clean = String(text).replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] || "";
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

const COLUMN_NAMES = {
  conversation: ["conversation", "conversationid", "conversation_id", "conv", "convid", "session", "sessionid", "session_id", "dialogue", "dialogueid", "dialog", "chat", "chatid", "thread", "id"],
  role: ["role", "speaker", "from", "sender", "author", "who", "party", "participant"],
  text: ["text", "message", "utterance", "content", "turn", "body", "msg"],
  title: ["title", "name", "conversationtitle"],
  persona: ["persona", "usertype", "profile"],
};

function findColumn(header, kind) {
  const names = COLUMN_NAMES[kind];
  return header.findIndex((h) => names.includes(String(h).trim().toLowerCase().replace(/[\s-]/g, "")));
}

// rows: array of arrays, first row a header.
export function conversationsFromRows(rows) {
  if (rows.length < 2) throw new ImportError("The file needs a header row and at least one message.");
  const header = rows[0].map((h) => String(h ?? ""));
  const col = Object.fromEntries(Object.keys(COLUMN_NAMES).map((k) => [k, findColumn(header, k)]));
  if (col.role < 0 || col.text < 0) {
    throw new ImportError(`Could not find the columns for who spoke and what they said. Name them for example "role" and "text". Columns found: ${header.join(", ") || "(none)"}.`);
  }
  const conversations = new Map();
  const unknown = new Set();
  rows.slice(1).forEach((row, i) => {
    const text = String(row[col.text] ?? "").trim();
    if (!text) return;
    const role = normaliseRole(row[col.role]);
    if (!role) {
      unknown.add(String(row[col.role] ?? "(empty)"));
      return;
    }
    const key = col.conversation >= 0 ? String(row[col.conversation] ?? "").trim() || "1" : "1";
    if (!conversations.has(key)) {
      conversations.set(key, {
        key,
        title: col.title >= 0 && row[col.title] ? String(row[col.title]).trim() : "",
        persona: col.persona >= 0 && row[col.persona] ? String(row[col.persona]).trim() : "",
        messages: [],
      });
    }
    conversations.get(key).messages.push({ role, text, sourceRow: i + 2 });
  });
  if (unknown.size) {
    throw new ImportError(`These speaker labels were not recognised: ${[...unknown].slice(0, 8).join(", ")}. Use "user" for the person and "bot" for the chatbot.`);
  }
  return [...conversations.values()];
}

// Pasted transcripts: "User: …" / "Bot: …" lines; conversations separated by a line of --- or ===.
export function conversationsFromText(text) {
  const blocks = String(text).replace(/\r\n?/g, "\n").split(/^\s*(?:-{3,}|={3,})\s*$/m);
  const conversations = [];
  const unknown = new Set();
  for (const block of blocks) {
    const messages = [];
    for (const line of block.split("\n")) {
      const match = /^\s*([A-Za-z][\w .'-]{0,30}?)\s*:\s?(.*)$/.exec(line);
      const role = match ? normaliseRole(match[1]) : null;
      if (role) messages.push({ role, text: match[2] });
      else if (match && !messages.length) unknown.add(match[1]);
      else if (messages.length) messages[messages.length - 1].text += `\n${line}`;
      else if (line.trim()) unknown.add(line.trim().slice(0, 30));
    }
    const cleaned = messages.map((m) => ({ ...m, text: m.text.trim() })).filter((m) => m.text);
    if (cleaned.length) conversations.push({ key: String(conversations.length + 1), title: "", persona: "", messages: cleaned });
  }
  if (!conversations.length) {
    throw new ImportError(`No messages found. Start each line with "User:" or "Bot:", and separate conversations with a line of three dashes (---).${unknown.size ? ` Not recognised: ${[...unknown].slice(0, 5).join(", ")}.` : ""}`);
  }
  return conversations;
}

// Either a file ({ filename, contentBase64 }) or pasted transcript text ({ text }).
export async function parseImport({ filename, contentBase64, text }) {
  if (text !== undefined && text !== null && !contentBase64) return conversationsFromText(String(text));
  if (!contentBase64) throw new ImportError("Choose a file or paste a transcript.");
  const bytes = Buffer.from(String(contentBase64), "base64");
  if (bytes.length > 4 * 1024 * 1024) throw new ImportError("The file is larger than 4 MB. Split it into smaller files.");
  const ext = /\.([a-z0-9]+)$/i.exec(filename || "")?.[1]?.toLowerCase();
  if (ext === "xlsx") {
    let sheets;
    try {
      sheets = await readXlsxFile(bytes);
    } catch {
      throw new ImportError("That Excel file could not be read. Save it as .xlsx, or export it as CSV.");
    }
    const rows = (sheets[0]?.data ?? []).map((r) => r.map((c) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString() : String(c))));
    return conversationsFromRows(rows.filter((r) => r.some((c) => c.trim() !== "")));
  }
  if (ext === "xls") throw new ImportError("Old Excel files (.xls) are not supported. Save it as .xlsx or CSV.");
  const content = bytes.toString("utf8");
  if (ext === "csv" || ext === "tsv") return conversationsFromRows(parseCsv(content));
  if (ext === "txt" || ext === "md" || !ext) return conversationsFromText(content);
  throw new ImportError(`Files of type .${ext} cannot be imported. Use CSV, Excel (.xlsx) or a text file.`);
}
