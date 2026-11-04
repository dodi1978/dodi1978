// Conversation Design Workbench: browser side. Plain JavaScript, no build step.

const app = document.getElementById("app");
const crumbs = document.getElementById("crumbs");
const logoutButton = document.getElementById("logout");
let session = null;

// ---------- helpers ----------

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
    showLogin(data.error);
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

function setCrumbs(...parts) {
  crumbs.replaceChildren(...parts.flatMap((p, i) => [i ? " / " : "", typeof p === "string" ? p : h("a", { href: p.href }, p.label)]));
}

// Replaces an element's content; accepts nested arrays and skips empty values.
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== ""));
}

function render(...nodes) {
  fill(app, ...nodes);
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

// ---------- login ----------

function showLogin(message) {
  logoutButton.hidden = true;
  setCrumbs();
  const input = h("input", { type: "password", id: "passphrase", autocomplete: "current-password", required: true });
  const error = h("p", { class: "notice danger", hidden: !message || /Please enter/.test(message) }, message || "");
  const button = h("button", { class: "primary", type: "submit" }, "Open workbench");
  const form = h("form", { class: "card login", onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(button, "Checking…");
    try {
      await api("POST", "/api/login", { passphrase: input.value });
      session = null;
      route();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    } finally {
      done();
    }
  } },
    h("h1", {}, "Conversation Design Workbench"),
    h("p", { class: "muted" }, "Enter the workbench passphrase."),
    error,
    h("div", { class: "field" }, h("label", { for: "passphrase" }, "Passphrase"), input),
    button,
  );
  render(form);
  input.focus();
}

logoutButton.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  session = null;
  showLogin();
});

// ---------- projects list ----------

async function projectsPage() {
  setCrumbs("Projects");
  const { projects } = await api("GET", "/api/projects");
  const name = h("input", { id: "new-name", placeholder: "e.g. Library chatbot – politeness study", maxlength: 200 });
  const description = h("input", { id: "new-desc", placeholder: "Optional", maxlength: 2000 });
  const create = h("button", { class: "primary", type: "submit" }, "Create project");
  const form = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(create, "Creating…");
    try {
      const { project } = await api("POST", "/api/projects", { name: name.value, description: description.value });
      location.hash = `#/p/${project.id}/documents`;
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } },
    h("h2", {}, "New project"),
    h("div", { class: "grid-2" },
      h("div", { class: "field" }, h("label", { for: "new-name" }, "Name"), name),
      h("div", { class: "field" }, h("label", { for: "new-desc" }, "Description"), description)),
    create,
  );

  const cards = projects.map((p) => h("div", { class: "card project-card" },
    h("a", { class: "title", href: `#/p/${p.id}` }, p.name),
    p.description ? h("div", { class: "muted small" }, p.description) : null,
    h("div", { class: "small muted" }, `${plural(p.documentCount, "document")} · ${plural(p.conversationCount, "conversation")}`),
    h("div", { class: "small muted" }, `Updated ${when(p.updatedAt)}`),
    h("div", { class: "row" },
      h("a", { class: "button", href: `#/p/${p.id}` }, "Open"),
      h("button", { onclick: async (e) => {
        const done = busy(e.target, "Copying…");
        try {
          await api("POST", `/api/projects/${p.id}/duplicate`);
          toast("Project copied (documents and bot versions, not conversations).");
          projectsPage().catch(fail);
        } catch (err) {
          fail(err);
          done();
        }
      } }, "Duplicate"),
      h("button", { class: "link-button danger", onclick: async () => {
        if (!(await confirmDialog(`Delete “${p.name}” and everything in it? This cannot be undone.`))) return;
        try {
          await api("DELETE", `/api/projects/${p.id}`);
          toast("Project deleted.");
          projectsPage().catch(fail);
        } catch (err) {
          fail(err);
        }
      } }, "Delete")),
  ));

  render(
    h("h1", {}, "Projects"),
    h("p", { class: "muted" }, "Each project holds its own chatbot, documents and conversations."),
    form,
    projects.length ? h("div", { class: "project-list" }, cards) : h("div", { class: "card empty" }, "No projects yet. Create your first one above."),
  );
}

// ---------- project shell ----------

const TABS = [
  ["overview", "Overview"],
  ["documents", "Documents"],
  ["bot", "Chatbot"],
  ["chat", "Test chat"],
];

