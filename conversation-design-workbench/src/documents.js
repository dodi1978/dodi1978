// Turning uploaded files and web pages into plain text, and plain text into passages.

import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const TARGET_CHARS = 1500;
const OVERLAP_CHARS = 200;

export class DocumentError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function extension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name || "");
  return match ? match[1].toLowerCase() : "";
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? htmlToText(match[1]).trim() : "";
}

async function pdfToText(bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n\n");
}

// Returns { title, text, sourceType } for an uploaded file.
export async function extractFromFile(filename, bytes) {
  if (!bytes?.length) throw new DocumentError("The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new DocumentError("The file is larger than 4 MB. Split it into smaller files.");
  const ext = extension(filename);
  const title = (filename || "Untitled").replace(/\.[^.]+$/, "");
  let text;
  if (ext === "pdf") text = await pdfToText(bytes);
  else if (ext === "docx") text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  else if (ext === "html" || ext === "htm") text = htmlToText(Buffer.from(bytes).toString("utf8"));
  else if (["txt", "md", "markdown", "csv", "json", "text", ""].includes(ext)) text = Buffer.from(bytes).toString("utf8");
  else if (ext === "doc") throw new DocumentError("Old Word files (.doc) are not supported. Save it as .docx or PDF first.");
  else throw new DocumentError(`Files of type .${ext} are not supported. Use PDF, Word (.docx), text or HTML.`);
  return { title, text, sourceType: ext || "txt" };
}

export async function extractFromUrl(url, fetchImpl = fetch) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new DocumentError("That does not look like a web address.");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new DocumentError("Only http and https addresses are supported.");
  let response;
  try {
    response = await fetchImpl(parsed.href, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "ConversationDesignWorkbench/0.1" } });
  } catch {
    throw new DocumentError("The page could not be reached.");
  }
  if (!response.ok) throw new DocumentError(`The page returned an error (${response.status}).`);
  const type = response.headers.get("content-type") || "";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) throw new DocumentError("The page is larger than 4 MB.");
  if (type.includes("pdf")) return { title: parsed.pathname.split("/").pop() || parsed.hostname, text: await pdfToText(bytes), sourceType: "url" };
  const raw = bytes.toString("utf8");
  if (type.includes("html") || /<html/i.test(raw)) return { title: htmlTitle(raw) || parsed.hostname, text: htmlToText(raw), sourceType: "url" };
  return { title: parsed.hostname + parsed.pathname, text: raw, sourceType: "url" };
}

export function normalise(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLong(paragraph) {
  if (paragraph.length <= TARGET_CHARS) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*\s*/g) || [paragraph];
  const parts = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > TARGET_CHARS) {
      if (current) parts.push(current.trim());
      current = "";
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) parts.push(sentence.slice(i, i + TARGET_CHARS).trim());
      continue;
    }
    if ((current + sentence).length > TARGET_CHARS && current) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Splits text into passages of roughly TARGET_CHARS, keeping paragraphs together
// where possible and repeating the end of each passage at the start of the next.
export function chunkText(text) {
  const clean = normalise(text);
  if (!clean) return [];
  const pieces = clean.split(/\n\n+/).flatMap(splitLong).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    if (current && (current.length + piece.length + 2) > TARGET_CHARS) {
      chunks.push(current);
      const tail = current.slice(-OVERLAP_CHARS);
      const cut = tail.search(/[.!?\n]\s/);
      current = cut >= 0 && cut < tail.length - 2 ? tail.slice(cut + 1).trim() : "";
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  return chunks;
}
