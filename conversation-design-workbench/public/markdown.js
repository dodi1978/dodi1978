// A small, safe Markdown renderer for chatbot replies. It builds DOM nodes
// directly (never innerHTML), so text from the model can never inject HTML.
// Supports headings, bold, italics, inline code, code blocks, bullet and
// numbered lists, links (http/https only), quotes and horizontal rules.

function inline(text) {
  const out = [];
  // Bold (**x** or __x__), italics (*x* or _x_), `code`, [text](https://link).
  // Underscores only count at word edges, so snake_case_names stay as they are.
  const pattern = /\*\*(.+?)\*\*|(?<!\w)__(.+?)__(?!\w)|\*(?![\s*])(.+?)(?<!\s)\*|(?<!\w)_(?![\s_])(.+?)(?<!\s)_(?!\w)|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(document.createTextNode(text.slice(last, match.index)));
    let el;
    const bold = match[1] ?? match[2];
    const italic = match[3] ?? match[4];
    if (bold !== undefined) {
      el = document.createElement("strong");
      el.append(...inline(bold));
    } else if (italic !== undefined) {
      el = document.createElement("em");
      el.append(...inline(italic));
    } else if (match[5] !== undefined) {
      el = document.createElement("code");
      el.textContent = match[5];
    } else {
      el = document.createElement("a");
      el.href = match[7];
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.textContent = match[6];
    }
    out.push(el);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

function withBreaks(lines) {
  const out = [];
  lines.forEach((line, i) => {
    if (i) out.push(document.createElement("br"));
    out.push(...inline(line));
  });
  return out;
}

export function renderMarkdown(text) {
  const root = document.createElement("div");
  root.className = "md";
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line.trim())) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) code.push(lines[i++]);
      i++;
      const pre = document.createElement("pre");
      pre.textContent = code.join("\n");
      root.append(pre);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const el = document.createElement("p");
      el.className = "md-heading";
      const strong = document.createElement("strong");
      strong.append(...inline(heading[2]));
      el.append(strong);
      root.append(el);
      i++;
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      root.append(document.createElement("hr"));
      i++;
      continue;
    }
    const bullet = /^\s*[-*•+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line) && !bullet.test(line);
      const kind = ordered ? numbered : bullet;
      const list = document.createElement(ordered ? "ol" : "ul");
      if (ordered) {
        const start = parseInt(line, 10);
        if (start > 1) list.start = start;
      }
      while (i < lines.length && kind.test(lines[i])) {
        const item = document.createElement("li");
        const itemLines = [lines[i].replace(kind, "")];
        i++;
        // Indented continuation lines belong to the same item.
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !kind.test(lines[i])) itemLines.push(lines[i++].trim());
        item.append(...withBreaks(itemLines));
        list.append(item);
      }
      root.append(list);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      const el = document.createElement("blockquote");
      el.append(...withBreaks(quote));
      root.append(el);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?)/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) para.push(lines[i++]);
    const p = document.createElement("p");
    p.append(...withBreaks(para));
    root.append(p);
  }
  return root;
}