async function projectPage(projectId, tab, extra) {
  const data = await api("GET", `/api/projects/${projectId}`);
  const { project } = data;
  setCrumbs({ href: "#/", label: "Projects" }, { href: `#/p/${projectId}`, label: project.name }, TABS.find(([k]) => k === tab)?.[1] ?? "");
  const tabs = h("nav", { class: "tabs", "aria-label": "Project sections" },
    TABS.map(([key, label]) => h("a", { href: `#/p/${projectId}/${key}`, class: key === tab ? "active" : "", "aria-current": key === tab ? "page" : null }, label)));
  const body = h("div");
  render(h("h1", {}, project.name), tabs, body);
  const pages = { overview: overviewTab, documents: documentsTab, bot: botTab, chat: chatTab };
  await (pages[tab] ?? overviewTab)(body, projectId, data, extra);
}

function setupNotices() {
  const notes = [];
  if (!session?.claude) notes.push(h("div", { class: "notice warn" }, "Claude is not set up yet, so the chatbot cannot answer. Add ANTHROPIC_API_KEY to the site's environment variables (see DEPLOY.md)."));
  if (!session?.voyage) notes.push(h("div", { class: "notice warn" }, "Meaning-based search is not set up yet, so the chatbot uses keyword search. Add VOYAGE_API_KEY to switch it on (see DEPLOY.md)."));
  return notes;
}

// ---------- overview ----------

async function overviewTab(body, projectId, { project, counts, recent, usage }) {
  const name = h("input", { id: "p-name", value: project.name, maxlength: 200 });
  const description = h("textarea", { id: "p-desc", maxlength: 2000 }, project.description);
  const save = h("button", { class: "primary", type: "submit" }, "Save");
  const stats = [
    [counts.documents, "documents"],
    [counts.passages, `passages (${counts.embedded} indexed for meaning search)`],
    [counts.versions, "bot versions"],
    [counts.conversations, `conversations (${counts.messages} messages)`],
  ];
  fill(body, 
    ...setupNotices(),
    h("div", { class: "grid-4" }, stats.map(([v, l]) => h("div", { class: "stat" }, h("div", { class: "value" }, v), h("div", { class: "label" }, l)))),
    h("div", { class: "grid-2", style: "margin-top:1rem" },
      h("form", { class: "card", onsubmit: async (e) => {
        e.preventDefault();
        const done = busy(save, "Saving…");
        try {
          await api("PATCH", `/api/projects/${projectId}`, { name: name.value, description: description.value });
          toast("Saved.");
          route();
        } catch (err) {
          fail(err);
        } finally {
          done();
        }
      } },
        h("h2", {}, "Project details"),
        h("div", { class: "field" }, h("label", { for: "p-name" }, "Name"), name),
        h("div", { class: "field" }, h("label", { for: "p-desc" }, "Description"), description),
        save),
      h("div", {},
        h("div", { class: "card" },
          h("h2", {}, "API use and cost"),
          h("p", {}, h("strong", {}, money(usage.totalUsd)), h("span", { class: "muted" }, " estimated so far in this project")),
          usage.rows.length
            ? h("div", { class: "table-wrap" }, h("table", {},
                h("thead", {}, h("tr", {}, h("th", {}, "Service"), h("th", {}, "Use"), h("th", {}, "Calls"), h("th", {}, "Tokens"), h("th", {}, "Cost"))),
                h("tbody", {}, usage.rows.map((r) => h("tr", {},
                  h("td", {}, r.provider === "anthropic" ? "Claude" : "Voyage AI"), h("td", {}, r.kind), h("td", {}, r.calls),
                  h("td", {}, (r.input_tokens + r.output_tokens).toLocaleString("en-GB")), h("td", {}, money(r.cost_usd)))))))
            : h("p", { class: "muted" }, "Nothing used yet."),
          h("p", { class: "hint" }, "Estimates from list prices. Voyage AI's first 200 million tokens are free, so those costs are usually zero in practice. Your provider dashboards show the actual bill.")),
        h("div", { class: "card" },
          h("h2", {}, "Recent activity"),
          recent.length
            ? h("ul", {}, recent.map((r) => h("li", {}, h("span", { class: "badge" }, r.type), " ", r.name, h("span", { class: "muted small" }, ` · ${when(r.at)}`))))
            : h("p", { class: "muted" }, "Nothing yet. Start by adding documents.")),
      )),
  );
}

