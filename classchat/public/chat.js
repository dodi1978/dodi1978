// The live chat panel shared by the student page and the teacher page.

export async function api(path, { method = "GET", body, auth = {} } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth.key) headers["x-teacher-key"] = auth.key;
  if (auth.token) headers["x-token"] = auth.token;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
  return data;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

// The emojis offered by the 😊 button, in groups.
const EMOJIS = [
  ["Faces", "🙂 😀 😄 😂 🤣 😊 😍 🥰 😎 🤓 🤔 🧐 😮 😲 🤯 😕 😟 😢 😭 😅 😬 🙃 😴 🥱 😇 🥳 🤩 🙈"],
  ["Reactions", "👍 👎 👏 🙌 🙏 💪 👋 ✋ 🤝 👌 ✌️ 🤞 👀 ❤️ 💯 🔥 ⭐ ✨"],
  ["Class", "✅ ❌ ❓ ❗ 💡 📚 📖 ✏️ 📝 📌 🎯 🧠 🗣️ 💬 🌍 ⏰ ☕ 🎉"],
].map(([name, list]) => [name, list.split(" ")]);

const time = (at) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * mount: element to draw the chat into.
 * auth: { token } for students, { key } for the teacher.
 * Calls onState(state) when the session settings change and onEnded() when the teacher ends it.
 */
