// Turns the chat into a file the teacher can keep: a Word document or a plain text file.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const clock = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const who = (m) => (m.role === "teacher" ? `${m.name} (teacher)` : m.name);
const short = (t) => (t.length > 80 ? t.slice(0, 80) + "…" : t);

function save(content, type, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function fileName(title, ext) {
  const date = new Date().toISOString().slice(0, 10);
  const safe = title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 50) || "class-chat";
  return `${safe}-${date}.${ext}`;
}

/** format: "word" or "text". messages: the chat's messages. */
export function downloadChat({ title, code, messages, format }) {
  const all = messages.slice().sort((a, b) => a.id - b.id);
  const byId = new Map(all.map((m) => [m.id, m]));
  const date = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const people = new Set(all.filter((m) => m.role === "student").map((m) => m.authorId)).size;
  const summary = `${all.length} message${all.length === 1 ? "" : "s"}${people ? ` from ${people} student${people === 1 ? "" : "s"}` : ""} · session code ${code}`;

  if (format === "text") {
    const lines = all.map((m) => {
      const parent = m.replyTo && byId.get(m.replyTo);
      return [
        `[${clock(m.at)}] ${who(m)}${m.pinned ? " 📌" : ""}${m.likes ? `  (👍 ${m.likes})` : ""}`,
        parent ? `    ↪ replying to ${parent.name}: ${short(parent.text)}` : null,
        `    ${m.text.replace(/\n/g, "\n    ")}`,
      ].filter(Boolean).join("\n");
    });
    // The invisible mark at the start makes Windows Notepad show emojis and accents correctly.
    const text = `﻿${title}\n${date}\n${summary}\n\n${lines.join("\n\n")}\n`;
    return save(text, "text/plain;charset=utf-8", fileName(title, "txt"));
  }

  const rows = all.map((m) => {
    const parent = m.replyTo && byId.get(m.replyTo);
    const style = m.role === "teacher" ? ' style="background:#fff4d6"' : "";
    return `<tr${style}>
      <td style="white-space:nowrap;color:#666">${clock(m.at)}</td>
      <td><b>${esc(who(m))}</b></td>
      <td>${parent ? `<div style="color:#777;font-size:9pt">↪ replying to ${esc(parent.name)}: ${esc(short(parent.text))}</div>` : ""}${esc(m.text).replace(/\n/g, "<br>")}</td>
      <td style="white-space:nowrap">${m.likes ? `👍 ${m.likes}` : ""}${m.pinned ? " 📌" : ""}</td>
    </tr>`;
  });
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 4pt 6pt; vertical-align: top; text-align: left; }
  th { background: #eee; }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <p>${esc(date)}<br><span style="color:#666">${esc(summary)}</span></p>
  <table>
    <tr><th>Time</th><th>From</th><th>Message</th><th>Likes</th></tr>
    ${rows.join("\n")}
  </table>
  <p style="color:#888;font-size:9pt">Teacher messages are highlighted. 📌 = pinned.</p>
</body></html>`;
  return save("﻿" + html, "application/msword;charset=utf-8", fileName(title, "doc"));
}