// ---------- documents ----------

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function documentsTab(body, projectId, overview, _extra, { autoIndex = false } = {}) {
  const { documents } = await api("GET", `/api/projects/${projectId}/documents`);
  const pending = documents.reduce((n, d) => n + d.chunkCount - d.embeddedCount, 0);

  // Add documents
  let mode = "file";
  const fileInput = h("input", { type: "file", id: "doc-file", multiple: true, accept: ".pdf,.docx,.txt,.md,.html,.htm,.csv" });
  const urlInput = h("input", { type: "url", id: "doc-url", placeholder: "https://…" });
  const pasteTitle = h("input", { id: "doc-title", placeholder: "Title" });
  const pasteText = h("textarea", { id: "doc-text", placeholder: "Paste text here", rows: 8 });
  const panes = {
    file: h("div", { class: "field" }, h("label", { for: "doc-file" }, "Files"), fileInput, h("div", { class: "hint" }, "PDF, Word (.docx), text, Markdown or HTML. Up to 4 MB each. Scanned PDFs need text recognition first.")),
    url: h("div", { class: "field" }, h("label", { for: "doc-url" }, "Web page address"), urlInput),
    paste: h("div", {}, h("div", { class: "field" }, h("label", { for: "doc-title" }, "Title"), pasteTitle), h("div", { class: "field" }, h("label", { for: "doc-text" }, "Text"), pasteText)),
  };
  const paneHolder = h("div", {}, panes.file);
  const modeButtons = [["file", "Upload files"], ["url", "From a web page"], ["paste", "Paste text"]].map(([key, label]) =>
    h("button", { type: "button", "aria-pressed": String(key === mode), onclick: () => {
      mode = key;
      modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === key)));
      fill(paneHolder, panes[key]);
    }, "data-key": key }, label));
  const addButton = h("button", { class: "primary", type: "submit" }, "Add");
  const status = h("div", { class: "small muted" });

  const addForm = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(addButton, "Adding…");
    try {
      if (mode === "file") {
        const files = [...fileInput.files];
        if (!files.length) throw new Error("Choose at least one file.");
        for (const [i, file] of files.entries()) {
          status.textContent = `Reading ${file.name} (${i + 1} of ${files.length})…`;
          if (file.size > 4 * 1024 * 1024) {
            toast(`${file.name} is over 4 MB and was skipped.`, "error");
            continue;
          }
          try {
            await api("POST", `/api/projects/${projectId}/documents`, { filename: file.name, contentBase64: await fileToBase64(file) });
          } catch (err) {
            toast(`${file.name}: ${err.message}`, "error");
          }
        }
      } else if (mode === "url") {
        status.textContent = "Fetching the page…";
        await api("POST", `/api/projects/${projectId}/documents`, { url: urlInput.value });
      } else {
        await api("POST", `/api/projects/${projectId}/documents`, { title: pasteTitle.value, text: pasteText.value });
      }
      status.textContent = "";
      await documentsTab(body, projectId, overview, [], { autoIndex: true });
    } catch (err) {
      status.textContent = "";
      fail(err);
    } finally {
      done();
    }
  } },
    h("h2", {}, "Add documents"),
    h("p", { class: "muted" }, "The chatbot answers from these. Each document is split into short passages so the right ones can be found for each question."),
    h("div", { class: "segmented", role: "group", "aria-label": "How to add" }, modeButtons),
    paneHolder,
    h("div", { class: "row" }, addButton, status),
  );

  // Indexing (embeddings) with a progress bar
  const bar = h("span");
  const progressText = h("div", { class: "small muted" });
  let indexButton = null;
  let indexCard = null;
  if (session?.voyage && pending > 0) {
    indexButton = h("button", { class: "primary", onclick: async () => {
      const done = busy(indexButton, "Indexing…");
      try {
        for (;;) {
          const r = await api("POST", `/api/projects/${projectId}/embed`);
          const pct = r.total ? Math.round(((r.total - r.remaining) / r.total) * 100) : 100;
          bar.style.width = `${pct}%`;
          progressText.textContent = `${r.total - r.remaining} of ${r.total} passages indexed`;
          if (!r.remaining || !r.embeddedNow) break;
        }
        toast("Meaning-based search is ready.");
        await documentsTab(body, projectId, overview);
      } catch (err) {
        fail(err);
        done();
      }
    } }, "Index now");
    indexCard = h("div", { class: "card" },
      h("h2", {}, "Index for meaning-based search"),
      h("p", {}, `${plural(pending, "passage")} still need indexing. Until then, those passages are found by keyword search only.`),
      h("div", { class: "progress", style: "margin-bottom:0.5rem" }, bar), progressText,
      h("div", { class: "row", style: "margin-top:0.6rem" }, indexButton));
  }

  // Document list
  const list = documents.length
    ? h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Document"), h("th", {}, "Type"), h("th", {}, "Passages"), h("th", {}, "Search"), h("th", {}, "Added"), h("th", {}, ""))),
        h("tbody", {}, documents.map((d) => h("tr", {},
          h("td", {}, h("button", { class: "link-button", onclick: () => viewDocument(d.id) }, d.title), d.sourceRef ? h("div", { class: "small muted" }, d.sourceRef) : null),
          h("td", {}, h("span", { class: "badge" }, d.sourceType)),
          h("td", {}, d.chunkCount, h("div", { class: "small muted" }, d.charCount < 1000 ? `${d.charCount} characters` : `${Math.round(d.charCount / 1000)}k characters`)),
          h("td", {}, d.embeddedCount === d.chunkCount ? h("span", { class: "badge ok" }, "meaning + keyword") : d.embeddedCount ? h("span", { class: "badge warn" }, `${d.embeddedCount}/${d.chunkCount} indexed`) : h("span", { class: "badge" }, "keyword only")),
          h("td", { class: "small" }, when(d.createdAt)),
          h("td", {}, h("button", { class: "danger", onclick: async () => {
            if (!(await confirmDialog(`Delete “${d.title}”? Past conversations keep their copies of the passages they used.`))) return;
            try {
              await api("DELETE", `/api/documents/${d.id}`);
              await documentsTab(body, projectId, overview);
            } catch (err) {
              fail(err);
            }
          } }, "Delete")),
        )))))
    : h("p", { class: "empty" }, "No documents yet.");

  // Try the search
  const query = h("input", { id: "search-q", placeholder: "Type a question a user might ask" });
  const results = h("div");
  const searchButton = h("button", { type: "submit" }, "Search");
  const search = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(searchButton, "Searching…");
    try {
      const r = await api("POST", `/api/projects/${projectId}/search`, { query: query.value, k: 5 });
      fill(results, 
        h("p", { class: "small muted" }, `Search used: ${r.mode === "meaning" ? "meaning-based" : "keyword"}. Higher scores mean a closer match.`),
        r.warning ? h("div", { class: "notice warn" }, r.warning) : null,
        r.passages.length ? r.passages.map(passageView) : h("p", { class: "muted" }, "No passages matched."),
      );
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } },
    h("h2", {}, "Try the search"),
    h("p", { class: "muted" }, "See which passages the chatbot would be given for a question, before the bot answers. Useful for checking retrieval."),
    h("div", { class: "row" }, h("div", { style: "flex:1;min-width:200px" }, query), searchButton),
    h("div", { style: "margin-top:0.8rem" }, results));

  if (autoIndex && indexButton) queueMicrotask(() => indexButton.click());
  fill(body, ...setupNotices(), addForm, indexCard ?? "", h("div", { class: "card" }, h("h2", {}, `Documents (${documents.length})`), list), documents.length ? search : "");
}