export function createChat({ mount, code, auth, onState = () => {}, onEnded = () => {}, onLost = () => {} }) {
  const messages = new Map();
  const arrived = new Map(); // message id -> when it arrived live, to highlight new messages briefly
  const FRESH_MS = 4000;
  let me = null;
  let state = {};
  let sort = "latest";
  let replyTo = null;
  let source = null;

  const pinnedBox = el("div", { class: "pinned", hidden: true });
  const list = el("ol", { class: "messages", "aria-live": "polite" });
  const empty = el("p", { class: "empty" }, "No messages yet. Say hello!");
  const scroller = el("div", { class: "scroller" }, empty, list);
  const replyBar = el("div", { class: "reply-bar", hidden: true });
  const input = el("textarea", { rows: 1, maxlength: 500, placeholder: "Type a message…", "aria-label": "Message" });
  const sendBtn = el("button", { class: "btn primary", type: "submit" }, "Send");
  const emojiBtn = el("button", { class: "btn emoji-btn", type: "button", title: "Add an emoji", "aria-label": "Add an emoji", "aria-expanded": "false" }, "😊");
  const emojiPanel = el(
    "div",
    { class: "emoji-panel", hidden: true, role: "dialog", "aria-label": "Emojis" },
    EMOJIS.map(([name, list]) => [
      el("p", { class: "emoji-group" }, name),
      el("div", { class: "emoji-grid" }, list.map((e) => el("button", { type: "button", class: "emoji", "aria-label": e, onclick: () => insertEmoji(e) }, e))),
    ]).flat(),
  );
  const status = el("p", { class: "form-status", role: "status" });
  const form = el("form", { class: "composer" }, replyBar, emojiPanel, el("div", { class: "composer-row" }, emojiBtn, input, sendBtn), status);
  const sortBtn = el("button", { class: "chip", type: "button", title: "Switch order" }, "Latest first ⇅");

  mount.replaceChildren(el("div", { class: "chat" }, el("div", { class: "chat-tools" }, sortBtn), pinnedBox, scroller, form));

  sortBtn.addEventListener("click", () => {
    sort = sort === "latest" ? "liked" : "latest";
    sortBtn.textContent = sort === "latest" ? "Latest first ⇅" : "Most liked first ⇅";
    renderAll();
  });

  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    status.textContent = "";
    try {
      await api(`/api/rooms/${code}/messages`, { method: "POST", body: { text, replyTo: replyTo?.id }, auth });
      input.value = "";
      grow();
      setReply(null);
      toggleEmojis(false);
      stickToBottom = true;
    } catch (err) {
      status.textContent = err.message;
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });

  // ---- Emoji picker ----
  function toggleEmojis(open = emojiPanel.hidden) {
    emojiPanel.hidden = !open;
    emojiBtn.setAttribute("aria-expanded", String(open));
    // Close when clicking elsewhere. Listen on the window the chat is in right now (it may be floating).
    const doc = form.ownerDocument;
    if (open) setTimeout(() => doc.addEventListener("pointerdown", outside), 0);
    else doc.removeEventListener("pointerdown", outside);
  }
  function outside(e) {
    if (!emojiPanel.contains(e.target) && e.target !== emojiBtn) toggleEmojis(false);
  }
  emojiBtn.addEventListener("click", () => toggleEmojis());
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !emojiPanel.hidden) {
      toggleEmojis(false);
      input.focus();
    }
  });

  function insertEmoji(emoji) {
    if (input.disabled) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    const pos = start + emoji.length;
    input.focus();
    input.setSelectionRange(pos, pos);
    grow();
  }

  function grow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }

  function setReply(m) {
    replyTo = m;
    replyBar.hidden = !m;
    if (m) {
      replyBar.replaceChildren(
        el("span", {}, "Replying to ", el("strong", {}, m.name), ": ", snippet(m.text)),
        el("button", { class: "link", type: "button", onclick: () => setReply(null), "aria-label": "Cancel reply" }, "✕"),
      );
      input.focus();
    }
  }

  // Ask in whichever window the chat is showing in (it may be floating over the slides).
  const ask = (q) => (list.ownerDocument.defaultView || window).confirm(q);

  const snippet = (t) => (t.length > 60 ? t.slice(0, 60) + "…" : t);

  let stickToBottom = true;
  scroller.addEventListener("scroll", () => {
    stickToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  });

  async function act(m, op) {
    try {
      await api(`/api/rooms/${code}/messages/${m.id}/${op}`, { method: "POST", auth });
    } catch (err) {
      status.textContent = err.message;
    }
  }

  // A new message glows for a few seconds. Re-drawing the list carries on the glow where it was.
  const freshFor = (m) => {
    const t = arrived.get(m.id);
    if (t && Date.now() - t < FRESH_MS) return Date.now() - t;
    arrived.delete(m.id);
    return 0;
  };
  const freshStyle = (m) => {
    const age = freshFor(m);
    return age ? `animation-delay:-${age}ms` : null;
  };

  function bubble(m) {
    const mine = me && m.authorId === me.id;
    const teacher = me?.role === "teacher";
    const parent = m.replyTo ? messages.get(m.replyTo) : null;
    const like = el(
      "button",
      { class: "like" + (m.likedByMe ? " on" : ""), type: "button", "aria-pressed": String(m.likedByMe), title: "Like", onclick: () => act(m, "like") },
      "👍", m.likes ? el("span", {}, String(m.likes)) : null,
    );
    const actions = el(
      "div",
      { class: "actions" },
      like,
      el("button", { class: "link", type: "button", onclick: () => setReply(m) }, "Reply"),
      teacher ? el("button", { class: "link", type: "button", onclick: () => act(m, "pin") }, m.pinned ? "Unpin" : "Pin") : null,
      teacher || mine ? el("button", { class: "link danger", type: "button", onclick: () => ask("Delete this message?") && act(m, "delete") }, "Delete") : null,
    );
    return el(
      "li",
      { style: freshStyle(m), class: [freshFor(m) && "fresh", "msg", mine && "mine", m.role === "teacher" && "from-teacher", m.pinned && "is-pinned"].filter(Boolean).join(" "), "data-id": m.id },
      el("div", { class: "meta" }, el("strong", {}, m.role === "teacher" ? `${m.name} (teacher)` : mine ? `${m.name} (you)` : m.name), el("time", {}, time(m.at)), m.pinned ? el("span", { class: "pin-tag" }, "📌 pinned") : null),
      parent ? el("div", { class: "quote" }, el("strong", {}, parent.name), " ", snippet(parent.text)) : null,
      el("p", { class: "text" }, m.text),
      actions,
    );
  }

  function ordered() {
    const all = [...messages.values()];
    if (sort === "liked") return all.sort((a, b) => b.likes - a.likes || b.id - a.id);
    return all.sort((a, b) => a.id - b.id);
  }

  function renderAll() {
    const all = ordered();
    list.replaceChildren(...all.map(bubble));
    empty.hidden = all.length > 0;
    const pinned = all.filter((m) => m.pinned).sort((a, b) => a.id - b.id);
    pinnedBox.hidden = pinned.length === 0;
    pinnedBox.replaceChildren(...pinned.map((m) => el("div", { class: "pinned-item" }, "📌 ", el("strong", {}, m.name + ": "), m.text)));
    if (sort === "latest" && stickToBottom) scroller.scrollTop = scroller.scrollHeight;
    else if (sort === "liked") scroller.scrollTop = 0;
  }

  function applyState(s) {
    state = s;
    const locked = s.paused && me?.role !== "teacher";
    input.disabled = locked;
    sendBtn.disabled = locked;
    emojiBtn.disabled = locked;
    input.placeholder = locked ? "The teacher has paused the chat." : "Type a message…";
    onState(s);
  }

  function connect() {
    const q = auth.key ? `key=${encodeURIComponent(auth.key)}` : `token=${encodeURIComponent(auth.token)}`;
    source = new EventSource(`/api/rooms/${code}/stream?${q}`);
    source.addEventListener("snapshot", (e) => {
      const data = JSON.parse(e.data);
      me = data.me;
      messages.clear();
      for (const m of data.messages) messages.set(m.id, m);
      applyState(data.state);
      stickToBottom = true;
      renderAll();
    });
    source.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      messages.set(m.id, m);
      if (m.authorId !== me?.id) arrived.set(m.id, Date.now());
      renderAll();
    });
    source.addEventListener("update", (e) => {
      const m = JSON.parse(e.data);
      messages.set(m.id, m);
      renderAll();
    });
    source.addEventListener("delete", (e) => {
      messages.delete(JSON.parse(e.data).id);
      if (replyTo && !messages.has(replyTo.id)) setReply(null);
      renderAll();
    });
    source.addEventListener("cleared", () => {
      messages.clear();
      setReply(null);
      renderAll();
    });
    source.addEventListener("state", (e) => applyState(JSON.parse(e.data)));
    source.addEventListener("ended", () => {
      source.close();
      onEnded();
    });
    source.addEventListener("error", async () => {
      // The browser reconnects by itself after network blips. If the server refused us, find out why.
      if (source.readyState !== EventSource.CLOSED) return;
      try {
        await api(`/api/rooms/${code}`);
        onLost(); // session exists, but our pass is no longer valid (e.g. the server restarted)
      } catch {
        onEnded();
      }
    });
  }

  connect();

  return {
    get state() { return state; },
    get messages() { return ordered(); },
    focus: () => input.focus(),
    close: () => source?.close(),
    // After the panel moves into the floating window, keep the newest message in view.
    refresh: () => { stickToBottom = true; renderAll(); },
  };
}
