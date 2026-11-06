// The public chat page: what real users (participants) see through a shared link.
// It shows only the conversation, never the bot's settings or documents.

import { renderMarkdown } from "./markdown.js";

const app = document.getElementById("app");
const token = location.pathname.split("/").filter(Boolean)[1] ?? "";
const base = `/api/public/${encodeURIComponent(token)}`;
let config = null;
let session = null; // { conversationId, key }

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function show(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
}

function notice(text) {
  return h("p", { class: "notice danger" }, text);
}

async function start() {
  try {
    config = await call("GET", "");
  } catch (err) {
    show(h("div", { class: "p-card" }, h("h1", {}, "Chat unavailable"), h("p", {}, err.message)));
    return;
  }
  document.title = config.title;
  welcome();
}

function welcome() {
  const agree = h("input", { type: "checkbox", id: "agree" });
  const error = h("div");
  const begin = h("button", { class: "primary", onclick: async () => {
    if (config.requireConsent && !agree.checked) {
      error.replaceChildren(notice("Please tick the box to agree before starting."));
      return;
    }
    begin.disabled = true;
    try {
      session = await call("POST", "/start", { consent: config.requireConsent ? agree.checked : undefined });
      chat();
    } catch (err) {
      error.replaceChildren(notice(err.message));
      begin.disabled = false;
    }
  } }, "Start chat");
  show(h("div", { class: "p-card" },
    h("h1", {}, config.title),
    config.welcome ? h("p", { class: "p-welcome" }, config.welcome) : null,
    config.requireConsent ? h("label", { class: "p-consent", for: "agree" }, agree, h("span", {}, config.consentText || "I agree.")) : null,
    error,
    begin));
}

function bubble(role, text) {
  return h("div", { class: `msg ${role}` }, h("div", { class: role === "assistant" ? "bubble formatted" : "bubble" }, role === "assistant" ? renderMarkdown(text) : text));
}

function chat() {
  const log = h("div", { class: "p-log", "aria-live": "polite" });
  const input = h("textarea", { "aria-label": "Your message", placeholder: "Type your message…", rows: 1, maxlength: 2000 });
  const send = h("button", { class: "primary", type: "submit" }, "Send");
  const note = h("div", { class: "p-note", hidden: true });
  const typing = h("div", { class: "typing", hidden: true }, "Typing…");
  let busy = false;
  const submit = async () => {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    log.append(bubble("user", text));
    input.value = "";
    typing.hidden = false;
    log.scrollTop = log.scrollHeight;
    try {
      const { reply, remaining } = await call("POST", `/chat/${session.conversationId}/messages`, { key: session.key, text });
      log.append(bubble("assistant", reply));
      if (remaining <= 3) {
        note.hidden = false;
        note.textContent = remaining > 0 ? `You can send ${remaining} more message${remaining === 1 ? "" : "s"} in this chat.` : "This chat has reached its maximum length. Please end the chat.";
      }
    } catch (err) {
      log.append(notice(err.message));
    } finally {
      typing.hidden = true;
      busy = false;
      send.disabled = false;
      input.focus();
      log.scrollTop = log.scrollHeight;
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  const end = (reason) => async () => {
    try {
      await call("POST", `/chat/${session.conversationId}/end`, { key: session.key, reason });
    } catch {
      // Ending is best effort; the conversation is saved either way.
    }
    finished(reason);
  };
  show(h("div", { class: "p-card p-chat" },
    h("div", { class: "p-head" }, h("h1", {}, config.title)),
    log,
    typing,
    note,
    h("form", { class: "p-input", onsubmit: (e) => { e.preventDefault(); submit(); } }, input, send),
    h("div", { class: "p-actions" },
      h("button", { type: "button", onclick: end("finished") }, "End chat"),
      config.offerHuman ? h("button", { type: "button", onclick: end("human") }, "Talk to a person") : null)));
  input.focus();
}

function finished(reason) {
  const parts = [];
  if (reason === "human" && config.humanMessage !== undefined) parts.push(h("p", {}, config.humanMessage));
  if (!config.askRating) {
    show(h("div", { class: "p-card" }, h("h1", {}, "Thank you"), parts, h("p", {}, "The chat has ended. You can close this page.")));
    return;
  }
  let score = 0;
  const buttons = [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", "aria-pressed": "false", "aria-label": `${n} out of 5`, onclick: () => {
    score = n;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i + 1 === n)));
  } }, String(n)));
  const comment = h("textarea", { id: "comment", rows: 3, maxlength: 1000, placeholder: "Optional" });
  const error = h("div");
  const done = () => show(h("div", { class: "p-card" }, h("h1", {}, "Thank you"), h("p", {}, "Your feedback has been saved. You can close this page.")));
  show(h("div", { class: "p-card" },
    h("h1", {}, "Thank you"),
    parts,
    h("p", {}, h("strong", {}, "How satisfied were you with this conversation?")),
    h("p", { class: "small muted" }, "1 = very dissatisfied, 5 = very satisfied"),
    h("div", { class: "stars", role: "group", "aria-label": "Satisfaction" }, buttons),
    h("label", { for: "comment" }, "Anything you would like to add?"),
    comment,
    error,
    h("div", { class: "row", style: "margin-top:1rem" },
      h("button", { class: "primary", onclick: async () => {
        if (!score) {
          error.replaceChildren(notice("Please choose a number from 1 to 5, or skip."));
          return;
        }
        try {
          await call("POST", `/chat/${session.conversationId}/end`, { key: session.key, reason, rating: score, comment: comment.value });
        } catch {
          // Best effort.
        }
        done();
      } }, "Send feedback"),
      h("button", { class: "link-button", onclick: async () => {
        try {
          await call("POST", `/chat/${session.conversationId}/end`, { key: session.key, reason, skipRating: true });
        } catch {
          // Best effort.
        }
        done();
      } }, "Skip"))));
}

start();