function passageView(p) {
  return h("div", { class: "passage" },
    h("div", { class: "head" }, h("span", { class: "badge accent" }, `score ${p.score}`), h("strong", { class: "small" }, p.documentTitle), h("span", { class: "small muted" }, `passage ${p.idx + 1}`)),
    p.text);
}

async function viewDocument(id) {
  try {
    const { document: d, passages } = await api("GET", `/api/documents/${id}`);
    showDialog(
      h("h2", {}, d.title),
      h("p", { class: "muted small" }, `${plural(passages.length, "passage")} · ${d.charCount.toLocaleString("en-GB")} characters`),
      passages.map((p) => h("div", { class: "passage" }, h("div", { class: "head" }, h("span", { class: "small muted" }, `Passage ${p.idx + 1}`), p.embedded ? h("span", { class: "badge ok" }, "indexed") : null), p.text)),
    );
  } catch (err) {
    fail(err);
  }
}

// ---------- chatbot settings ----------

async function botTab(body, projectId) {
  const { draft, versions, defaults } = await api("GET", `/api/projects/${projectId}/bot`);
  const fields = {
    systemPrompt: h("textarea", { id: "b-prompt", rows: 10 }, draft.systemPrompt),
    model: h("select", { id: "b-model" }, session.models.map((m) => h("option", { value: m.id, selected: m.id === draft.model }, m.label))),
    effort: h("select", { id: "b-effort" }, session.efforts.map((e) => h("option", { value: e, selected: e === draft.effort }, e))),
    topK: h("input", { id: "b-topk", type: "number", min: 1, max: 20, value: draft.topK }),
    maxTokens: h("input", { id: "b-max", type: "number", min: 100, max: 8000, step: 1, value: draft.maxTokens }),
    noAnswerMessage: h("textarea", { id: "b-noanswer", rows: 3 }, draft.noAnswerMessage),
  };
  const current = () => ({
    systemPrompt: fields.systemPrompt.value,
    model: fields.model.value,
    effort: fields.effort.value,
    topK: Number(fields.topK.value),
    maxTokens: Number(fields.maxTokens.value),
    noAnswerMessage: fields.noAnswerMessage.value,
  });
  const latest = versions[0]?.settings;
  const unsaved = h("span", { class: "badge warn", hidden: true }, "Changed since the last saved version");
  const checkChanged = () => (unsaved.hidden = JSON.stringify(current()) === JSON.stringify(latest));
  Object.values(fields).forEach((f) => f.addEventListener("input", checkChanged));
  checkChanged();

  const rules = h("div", { class: "rules" }, session.groundingRules.replace("{no-answer message}", draft.noAnswerMessage));
  fields.noAnswerMessage.addEventListener("input", () => (rules.textContent = session.groundingRules.replace("{no-answer message}", fields.noAnswerMessage.value)));

  const saveDraft = h("button", { type: "button", onclick: async () => {
    const done = busy(saveDraft, "Saving…");
    try {
      await api("PUT", `/api/projects/${projectId}/bot`, { draft: current() });
      toast("Draft saved. Save it as a version to chat with it.");
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } }, "Save draft");
  const label = h("input", { id: "b-label", placeholder: "e.g. Warmer tone", maxlength: 200 });
  const saveVersion = h("button", { class: "primary", type: "submit" }, "Save as new version");

  const form = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(saveVersion, "Saving…");
    try {
      const { version } = await api("POST", `/api/projects/${projectId}/bot/versions`, { draft: current(), label: label.value });
      toast(`Saved as version ${version.versionNo}.`);
      await botTab(body, projectId);
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } },
    h("div", { class: "row" }, h("h2", { style: "margin:0" }, "Chatbot design"), h("span", { class: "spacer" }), unsaved),
    h("p", { class: "muted" }, "Conversations always record which saved version answered, so you can compare versions on the same inputs later."),
    h("div", { class: "field" }, h("label", { for: "b-prompt" }, "System instructions"), fields.systemPrompt,
      h("div", { class: "hint" }, "Role, tone, scope, persona and rules. This is also the design specification for the instruction-following eval later.")),
    h("div", { class: "field" }, h("label", {}, "Added automatically after your instructions"), rules,
      h("div", { class: "hint" }, "These rules make the bot answer from your documents. They are shown here so nothing about the bot is hidden.")),
    h("div", { class: "field" }, h("label", { for: "b-noanswer" }, "When nothing relevant is found, say"), fields.noAnswerMessage,
      h("div", { class: "hint" }, "Replies that match this message are flagged as “no answer” (used for the fallback rate later).")),
    h("div", { class: "grid-4" },
      h("div", { class: "field" }, h("label", { for: "b-model" }, "Model"), fields.model),
      h("div", { class: "field" }, h("label", { for: "b-effort" }, "Effort"), fields.effort, h("div", { class: "hint" }, "Low is fastest and cheapest.")),
      h("div", { class: "field" }, h("label", { for: "b-topk" }, "Passages per question"), fields.topK),
      h("div", { class: "field" }, h("label", { for: "b-max" }, "Maximum answer length"), fields.maxTokens, h("div", { class: "hint" }, "In tokens (about ¾ of a word each)."))),
    h("div", { class: "row" },
      h("div", { style: "flex:1;min-width:200px" }, h("label", { for: "b-label" }, "Version label (optional)"), label)),
    h("div", { class: "row", style: "margin-top:0.8rem" }, saveVersion, saveDraft,
      h("button", { type: "button", class: "link-button", onclick: () => {
        fields.systemPrompt.value = defaults.systemPrompt;
        fields.noAnswerMessage.value = defaults.noAnswerMessage;
        fields.noAnswerMessage.dispatchEvent(new Event("input"));
        checkChanged();
      } }, "Reset text to defaults")),
  );

  const versionList = h("div", { class: "card" },
    h("h2", {}, "Saved versions"),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Version"), h("th", {}, "Model"), h("th", {}, "Settings"), h("th", {}, "Saved"), h("th", {}, ""))),
      h("tbody", {}, versions.map((v) => h("tr", {},
        h("td", {}, h("strong", {}, `v${v.versionNo}`), v.label ? ` ${v.label}` : ""),
        h("td", { class: "small" }, session.models.find((m) => m.id === v.settings.model)?.label.split(" (")[0] ?? v.settings.model),
        h("td", { class: "small muted" }, `effort ${v.settings.effort} · ${v.settings.topK} passages · max ${v.settings.maxTokens} tokens`),
        h("td", { class: "small" }, when(v.createdAt)),
        h("td", {}, h("div", { class: "row" },
          h("button", { class: "link-button", onclick: () => showDialog(
            h("h2", {}, `Version ${v.versionNo}${v.label ? `: ${v.label}` : ""}`),
            h("h3", {}, "System instructions"), h("div", { class: "rules" }, v.settings.systemPrompt),
            h("h3", { style: "margin-top:1rem" }, "No-answer message"), h("div", { class: "rules" }, v.settings.noAnswerMessage),
            h("p", { class: "small muted", style: "margin-top:1rem" }, `${v.settings.model} · effort ${v.settings.effort} · ${v.settings.topK} passages · max ${v.settings.maxTokens} tokens`)) }, "View"),
          h("button", { class: "link-button", onclick: () => {
            Object.entries(v.settings).forEach(([k, val]) => { if (fields[k]) fields[k].value = val; });
            fields.noAnswerMessage.dispatchEvent(new Event("input"));
            checkChanged();
            toast(`Loaded version ${v.versionNo} into the editor.`);
            form.scrollIntoView({ behavior: "smooth" });
          } }, "Load"),
          h("a", { class: "link-button", href: `#/p/${projectId}/chat/new/${v.id}` }, "Chat")))))))),
  );

  fill(body, ...setupNotices(), form, versionList);
}

