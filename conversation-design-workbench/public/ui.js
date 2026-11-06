// Shared building blocks for the workbench pages.

import { renderMarkdown } from "./markdown.js";

// session: what the server reported at login (models, which services are set up).
export const state = { session: null, onUnauthorized: null };


// h("div", { class: "x", onclick }, child, ...) builds elements; text is never parsed as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "value") el.value = value;
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    if (response.status === 413) data = { error: "That upload is too large." };
  }
  if (response.status === 401 && path !== "/api/login") {
    state.onUnauthorized?.(data.error);
    throw new ApiError(data.error || "Please enter the passphrase.", 401);
  }
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status}).`, response.status);
  return data;
}

let toastTimer;
function toast(message, kind = "") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === "error" ? 7000 : 3000);
}

function fail(err) {
  if (err?.status === 401) return;
  console.error(err);
  toast(err?.message || "Something went wrong.", "error");
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const when = (iso) => (iso ? dateFormat.format(new Date(iso)) : "");
const money = (usd) => (usd < 0.01 && usd > 0 ? `$${usd.toFixed(4)}` : `$${Number(usd || 0).toFixed(2)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const crumbs = document.getElementById("crumbs");
function setCrumbs(...parts) {
  crumbs.replaceChildren(...parts.flatMap((p, i) => [i ? " / " : "", typeof p === "string" ? p : h("a", { href: p.href }, p.label)]));
}

// Replaces an element's content; accepts nested arrays and skips empty values.
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== ""));
}

function render(...nodes) {
  fill(document.getElementById("app"), ...nodes);
}

function busy(button, label = "Working…") {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

async function confirmDialog(message, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    const dialog = h("dialog", {},
      h("p", {}, message),
      h("div", { class: "row end" },
        h("button", { onclick: () => { dialog.close(); resolve(false); } }, "Cancel"),
        h("button", { class: "primary", onclick: () => { dialog.close(); resolve(true); } }, confirmLabel)),
    );
    dialog.addEventListener("close", () => { dialog.remove(); resolve(false); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function showDialog(...content) {
  const dialog = h("dialog", {}, ...content, h("div", { class: "row end" }, h("button", { onclick: () => dialog.close() }, "Close")));
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// ---------- shared views ----------

function passageView(p) {
  return h("div", { class: "passage" },
    h("div", { class: "head" }, h("span", { class: "badge accent" }, `score ${p.score}`), h("strong", { class: "small" }, p.documentTitle), h("span", { class: "small muted" }, `passage ${p.idx + 1}`)),
    p.text);
}

function messageView(m) {
  if (m.role === "user") return h("div", { class: "msg user" }, h("div", { class: "bubble" }, m.text));
  const meta = m.meta || {};
  const badges = [];
  if (meta.noAnswer) badges.push(h("span", { class: "badge warn" }, "no answer"));
  if (meta.refused) badges.push(h("span", { class: "badge danger" }, "declined"));
  if (meta.model && meta.requestedModel && meta.model !== meta.requestedModel) badges.push(h("span", { class: "badge warn", title: "A safety check moved this request to another model." }, `answered by ${meta.model}`));
  if (meta.searchWarning) badges.push(h("span", { class: "badge warn", title: meta.searchWarning }, "keyword fallback"));
  const passages = meta.passages || [];
  const bubble = h("div", { class: "bubble formatted" }, renderMarkdown(m.text));
  let raw = false;
  const toggle = h("button", { class: "link-button small", type: "button", title: "Switch between formatted text and the exact text the model wrote", onclick: () => {
    raw = !raw;
    bubble.className = raw ? "bubble" : "bubble formatted";
    fill(bubble, raw ? m.text : renderMarkdown(m.text));
    toggle.textContent = raw ? "Show formatted" : "Show raw text";
  } }, "Show raw text");
  return h("div", { class: "msg assistant" },
    bubble,
    h("div", { class: "details" },
      ...badges,
      meta.searchMode ? h("span", {}, `${meta.searchMode === "meaning" ? "meaning" : "keyword"} search`) : null,
      meta.latencyMs ? h("span", {}, `${(meta.latencyMs / 1000).toFixed(1)} s`) : null,
      meta.costUsd !== undefined ? h("span", {}, money(meta.costUsd)) : null,
      /[*_#`>]|^\s*\d+[.)]\s/m.test(m.text) ? toggle : null),
    // Only replies the bot actually generated have a search behind them.
    Array.isArray(meta.passages) ? h("details", {},
      h("summary", {}, `Passages given to the bot (${passages.length})`),
      passages.length ? passages.map(passageView) : h("p", { class: "small muted" }, "No passages matched this message.")) : null);
}

export { h, ApiError, api, toast, fail, when, money, plural, setCrumbs, fill, render, busy, confirmDialog, showDialog, passageView, messageView };