// ---------- test chat ----------

async function chatTab(body, projectId, _overview, extra = []) {
  const [convParam, versionParam] = extra;
  const [{ conversations }, { versions }] = await Promise.all([
    api("GET", `/api/projects/${projectId}/conversations`),
    api("GET", `/api/projects/${projectId}/bot`),
  ]);

  if (convParam === "new") {
    const { conversation } = await api("POST", `/api/projects/${projectId}/conversations`, { botVersionId: versionParam || versions[0]?.id });
    location.replace(`#/p/${projectId}/chat/${conversation.id}`);
    return;
  }

  const versionSelect = h("select", { id: "chat-version", "aria-label": "Bot version for a new chat" },
    versions.map((v) => h("option", { value: v.id }, `v${v.versionNo}${v.label ? ` – ${v.label}` : ""}`)));
  const list = h("div", { class: "card conv-list" },
    h("label", { for: "chat-version", class: "small" }, "New chat with"),
    versionSelect,
    h("button", { class: "primary new", style: "margin-top:0.5rem", onclick: () => (location.hash = `#/p/${projectId}/chat/new/${versionSelect.value}`) }, "Start new chat"),
    h("hr", { style: "border:none;border-top:1px solid var(--border)" }),
    conversations.length
      ? conversations.map((c) => h("a", { class: `conv-item ${c.id === convParam ? "active" : ""}`, href: `#/p/${projectId}/chat/${c.id}` },
          h("div", {}, c.title),
          h("div", { class: "meta" }, `v${c.versionNo ?? "?"} · ${plural(c.messageCount, "message")} · ${when(c.updatedAt)}`)))
      : h("p", { class: "muted small" }, "No conversations yet."),
  );

  const pane = h("div", { class: "card chat-pane" });
  fill(body, ...setupNotices(), h("div", { class: "chat-layout" }, list, pane));

  const selected = convParam || conversations[0]?.id;
  if (!selected) {
    pane.append(h("div", { class: "empty" }, h("p", {}, "Start a chat to test your bot."), h("p", { class: "small" }, "You type as the user and the bot answers live. Conversations are saved as “hand-written” interactions for analysis later.")));
    return;
  }
  if (!convParam) {
    location.replace(`#/p/${projectId}/chat/${selected}`);
    return;
  }
  await conversationPane(pane, projectId, selected);
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
  return h("div", { class: "msg assistant" },
    h("div", { class: "bubble" }, m.text),
    h("div", { class: "details" },
      ...badges,
      meta.searchMode ? h("span", {}, `${meta.searchMode === "meaning" ? "meaning" : "keyword"} search`) : null,
      meta.latencyMs ? h("span", {}, `${(meta.latencyMs / 1000).toFixed(1)} s`) : null,
      meta.costUsd !== undefined ? h("span", {}, money(meta.costUsd)) : null),
    h("details", {},
      h("summary", {}, `Passages given to the bot (${passages.length})`),
      passages.length ? passages.map(passageView) : h("p", { class: "small muted" }, "No passages matched this message.")));
}

async function conversationPane(pane, projectId, conversationId) {
  const { conversation, settings, messages } = await api("GET", `/api/conversations/${conversationId}`);
  const log = h("div", { class: "chat-log", "aria-live": "polite" }, messages.map(messageView));
  const typing = h("div", { class: "typing", hidden: true }, "The bot is answering…");
  const input = h("textarea", { id: "chat-text", placeholder: "Type as the user…", "aria-label": "Message", rows: 1 });
  const send = h("button", { class: "primary", type: "submit" }, "Send");
  const title = h("strong", {}, conversation.title);

  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    const done = busy(send, "Sending…");
    input.disabled = true;
    pane.querySelector(".chat-empty")?.remove();
    log.append(h("div", { class: "msg user pending" }, h("div", { class: "bubble" }, text)));
    typing.hidden = false;
    log.scrollTop = log.scrollHeight;
    try {
      const { messages: added } = await api("POST", `/api/conversations/${conversationId}/messages`, { text });
      log.querySelector(".msg.pending")?.remove();
      added.forEach((m) => log.append(messageView(m)));
      input.value = "";
    } catch (err) {
      log.querySelector(".msg.pending")?.remove();
      fail(err);
    } finally {
      typing.hidden = true;
      input.disabled = false;
      done();
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

  fill(pane, 
    h("div", { class: "chat-head row" },
      title,
      h("span", { class: "badge accent" }, conversation.source),
      h("span", { class: "small muted" }, settings ? `v${conversation.versionNo} · ${settings.model} · effort ${settings.effort}` : "bot version deleted"),
      h("span", { class: "spacer" }),
      h("button", { class: "link-button", onclick: async () => {
        const name = prompt("New title for this conversation:", conversation.title);
        if (!name) return;
        try {
          await api("PATCH", `/api/conversations/${conversationId}`, { title: name });
          route();
        } catch (err) {
          fail(err);
        }
      } }, "Rename"),
      h("button", { class: "link-button danger", onclick: async () => {
        if (!(await confirmDialog("Delete this conversation?"))) return;
        try {
          await api("DELETE", `/api/conversations/${conversationId}`);
          location.hash = `#/p/${projectId}/chat`;
        } catch (err) {
          fail(err);
        }
      } }, "Delete")),
    messages.length ? "" : h("div", { class: "empty chat-empty" }, "Say something to start."),
    log,
    typing,
    h("form", { class: "chat-input", onsubmit: (e) => { e.preventDefault(); submit(); } }, input, send),
  );
  log.scrollTop = log.scrollHeight;
  input.focus();
}

// ---------- routing ----------

async function route() {
  try {
    if (!session) {
      session = await api("GET", "/api/session");
      logoutButton.hidden = false;
    }
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "p" && parts[1]) await projectPage(parts[1], parts[2] || "overview", parts.slice(3));
    else await projectsPage();
    app.focus({ preventScroll: true });
  } catch (err) {
    if (err?.status === 404) {
      toast(err.message, "error");
      location.hash = "#/";
      return;
    }
    if (err?.status === 503 || err?.status === 500) {
      render(h("div", { class: "card" }, h("h1", {}, "The workbench is not ready"), h("p", {}, err.message), h("p", { class: "muted" }, "See DEPLOY.md for the setup steps.")));
      return;
    }
    fail(err);
  }
}

window.addEventListener("hashchange", route);
route();
