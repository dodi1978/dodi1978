// Stage 2 pages: personas, and creating and browsing interactions.

import { state, h, api, toast, fail, when, plural, fill, busy, confirmDialog, showDialog, messageView } from "./ui.js";

const SOURCE_LABELS = { simulated: "simulated", "hand-written": "hand-written", imported: "imported", real: "real user" };
const OUTCOME_LABELS = {
  goal_met: ["goal met", "ok"],
  answered: ["answered", "ok"],
  gave_up: ["gave up", "warn"],
  asked_for_human: ["asked for a human", "warn"],
  max_turns: ["hit the turn limit", ""],
  other: ["ended", ""],
  finished: ["ended by user", "ok"],
};

// Every interaction has one type. Real users are set apart from everything created in the workbench.
const TYPES = [
  ["real", "Real users", "real user"],
  ["simulated", "Simulated", "simulated"],
  ["single_question", "Test questions", "test question"],
  ["live", "Test chats", "test chat"],
  ["written", "Written", "written"],
  ["imported", "Imported", "imported"],
];

function kindOf(c) {
  return c.meta?.kind ?? (c.source === "hand-written" ? "live" : c.source);
}

function kindLabel(c) {
  return TYPES.find(([k]) => k === kindOf(c))?.[2] ?? SOURCE_LABELS[c.source] ?? c.source;
}

function kindBadge(c) {
  return h("span", { class: `badge kind kind-${kindOf(c)}` }, kindLabel(c));
}

function statusBadge(meta = {}) {
  if (meta.kind === "real" && !meta.endedAt) return h("span", { class: "badge", title: "The participant did not press End chat." }, "not ended");
  if (meta.status === "pending") return h("span", { class: "badge" }, "not run yet");
  if (meta.status === "running") return h("span", { class: "badge accent" }, "in progress");
  if (meta.status === "failed") return h("span", { class: "badge danger", title: meta.error || "" }, "failed");
  const [label, kind] = OUTCOME_LABELS[meta.outcome] ?? [];
  return label ? h("span", { class: `badge ${kind}` }, label) : null;
}

const SCENARIO_LABELS = { normal: "normal", asks_for_human: "asks for a human", gives_up: "gives up partway", misreads: "misreads a reply" };

// Personas made before scenario mixes existed carried percentages; show them for old conversations only.
function legacyBehaviourLine(b) {
  if (!b) return null;
  return `older setting: gives up ${b.giveUpPct ?? 0}% · asks for a human ${b.askHumanPct ?? 0}% · misreads ${b.misunderstandPct ?? 0}% of replies`;
}

function scenarioBadge(plan) {
  if (!plan?.scenario || plan.scenario === "normal") return null;
  return h("span", { class: "badge accent" }, SCENARIO_LABELS[plan.scenario] ?? plan.scenario);
}

function scenarioText(plan) {
  if (!plan) return null;
  const parts = [`${plan.minTurns}–${plan.turnLimit} user messages`];
  if (plan.scenario === "normal") parts.unshift("normal (no planned event)");
  if (plan.giveUpAtTurn) parts.push(`gives up before writing message ${plan.giveUpAtTurn}`);
  if (plan.askHumanAtTurn) parts.push(`asks for a human in message ${plan.askHumanAtTurn}`);
  if (plan.misreadAtTurn) parts.push(`misreads the bot's reply in message ${plan.misreadAtTurn}`);
  if (plan.misunderstandPct) parts.push(`older setting: ${plan.misunderstandPct}% chance of misreading each reply`);
  return parts.join(" · ");
}

// ---------- running batches of generated conversations ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Steps each conversation until it is finished, a few at a time, with progress.
async function runConversations(ids, { onProgress, shouldStop, concurrency = 3 }) {
  const queue = [...ids];
  let finished = 0;
  let failed = 0;
  let lastError = "";
  const report = () => onProgress({ finished, failed, total: ids.length, lastError });
  report();
  async function worker() {
    while (queue.length && !shouldStop()) {
      const id = queue.shift();
      let errors = 0;
      for (;;) {
        if (shouldStop()) return;
        try {
          const step = await api("POST", `/api/conversations/${id}/step`);
          if (step.done) {
            finished++;
            break;
          }
        } catch (err) {
          if (err.status === 401) throw err;
          lastError = err.message;
          errors++;
          if (err.status === 429) {
            await sleep(10_000);
            continue;
          }
          if (errors >= 2) {
            failed++;
            break;
          }
          await sleep(1500);
        }
      }
      report();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  report();
  return { finished, failed, stopped: shouldStop() };
}

function progressPanel() {
  const bar = h("span");
  const text = h("div", { class: "small muted" });
  let stop = false;
  const stopButton = h("button", { type: "button", onclick: () => {
    stop = true;
    stopButton.disabled = true;
    stopButton.textContent = "Stopping after the current step…";
  } }, "Stop");
  const el = h("div", { class: "card run-progress" }, h("div", { class: "progress", style: "margin-bottom:0.5rem" }, bar), text, h("div", { class: "row", style: "margin-top:0.6rem" }, stopButton));
  return {
    el,
    shouldStop: () => stop,
    onProgress({ finished, failed, total, lastError }) {
      bar.style.width = `${total ? Math.round(((finished + failed) / total) * 100) : 100}%`;
      text.textContent = `${finished} of ${total} finished${failed ? ` · ${failed} failed (${lastError})` : ""}`;
    },
  };
}

async function runWithProgress(container, ids, after) {
  const panel = progressPanel();
  container.prepend(panel.el);
  panel.el.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const result = await runConversations(ids, panel);
    toast(result.stopped ? "Stopped. You can continue the run later." : `Done: ${plural(result.finished, "conversation")} finished${result.failed ? `, ${result.failed} failed` : ""}.`, result.failed ? "error" : "");
  } catch (err) {
    fail(err);
  }
  after();
}

// ---------- personas ----------

const IMPORTANCE_LABELS = { "": "Not stated", low: "Low", medium: "Medium", high: "High" };

function rapportFields(framework, rapport = {}, extra = null) {
  const rows = framework.dimensions.map((d) => {
    const current = rapport[d.key] ?? {};
    const importance = h("select", { id: `pr-${d.key}-imp`, "aria-label": `${d.name}: importance` },
      Object.entries(IMPORTANCE_LABELS).map(([v, l]) => h("option", { value: v, selected: (current.importance ?? "") === v }, l)));
    const note = h("input", { id: `pr-${d.key}-note`, value: current.note ?? "", placeholder: "What this user needs or reacts to", "aria-label": `${d.name}: note` });
    const evidence = current.evidence?.length
      ? h("details", { class: "evidence" }, h("summary", {}, plural(current.evidence.length, "supporting quote")), h("ul", {}, current.evidence.map((q) => h("li", {}, `“${q}”`))))
      : null;
    return { key: d.key, importance, note, evidence: current.evidence, el: h("div", { class: "rapport-row" },
      h("div", {}, h("strong", {}, d.name), d.definition ? h("div", { class: "hint" }, d.definition) : null),
      importance, h("div", {}, note, evidence)) };
  });
  return {
    el: h("fieldset", { class: "field plain" },
      h("legend", {}, `Rapport needs (${framework.name}) `, extra),
      h("p", { class: "hint", style: "margin-top:0" }, "How much each dimension matters to this user, and what they need. Simulated users react to the bot in line with these, and rate each dimension at the end."),
      h("div", { class: "rapport-grid" }, rows.map((r) => r.el))),
    value: () => Object.fromEntries(rows.map((r) => [r.key, { importance: r.importance.value, note: r.note.value, ...(r.evidence ? { evidence: r.evidence } : {}) }])),
  };
}

// Builds the persona form. onSave gets the persona's fields; onCancel is optional.
// rapportExtra: something to show in the Rapport needs heading (the "Edit framework" link).
function personaFormElement(persona, framework, { onSave, onCancel, rapportExtra, title }) {
  const f = {
    name: h("input", { id: "pf-name", value: persona.name ?? "", maxlength: 120, required: true }),
    description: h("textarea", { id: "pf-desc", rows: 3 }, persona.description ?? ""),
    goal: h("textarea", { id: "pf-goal", rows: 2 }, persona.goal ?? ""),
    communicationStyle: h("textarea", { id: "pf-style", rows: 2 }, persona.communicationStyle ?? ""),
    languageBackground: h("input", { id: "pf-lang", value: persona.languageBackground ?? "" }),
    adversarial: h("input", { id: "pf-adv", type: "checkbox", checked: Boolean(persona.adversarial), style: "width:auto" }),
  };
  const rapport = framework.dimensions.length ? rapportFields(framework, persona.rapport, rapportExtra) : null;
  const save = h("button", { class: "primary", type: "submit" }, "Save persona");
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(save, "Saving…");
    try {
      await onSave({
        name: f.name.value, description: f.description.value, goal: f.goal.value,
        communicationStyle: f.communicationStyle.value, languageBackground: f.languageBackground.value,
        adversarial: f.adversarial.checked, rapport: rapport ? rapport.value() : {},
      });
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } },
    title ? h("h2", {}, title) : null,
    persona.source ? h("p", { class: "notice" }, persona.source) : null,
    h("div", { class: "field" }, h("label", { for: "pf-name" }, "Name"), f.name),
    h("div", { class: "field" }, h("label", { for: "pf-desc" }, "Who they are"), f.description),
    h("div", { class: "field" }, h("label", { for: "pf-goal" }, "Goal (optional)"), f.goal,
      h("div", { class: "hint" }, "Leave empty and each conversation picks a realistic goal from your documents, so conversations vary.")),
    h("div", { class: "grid-2" },
      h("div", { class: "field" }, h("label", { for: "pf-style" }, "How they write"), f.communicationStyle),
      h("div", { class: "field" }, h("label", { for: "pf-lang" }, "Language background"), f.languageBackground)),
    rapport?.el,
    h("div", { class: "field row" }, f.adversarial, h("label", { for: "pf-adv", style: "margin:0" }, "Adversarial (tries to break the bot)")),
    h("p", { class: "hint" }, "What happens in a simulated conversation (for example the user asking for a human) is set per run, under Create interactions → Simulate conversations."),
    h("div", { class: "row end" }, onCancel ? h("button", { type: "button", onclick: onCancel }, "Cancel") : null, save),
  );
  return { form, focus: () => f.name.focus() };
}

// Editing an existing persona happens in a dialog over the list.
function personaDialog(persona, framework, onSave) {
  const dialog = h("dialog", { class: "wide" });
  const { form, focus } = personaFormElement(persona, framework, {
    title: "Edit persona",
    onSave: async (data) => {
      await onSave(data);
      dialog.close();
    },
    onCancel: () => dialog.close(),
  });
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  focus();
}

function rapportSummary(p, framework) {
  const set = framework.dimensions.filter((d) => p.rapport?.[d.key]?.importance || p.rapport?.[d.key]?.note);
  if (!set.length) return null;
  return h("div", {},
    h("div", { class: "chips" }, set.map((d) => {
      const r = p.rapport[d.key];
      return h("span", { class: `chip imp-${r.importance || "none"}`, title: r.note || "" }, `${d.name}${r.importance ? ` · ${r.importance}` : ""}`);
    })),
    h("details", { class: "small" }, h("summary", {}, "Rapport needs in detail"),
      h("dl", { class: "rapport-detail" }, set.flatMap((d) => {
        const r = p.rapport[d.key];
        return [h("dt", {}, `${d.name}${r.importance ? ` (${r.importance})` : ""}`),
          h("dd", {}, r.note || h("span", { class: "muted" }, "No note."), r.evidence?.length ? h("ul", { class: "quotes" }, r.evidence.map((q) => h("li", {}, `“${q}”`))) : null)];
      }))));
}

// ---------- the rapport framework editor ----------

function frameworkDialog(projectId, data, reload) {
  const { framework, isDefault } = data;
  const dialog = h("dialog", { class: "wide" });
  const name = h("input", { id: "fw-name", value: framework.name });
  const list = h("div", { class: "fw-list" });
  const addDimension = (d = { name: "", definition: "", builds: [], breaks: [] }) => {
    const block = h("div", { class: "fw-dim", "data-key": d.key ?? "" },
      h("div", { class: "row" },
        h("input", { class: "fw-dim-name", value: d.name, placeholder: "Dimension name", "aria-label": "Dimension name", style: "flex:1;min-width:160px;font-weight:600" }),
        h("button", { type: "button", class: "link-button danger", onclick: () => block.remove() }, "Remove")),
      h("textarea", { class: "fw-def", rows: 2, placeholder: "Definition", "aria-label": "Definition" }, d.definition),
      h("div", { class: "grid-2" },
        h("div", {}, h("label", { class: "small" }, "Builds rapport (one per line)"), h("textarea", { class: "fw-builds", rows: 4 }, d.builds.join("\n"))),
        h("div", {}, h("label", { class: "small" }, "Breaks rapport (one per line)"), h("textarea", { class: "fw-breaks", rows: 4 }, d.breaks.join("\n")))));
    list.append(block);
  };
  framework.dimensions.forEach(addDimension);
  const save = h("button", { class: "primary", type: "submit" }, "Save framework");
  dialog.append(h("form", { onsubmit: async (e) => {
    e.preventDefault();
    const dimensions = [...list.querySelectorAll(".fw-dim")].map((b) => ({
      key: b.dataset.key || undefined,
      name: b.querySelector(".fw-dim-name").value,
      definition: b.querySelector(".fw-def").value,
      builds: b.querySelector(".fw-builds").value,
      breaks: b.querySelector(".fw-breaks").value,
    }));
    const done = busy(save, "Saving…");
    try {
      await api("PUT", `/api/projects/${projectId}/framework`, { framework: { name: name.value, dimensions } });
      toast("Framework saved.");
      dialog.close();
      reload();
    } catch (err) {
      fail(err);
      done();
    }
  } },
    h("h2", {}, "Rapport framework"),
    h("p", { class: "muted" }, "Personas in this project are described with these dimensions, and simulated users rate each one at the end of a conversation. Renaming a dimension keeps what personas say about it; removing one drops it from personas when they are next saved. Conversations keep the framework they were run with."),
    h("div", { class: "field" }, h("label", { for: "fw-name" }, "Framework name"), name),
    list,
    h("div", { class: "row", style: "margin-top:0.8rem" },
      h("button", { type: "button", onclick: () => addDimension() }, "+ Add dimension"),
      isDefault ? null : h("button", { type: "button", class: "link-button", onclick: async () => {
        if (!(await confirmDialog("Go back to the default GAAFFE taxonomy for this project?", "Reset"))) return;
        try {
          await api("PUT", `/api/projects/${projectId}/framework`, { reset: true });
          dialog.close();
          reload();
        } catch (err) {
          fail(err);
        }
      } }, "Reset to the GAAFFE taxonomy"),
      h("span", { class: "spacer" }),
      h("button", { type: "button", onclick: () => dialog.close() }, "Cancel"),
      save)));
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// ---------- importing personas ----------

function csvCell(v) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadTemplate(framework) {
  const header = ["Name", "Description", "Goal", "Communication style", "Language background",
    ...framework.dimensions.flatMap((d) => [`${d.name} importance`, `${d.name} note`, `${d.name} evidence`])];
  const example = ["Participant 1", "Retired nurse who lives alone", "", "Formal, full sentences", "English",
    ...framework.dimensions.flatMap((d, i) => [["high", "medium", "low"][i % 3], "", ""])];
  const blob = new Blob([`${header.map(csvCell).join(",")}\n${example.map(csvCell).join(",")}\n`], { type: "text/csv" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "persona-template.csv" });
  document.body.append(a);
  a.click();
  a.remove();
}

function spreadsheetImport(projectId, framework, reload) {
  const file = h("input", { type: "file", id: "pi-file", accept: ".csv,.xlsx" });
  const result = h("div");
  const check = h("button", { type: "submit" }, "Preview");
  let payload = null;
  return h("form", { onsubmit: async (e) => {
    e.preventDefault();
    const f = file.files[0];
    if (!f) return toast("Choose a file first.", "error");
    const done = busy(check, "Reading…");
    try {
      payload = { filename: f.name, contentBase64: await fileToBase64(f) };
      const preview = await api("POST", `/api/projects/${projectId}/personas/import`, { ...payload, dryRun: true });
      const go = h("button", { class: "primary", type: "button", onclick: async () => {
        const finish = busy(go, "Importing…");
        try {
          const { count } = await api("POST", `/api/projects/${projectId}/personas/import`, payload);
          toast(`Imported ${plural(count, "persona")}.`);
          reload();
        } catch (err) {
          fail(err);
          finish();
        }
      } }, `Import ${plural(preview.count, "persona")}`);
      fill(result,
        h("div", { class: "notice" }, `Found ${plural(preview.count, "persona")}.`),
        h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Column in your file"), h("th", {}, "Used as"))),
          h("tbody", {}, Object.entries(preview.mapping).map(([col, use]) => h("tr", {}, h("td", {}, col), h("td", {}, use)))))),
        preview.unmapped.length ? h("p", { class: "notice warn" }, `Not used (no matching field): ${preview.unmapped.join(", ")}. Rename these columns if they should be included.`) : null,
        h("p", { class: "small muted" }, `First ${plural(preview.preview.length, "persona")}:`),
        preview.preview.map((p) => h("div", { class: "card persona-card compact" }, h("strong", {}, p.name), p.description ? h("p", { class: "small" }, p.description) : null, rapportSummary(p, framework))),
        h("div", { class: "row" }, go));
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } },
    h("p", { class: "muted" }, "One row per persona or participant. Columns are matched by name: Name, Description, Goal, Communication style, Language background, and for each dimension either one column (for example “Autonomy”, holding a level or a note) or separate “Autonomy importance”, “Autonomy note” and “Autonomy evidence” columns. Levels can be words (low, medium, high) or numbers on any scale."),
    h("div", { class: "row" }, h("button", { type: "button", class: "link-button", onclick: () => downloadTemplate(framework) }, "Download a template (CSV)")),
    h("div", { class: "field" }, h("label", { for: "pi-file" }, "File (CSV or Excel)"), file),
    check,
    h("div", { style: "margin-top:1rem" }, result));
}

const PERSONA_PARTS = [["new", "New persona"], ["generate", "Generate from brief"], ["import", "Import a spreadsheet"]];

export async function personasTab(body, projectId, _overview, extra = []) {
  const part = PERSONA_PARTS.find(([k]) => k === extra[0])?.[0];
  if (!part) {
    location.replace(`#/p/${projectId}/personas/new`);
    return;
  }
  const [{ personas }, fw] = await Promise.all([
    api("GET", `/api/projects/${projectId}/personas`),
    api("GET", `/api/projects/${projectId}/framework`),
  ]);
  const framework = fw.framework;
  const reload = () => personasTab(body, projectId, _overview, extra).catch(fail);
  const subtabs = h("nav", { class: "subtabs", "aria-label": "Ways to add personas" },
    PERSONA_PARTS.map(([k, label]) => h("a", { href: `#/p/${projectId}/personas/${k}`, class: k === part ? "active" : "", "aria-current": k === part ? "page" : null }, label)));

  let panel;
  if (part === "new") {
    const editFramework = h("button", { type: "button", class: "link-button small", onclick: () => frameworkDialog(projectId, fw, reload) },
      fw.isDefault ? "Edit framework" : "Edit framework (edited for this project)");
    const { form } = personaFormElement({}, framework, {
      rapportExtra: editFramework,
      onSave: async (data) => {
        await api("POST", `/api/projects/${projectId}/personas`, data);
        toast("Persona created.");
        reload();
      },
    });
    const starter = h("button", { type: "button", onclick: async () => {
      const done = busy(starter, "Adding…");
      try {
        const { added } = await api("POST", `/api/projects/${projectId}/personas/starter`);
        toast(added ? `Added ${plural(added, "starter persona")}.` : "The starter personas are already here.");
        reload();
      } catch (err) {
        fail(err);
        done();
      }
    } }, "Add the starter set");
    panel = h("div", { class: "card" },
      h("h2", {}, "New persona"),
      h("p", { class: "muted" }, "Personas are the simulated users who talk to your bot. Describe one below, or add the ready-made starter set of eight (two of them adversarial) and edit those."),
      h("div", { class: "row", style: "margin-bottom:1rem" }, starter),
      form);
  } else if (part === "generate") {
    const brief = h("input", { id: "gen-brief", placeholder: "e.g. older adults applying for a bus pass, with mixed digital skills" });
    const genCount = h("select", { id: "gen-count", "aria-label": "How many" }, [1, 2, 3, 4, 5].map((n) => h("option", { value: n, selected: n === 3 }, n)));
    const genButton = h("button", { class: "primary", type: "submit" }, "Generate");
    panel = h("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault();
      const done = busy(genButton, "Generating…");
      try {
        const { personas: made } = await api("POST", `/api/projects/${projectId}/personas/generate`, { brief: brief.value, count: Number(genCount.value) });
        toast(`Created ${plural(made.length, "persona")}. Check and edit them below.`);
        reload();
      } catch (err) {
        fail(err);
        done();
      }
    } },
      h("h2", {}, "Generate from brief"),
      h("p", { class: "muted" }, "Describe the kind of users you need. The AI drafts personas, including their rapport needs, for you to check and edit."),
      h("div", { class: "row" }, h("div", { style: "flex:1;min-width:220px" }, h("label", { for: "gen-brief" }, "Brief"), brief), h("div", {}, h("label", { for: "gen-count" }, "How many"), genCount)),
      h("div", { class: "row", style: "margin-top:0.6rem" }, genButton));
  } else {
    panel = h("div", { class: "card" }, h("h2", {}, "Import a spreadsheet"), spreadsheetImport(projectId, framework, reload));
  }

  const cards = personas.map((p) => h("div", { class: "card persona-card" },
    h("div", { class: "row" }, h("strong", {}, p.name), p.adversarial ? h("span", { class: "badge danger" }, "adversarial") : null,
      p.source?.startsWith("Drafted by AI") || p.source?.startsWith("Generated by AI") ? h("span", { class: "badge warn", title: p.source }, "AI draft") : null,
      p.source?.startsWith("Imported") ? h("span", { class: "badge", title: p.source }, "imported") : null,
      h("span", { class: "spacer" }), h("span", { class: "small muted" }, plural(p.conversationCount, "conversation"))),
    p.description ? h("p", { style: "margin:0.4rem 0" }, p.description) : null,
    p.goal ? h("p", { class: "small" }, h("strong", {}, "Goal: "), p.goal) : null,
    p.communicationStyle ? h("p", { class: "small" }, h("strong", {}, "Writes: "), p.communicationStyle) : null,
    p.languageBackground ? h("p", { class: "small" }, h("strong", {}, "Language: "), p.languageBackground) : null,
    rapportSummary(p, framework),
    h("div", { class: "row" },
      h("button", { onclick: () => personaDialog(p, framework, async (data) => { await api("PATCH", `/api/personas/${p.id}`, data); toast("Persona saved."); reload(); }) }, "Edit"),
      h("button", { onclick: async () => { try { await api("POST", `/api/personas/${p.id}/duplicate`); reload(); } catch (err) { fail(err); } } }, "Duplicate"),
      h("button", { class: "link-button danger", onclick: async () => {
        if (!(await confirmDialog(`Delete the persona “${p.name}”? Conversations already run with it keep a copy of it.`))) return;
        try {
          await api("DELETE", `/api/personas/${p.id}`);
          reload();
        } catch (err) {
          fail(err);
        }
      } }, "Delete")),
  ));

  fill(body,
    subtabs,
    panel,
    h("h2", { class: "section-title" }, `Personas in this project (${personas.length})`),
    personas.length ? h("div", { class: "persona-grid" }, cards) : h("div", { class: "card empty" }, "No personas yet."),
  );
}

// ---------- create interactions: four panels ----------

function versionSelect(versions, id) {
  return h("select", { id }, versions.map((v) => h("option", { value: v.id }, `v${v.versionNo}${v.label ? ` – ${v.label}` : ""}`)));
}

function simulatePanel(ctx) {
  const { projectId, versions, personas, refresh, area } = ctx;
  if (!personas.length) return h("div", {}, h("p", {}, "You need personas first."), h("a", { class: "button", href: `#/p/${projectId}/personas` }, "Go to Personas"));
  const version = versionSelect(versions, "sim-version");
  const boxes = personas.map((p) => h("input", { type: "checkbox", value: p.id, id: `sim-p-${p.id}`, style: "width:auto", checked: !p.adversarial }));
  const count = h("input", { id: "sim-count", type: "number", min: 1, max: 100, value: Math.min(20, Math.max(4, boxes.filter((b) => b.checked).length)) });
  const minTurns = h("input", { id: "sim-min", type: "number", min: 1, max: 15, value: 2 });
  const maxTurns = h("input", { id: "sim-max", type: "number", min: 1, max: 15, value: 6 });
  const model = h("select", { id: "sim-model" }, state.session.models.map((m) => h("option", { value: m.id }, m.label)));
  const label = h("input", { id: "sim-label", placeholder: "Optional, e.g. Pilot run – warm tone" });
  const scen = {
    askHuman: h("input", { id: "sc-human", type: "number", min: 0, max: 100, value: 0 }),
    giveUp: h("input", { id: "sc-giveup", type: "number", min: 0, max: 100, value: 0 }),
    misread: h("input", { id: "sc-misread", type: "number", min: 0, max: 100, value: 0 }),
  };
  const normal = h("strong");
  const mixNote = h("span", { class: "small" });
  const updateMix = () => {
    const total = Math.max(0, Number(count.value) || 0);
    const planned = Object.values(scen).reduce((n, el) => n + Math.max(0, Number(el.value) || 0), 0);
    normal.textContent = String(Math.max(0, total - planned));
    mixNote.textContent = planned > total ? ` The scenarios add up to more than ${total} conversations.` : "";
    mixNote.className = planned > total ? "small danger-text" : "small";
  };
  [count, ...Object.values(scen)].forEach((el) => el.addEventListener("input", updateMix));
  updateMix();
  const start = h("button", { class: "primary", type: "submit" }, "Run simulation");
  return h("form", { onsubmit: async (e) => {
    e.preventDefault();
    const personaIds = boxes.filter((b) => b.checked).map((b) => b.value);
    const done = busy(start, "Starting…");
    try {
      const { conversationIds } = await api("POST", `/api/projects/${projectId}/runs`, {
        kind: "simulated", botVersionId: version.value, personaIds, count: Number(count.value),
        minTurns: Number(minTurns.value), maxTurns: Number(maxTurns.value), simulatorModel: model.value, label: label.value,
        scenarios: { askHuman: Number(scen.askHuman.value), giveUp: Number(scen.giveUp.value), misread: Number(scen.misread.value) },
      });
      done();
      await runWithProgress(area, conversationIds, refresh);
    } catch (err) {
      fail(err);
      done();
    }
  } },
    h("p", { class: "muted" }, "An AI plays each persona and has a full conversation with your bot. Personas take turns in order: with 3 personas and 9 conversations, each has 3."),
    h("div", { class: "grid-2" },
      h("div", { class: "field" }, h("label", { for: "sim-version" }, "Bot version"), version),
      h("div", { class: "field" }, h("label", { for: "sim-model" }, "Model playing the users"), model)),
    h("fieldset", { class: "field plain" }, h("legend", {}, "Personas"),
      h("div", { class: "check-list" }, personas.map((p, i) => h("label", { class: "check", for: `sim-p-${p.id}` }, boxes[i], ` ${p.name}`, p.adversarial ? h("span", { class: "badge danger" }, "adversarial") : null)))),
    h("div", { class: "grid-4" },
      h("div", { class: "field" }, h("label", { for: "sim-count" }, "Conversations"), count),
      h("div", { class: "field" }, h("label", { for: "sim-min" }, "At least (user messages)"), minTurns),
      h("div", { class: "field" }, h("label", { for: "sim-max" }, "At most (user messages)"), maxTurns),
      h("div", { class: "field" }, h("label", { for: "sim-label" }, "Run name"), label)),
    h("fieldset", { class: "field plain" }, h("legend", {}, "Scenario mix"),
      h("p", { class: "hint", style: "margin-top:0" }, "How many of the conversations should include each event. They are spread at random across the personas, and the moment each happens is chosen at random within the conversation. Each conversation is recorded with its scenario, so you can later check whether your evals spot them."),
      h("div", { class: "grid-4" },
        h("div", {}, h("label", { for: "sc-human" }, "User asks for a human"), scen.askHuman),
        h("div", {}, h("label", { for: "sc-giveup" }, "User gives up partway"), scen.giveUp, h("div", { class: "hint" }, "Leaves without a word.")),
        h("div", {}, h("label", { for: "sc-misread" }, "User misreads a reply"), scen.misread),
        h("div", {}, h("label", {}, "Normal conversations"), h("div", { class: "mix-normal" }, normal), mixNote))),
    h("p", { class: "hint" }, "Each user message takes two AI calls (the user, then your bot), plus one for the satisfaction rating at the end. Watch the cost on the Overview page; you can stop a run at any time and continue it later."),
    start);
}

function questionsPanel(ctx) {
  const { projectId, versions, personas, refresh, area } = ctx;
  const count = h("input", { id: "q-count", type: "number", min: 1, max: 100, value: 10 });
  const out = h("input", { id: "q-out", type: "number", min: 0, max: 100, value: 20 });
  const persona = h("select", { id: "q-persona" }, h("option", { value: "" }, "A mix of users"), personas.map((p) => h("option", { value: p.id }, p.name)));
  const list = h("textarea", { id: "q-list", rows: 12, placeholder: "Generate questions, or type your own: one per line." });
  const version = versionSelect(versions, "q-version");
  let generated = [];
  const genButton = h("button", { type: "button", onclick: async () => {
    const done = busy(genButton, "Generating…");
    try {
      const wanted = Math.min(100, Math.max(1, Number(count.value) || 10));
      const existing = list.value.split("\n").map((l) => l.trim()).filter(Boolean);
      const fresh = [];
      while (fresh.length < wanted) {
        genButton.textContent = `Generating… ${fresh.length} of ${wanted}`;
        const { questions } = await api("POST", `/api/projects/${projectId}/questions/generate`, {
          count: Math.min(20, wanted - fresh.length), outOfScopePct: Number(out.value), personaId: persona.value || undefined,
          avoid: [...existing, ...fresh.map((q) => q.text)],
        });
        if (!questions.length) break;
        fresh.push(...questions);
      }
      generated = [...generated, ...fresh];
      list.value = [...existing, ...fresh.map((q) => q.text)].join("\n");
      toast(`Added ${plural(fresh.length, "question")}. Edit the list before running it.`);
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } }, "Generate questions");
  const run = h("button", { class: "primary", type: "submit" }, "Run through the bot");
  return h("form", { onsubmit: async (e) => {
    e.preventDefault();
    const byText = new Map(generated.map((q) => [q.text, q]));
    const questions = list.value.split("\n").map((l) => l.trim()).filter(Boolean).map((text) => ({
      text, inScope: byText.get(text)?.inScope, personaId: persona.value || undefined,
    }));
    const done = busy(run, "Starting…");
    try {
      const { conversationIds } = await api("POST", `/api/projects/${projectId}/runs`, { kind: "questions", botVersionId: version.value, questions });
      done();
      list.value = "";
      generated = [];
      await runWithProgress(area, conversationIds, refresh);
    } catch (err) {
      fail(err);
      done();
    }
  } },
    h("p", { class: "muted" }, "One-off questions, each answered by the bot as its own short conversation. Generated questions are marked as answerable from your documents or not, so you can check how the bot handles both."),
    h("div", { class: "grid-4" },
      h("div", { class: "field" }, h("label", { for: "q-count" }, "How many"), count),
      h("div", { class: "field" }, h("label", { for: "q-out" }, "Not answerable (%)"), out),
      h("div", { class: "field", style: "grid-column: span 2" }, h("label", { for: "q-persona" }, "Written as"), persona)),
    h("div", { class: "row" }, genButton),
    h("div", { class: "field", style: "margin-top:0.8rem" }, h("label", { for: "q-list" }, "Questions (one per line)"), list),
    h("div", { class: "row" }, h("label", { for: "q-version", style: "margin:0" }, "Bot version"), version, run));
}

function writePanel(ctx) {
  const { projectId, versions, personas } = ctx;
  const title = h("input", { id: "w-title", placeholder: "e.g. Bot invents a fee" });
  const persona = h("select", { id: "w-persona" }, h("option", { value: "" }, "None"), personas.map((p) => h("option", { value: p.id }, p.name)));
  const version = h("select", { id: "w-version" }, h("option", { value: "" }, "Not linked to a version"), versions.map((v) => h("option", { value: v.id }, `v${v.versionNo}${v.label ? ` – ${v.label}` : ""}`)));
  const note = h("input", { id: "w-note", placeholder: "Optional: what this conversation is meant to test" });
  const turns = h("div", { class: "turns" });
  const addTurn = (role, text = "") => {
    const select = h("select", { "aria-label": "Speaker" }, h("option", { value: "user", selected: role === "user" }, "User"), h("option", { value: "assistant", selected: role === "assistant" }, "Bot"));
    const area = h("textarea", { rows: 2, "aria-label": "Message" }, text);
    const row = h("div", { class: "turn-row" }, select, area, h("button", { type: "button", class: "link-button danger", onclick: () => row.remove() }, "Remove"));
    turns.append(row);
    area.focus();
  };
  addTurn("user");
  addTurn("assistant");
  const save = h("button", { class: "primary", type: "submit" }, "Save conversation");
  return h("form", { onsubmit: async (e) => {
    e.preventDefault();
    const messages = [...turns.children].map((row) => ({ role: row.querySelector("select").value, text: row.querySelector("textarea").value }));
    const done = busy(save, "Saving…");
    try {
      const { conversation } = await api("POST", `/api/projects/${projectId}/conversations/written`, {
        title: title.value, personaId: persona.value || undefined, botVersionId: version.value || undefined, note: note.value, messages,
      });
      toast("Conversation saved.");
      location.hash = `#/p/${projectId}/interactions/${conversation.id}`;
    } catch (err) {
      fail(err);
      done();
    }
  } },
    h("p", { class: "muted" }, "Write both sides yourself, for example a reply that is deliberately ungrounded, to check whether an eval catches it. To type only the user's side and let the bot answer, use Test chat."),
    h("div", { class: "grid-2" },
      h("div", { class: "field" }, h("label", { for: "w-title" }, "Title"), title),
      h("div", { class: "field" }, h("label", { for: "w-note" }, "Note"), note),
      h("div", { class: "field" }, h("label", { for: "w-persona" }, "Persona"), persona),
      h("div", { class: "field" }, h("label", { for: "w-version" }, "Bot version"), version)),
    h("label", {}, "Messages"),
    turns,
    h("div", { class: "row", style: "margin:0.6rem 0 1rem" },
      h("button", { type: "button", onclick: () => addTurn("user") }, "+ User message"),
      h("button", { type: "button", onclick: () => addTurn("assistant") }, "+ Bot message")),
    save);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function importPanel(ctx) {
  const { projectId, refresh } = ctx;
  let mode = "file";
  const file = h("input", { type: "file", id: "imp-file", accept: ".csv,.tsv,.xlsx,.txt" });
  const text = h("textarea", { id: "imp-text", rows: 10, placeholder: "User: When are bins collected?\nBot: Every Tuesday.\nUser: Thanks!\n---\nUser: How do I pay council tax?\nBot: You can pay online or by direct debit." });
  const label = h("input", { id: "imp-label", placeholder: "Optional name for this import" });
  const panes = {
    file: h("div", { class: "field" }, h("label", { for: "imp-file" }, "File"), file,
      h("div", { class: "hint" }, "CSV or Excel (.xlsx) with one row per message and columns for the conversation, the speaker and the text, for example conversation_id, role, text. Speakers such as user/customer and bot/agent are recognised. Or a text file in the format shown under Paste.")),
    paste: h("div", { class: "field" }, h("label", { for: "imp-text" }, "Transcript"), text,
      h("div", { class: "hint" }, "Start each message with “User:” or “Bot:”. Separate conversations with a line of three dashes (---).")),
  };
  const holder = h("div", {}, panes.file);
  const modes = [["file", "Upload a file"], ["paste", "Paste text"]].map(([key, name]) => h("button", { type: "button", "data-key": key, "aria-pressed": String(key === mode), onclick: () => {
    mode = key;
    modes.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === key)));
    fill(holder, panes[key]);
    fill(preview);
  } }, name));
  const preview = h("div");
  const payload = async () => {
    if (mode === "paste") return { text: text.value, label: label.value };
    const f = file.files[0];
    if (!f) throw new Error("Choose a file first.");
    if (f.size > 4 * 1024 * 1024) throw new Error("The file is over 4 MB. Split it into smaller files.");
    return { filename: f.name, contentBase64: await fileToBase64(f), label: label.value };
  };
  const check = h("button", { type: "submit" }, "Preview");
  return h("form", { onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(check, "Reading…");
    try {
      const body = await payload();
      const summary = await api("POST", `/api/projects/${projectId}/import`, { ...body, dryRun: true });
      const importButton = h("button", { class: "primary", type: "button", onclick: async () => {
        const finish = busy(importButton, "Importing…");
        try {
          const result = await api("POST", `/api/projects/${projectId}/import`, body);
          toast(`Imported ${plural(result.conversations, "conversation")}.`);
          refresh();
        } catch (err) {
          fail(err);
          finish();
        }
      } }, `Import ${plural(summary.conversations, "conversation")}`);
      fill(preview,
        h("div", { class: "notice" }, `Found ${plural(summary.conversations, "conversation")} with ${plural(summary.messages, "message")} in total. The first ones look like this:`),
        summary.preview.map((c) => h("div", { class: "card import-preview" },
          h("strong", {}, c.title || `Conversation ${c.key}`), c.persona ? h("span", { class: "small muted" }, ` · ${c.persona}`) : null,
          h("div", { class: "chat-log compact" }, c.messages.map((m) => messageView({ role: m.role, text: m.text, meta: {} }, { compact: true }))),
          c.more ? h("p", { class: "small muted" }, `…and ${plural(c.more, "more message")}`) : null)),
        h("div", { class: "row" }, importButton));
    } catch (err) {
      fail(err);
    } finally {
      done();
    }
  } },
    h("p", { class: "muted" }, "Bring in existing transcripts, for example from another chatbot or a published dataset. They are stored like any other conversation, labelled as imported."),
    h("div", { class: "segmented", role: "group", "aria-label": "How to import" }, modes),
    holder,
    h("div", { class: "field" }, h("label", { for: "imp-label" }, "Import name"), label),
    check,
    h("div", { style: "margin-top:1rem" }, preview));
}

// ---------- interactions page ----------

// The "Simulated interactions" tab: the four ways of creating interactions, and their runs.
// The four ways of creating interactions, as sub-tabs (each with its own address), and
// which runs belong under each.
const MAKERS = [
  ["simulate", "Simulate conversations", simulatePanel, "simulated"],
  ["questions", "Test questions", questionsPanel, "questions"],
  ["write", "Write a conversation", writePanel, null],
  ["import", "Import transcripts", importPanel, "import"],
];

export async function createTab(body, projectId, _overview, extra = []) {
  const maker = MAKERS.find(([k]) => k === extra[0]);
  if (!maker) {
    location.replace(`#/p/${projectId}/create/simulate`);
    return;
  }
  const [key, name, panel, runKind] = maker;
  const [{ runs: allRuns }, { personas }, { versions }] = await Promise.all([
    api("GET", `/api/projects/${projectId}/runs`),
    api("GET", `/api/projects/${projectId}/personas`),
    api("GET", `/api/projects/${projectId}/bot`),
  ]);
  const refresh = () => createTab(body, projectId, _overview, extra).catch(fail);
  const area = h("div");
  const ctx = { projectId, versions, personas, refresh, area };
  const subtabs = h("nav", { class: "subtabs", "aria-label": "Ways to create interactions" },
    MAKERS.map(([k, label]) => h("a", { href: `#/p/${projectId}/create/${k}`, class: k === key ? "active" : "", "aria-current": k === key ? "page" : null }, label)));
  const createCard = h("div", { class: "card" }, h("h2", {}, name), panel(ctx));

  // Runs of this kind (simulations, test questions or imports).
  const runs = runKind ? allRuns.filter((r) => r.kind === runKind && (r.kind !== "import" || r.total)) : [];
  const runRows = runs.map((r) => h("tr", {},
    h("td", {}, h("a", { href: `#/p/${projectId}/interactions?runId=${r.id}` }, r.label)),
    h("td", { class: "small" }, { simulated: "simulation", questions: "test questions", import: "import" }[r.kind] ?? r.kind),
    h("td", { class: "small" }, `${r.done} of ${r.total} finished${r.failed ? `, ${r.failed} failed` : ""}`),
    h("td", { class: "small" }, when(r.createdAt)),
    h("td", {}, h("div", { class: "row" },
      r.pendingIds.length ? h("button", { onclick: (e) => { e.target.disabled = true; runWithProgress(area, r.pendingIds, refresh); } }, `Continue (${r.pendingIds.length} left)`) : null,
      h("button", { class: "link-button danger", onclick: async () => {
        if (!(await confirmDialog(`Delete “${r.label}” and its ${plural(r.total, "conversation")}?`))) return;
        try {
          await api("DELETE", `/api/runs/${r.id}`);
          refresh();
        } catch (err) {
          fail(err);
        }
      } }, "Delete")))));
  const runsTitle = { simulated: "Simulation runs", questions: "Test question runs", import: "Imports" }[runKind];
  const runsCard = runs.length ? h("div", { class: "card" }, h("h2", {}, runsTitle),
    h("p", { class: "small muted" }, "Click one to see its conversations under Interactions. Everything you create is collected there."),
    h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Kind"), h("th", {}, "Progress"), h("th", {}, "Started"), h("th", {}, ""))),
      h("tbody", {}, runRows)))) : null;

  fill(body, subtabs, createCard, area, runsCard);
}

// The "Interactions" tab: everything collected, from every source, with filters.
export async function interactionsTab(body, projectId, _overview, extra = []) {
  if (extra[0]) return conversationDetail(body, projectId, extra[0]);
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const query = new URLSearchParams([...params].filter(([, v]) => v));
  const [{ conversations }, all, { runs }, { personas }, { versions }] = await Promise.all([
    api("GET", `/api/projects/${projectId}/conversations?${query}`),
    query.toString() ? api("GET", `/api/projects/${projectId}/conversations`) : null,
    api("GET", `/api/projects/${projectId}/runs`),
    api("GET", `/api/projects/${projectId}/personas`),
    api("GET", `/api/projects/${projectId}/bot`),
  ]);
  const everything = all?.conversations ?? conversations;

  // Filters and list
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    location.hash = `#/p/${projectId}/interactions${next.toString() ? `?${next}` : ""}`;
  };
  const filterSelect = (key, label, options) => h("div", { class: "field" }, h("label", { for: `f-${key}` }, label),
    h("select", { id: `f-${key}`, onchange: (e) => setFilter(key, e.target.value) }, h("option", { value: "" }, "All"), options.map(([v, l]) => h("option", { value: v, selected: params.get(key) === v }, l))));
  const filters = h("div", { class: "grid-4 filters" },
    filterSelect("kind", "Type", TYPES.map(([k, l]) => [k, l])),
    filterSelect("personaId", "Persona", personas.map((p) => [p.id, p.name])),
    filterSelect("versionId", "Bot version", versions.map((v) => [v.id, `v${v.versionNo}${v.label ? ` – ${v.label}` : ""}`])),
    filterSelect("runId", "Run", runs.map((r) => [r.id, r.label])),
    filterSelect("scenario", "Scenario", Object.entries(SCENARIO_LABELS)));
  const rows = conversations.map((c) => h("tr", { class: "clickable", onclick: () => (location.hash = `#/p/${projectId}/interactions/${c.id}`) },
    h("td", {}, h("a", { href: `#/p/${projectId}/interactions/${c.id}`, onclick: (e) => e.stopPropagation() }, c.title || "(untitled)")),
    h("td", {}, kindBadge(c)),
    h("td", { class: "small" }, c.meta?.personaName ?? ""),
    h("td", { class: "small" }, c.versionNo ? `v${c.versionNo}` : ""),
    h("td", { class: "small" }, c.messageCount),
    h("td", {}, scenarioBadge(c.meta?.plan)),
    h("td", {}, statusBadge(c.meta)),
    h("td", { class: "small" }, c.meta?.rating ? `${c.meta.rating.score}/5` : ""),
    h("td", { class: "small" }, when(c.createdAt))));
  // Counts per type, which double as a quick filter.
  const counts = Object.fromEntries(TYPES.map(([k]) => [k, everything.filter((c) => kindOf(c) === k).length]));
  const created = everything.length - counts.real;
  const chip = (key, label, n, extraClass = "") => h("button", {
    type: "button", class: `type-chip ${extraClass} ${(params.get("kind") || "") === key ? "active" : ""}`, "aria-pressed": String((params.get("kind") || "") === key),
    onclick: () => setFilter("kind", key),
  }, label, h("span", { class: "count" }, n));
  const summary = h("div", { class: "type-summary" },
    chip("", "All", everything.length),
    h("span", { class: "type-group" }, chip("real", "Real users", counts.real, "kind-real")),
    h("span", { class: "type-group created" },
      h("span", { class: "group-label" }, `Created in the workbench (${created})`),
      TYPES.slice(1).map(([k, l]) => chip(k, l, counts[k], `kind-${k}`))));

  const listCard = h("div", { class: "card" },
    h("div", { class: "row" }, h("h2", { style: "margin:0" }, `Interactions (${conversations.length})`), h("span", { class: "spacer" }), query.toString() ? h("a", { href: `#/p/${projectId}/interactions` }, "Clear filters") : null),
    summary,
    filters,
    conversations.length
      ? h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Title"), h("th", {}, "Type"), h("th", {}, "Persona"), h("th", {}, "Bot"), h("th", {}, "Messages"), h("th", {}, "Scenario"), h("th", {}, "Outcome"), h("th", {}, "Rating"), h("th", {}, "Created"))),
          h("tbody", {}, rows)))
      : h("p", { class: "empty" }, query.toString() ? "No interactions match these filters." : "No interactions yet. Create some under Create interactions, chat in Test chat, or share the chat link with real users."));

  fill(body, listCard);
}

async function conversationDetail(body, projectId, conversationId) {
  const { conversation: c, settings, messages } = await api("GET", `/api/conversations/${conversationId}`);
  const meta = c.meta ?? {};
  const facts = [];
  const fact = (label, value) => value !== undefined && value !== null && value !== "" && facts.push(h("div", { class: "fact" }, h("div", { class: "label" }, label), h("div", {}, value)));
  fact("Type", kindBadge(c));
  fact("Persona", meta.personaName);
  fact("Bot version", c.versionNo ? `v${c.versionNo}${settings?.model ? ` · ${settings.model}` : ""}` : null);
  fact("Run", c.runLabel);
  fact("Goal", meta.goal);
  fact("Question", meta.kind === "single_question" ? (meta.inScope === true ? "answerable from the documents" : meta.inScope === false ? "not answerable from the documents" : "your own question") : null);
  fact("Outcome", statusBadge(meta));
  if (meta.rating) fact("Satisfaction (CSAT)", h("span", {}, h("strong", {}, `${meta.rating.score}/5`), ` “${meta.rating.comment}”`));
  const dims = meta.framework?.dimensions ?? [];
  const perception = meta.rapportPerception && dims.length
    ? h("div", { class: "perception" },
        h("h3", {}, "Rapport as the simulated user experienced it"),
        h("div", { class: "table-wrap" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Dimension"), h("th", {}, "Need"), h("th", {}, "Score (1–5)"), h("th", {}, "In their words"))),
          h("tbody", {}, dims.filter((d) => meta.rapportPerception[d.key]).map((d) => {
            const r = meta.rapportPerception[d.key];
            const need = meta.persona?.rapport?.[d.key]?.importance;
            return h("tr", {}, h("td", {}, h("strong", {}, d.name)), h("td", { class: "small" }, need || "–"),
              h("td", {}, h("span", { class: `score s${r.score}` }, r.score)), h("td", { class: "small" }, `“${r.comment}”`));
          })))),
        h("p", { class: "hint" }, `Framework: ${meta.framework.name}. These are the simulated user's own perceptions, not an evaluation.`))
    : null;
  if (meta.plan) fact("Scenario (planned)", scenarioText(meta.plan));
  fact("Note", meta.note);
  if (meta.kind === "real") {
    fact("Consent", meta.consentAt ? `given ${when(meta.consentAt)}` : "no consent screen");
    fact("Ended", meta.endedAt ? when(meta.endedAt) : "not ended (the participant left without pressing End chat)");
    if (meta.ratingSkipped) fact("Satisfaction (CSAT)", "skipped by the participant");
  }
  if (meta.error) fact("Last error", h("span", { class: "badge danger" }, meta.error));

  const transcript = messages.map((m) => {
    const view = messageView(m);
    const flags = [];
    if (m.meta?.misunderstanding) flags.push(h("span", { class: "badge warn" }, "planned misreading"));
    if (m.meta?.askedForHuman) flags.push(h("span", { class: "badge warn" }, "asks for a human"));
    if (flags.length) view.append(h("div", { class: "details flags" }, flags));
    return view;
  });

  fill(body,
    h("p", {}, h("a", { href: `#/p/${projectId}/interactions` }, "← All interactions")),
    h("div", { class: "card" },
      h("div", { class: "row" }, h("h2", { style: "margin:0" }, c.title || "(untitled)"), h("span", { class: "spacer" }),
        meta.kind === "live" ? h("a", { class: "button", href: `#/p/${projectId}/chat/test/${c.id}` }, "Continue in Test chat") : null,
        h("button", { class: "link-button danger", onclick: async () => {
          if (!(await confirmDialog("Delete this conversation?"))) return;
          try {
            await api("DELETE", `/api/conversations/${c.id}`);
            location.hash = `#/p/${projectId}/interactions`;
          } catch (err) {
            fail(err);
          }
        } }, "Delete")),
      h("div", { class: "facts" }, facts),
      perception,
      meta.persona ? h("details", {}, h("summary", {}, "Persona as used in this conversation"),
        h("div", { class: "rules" }, [meta.persona.description, meta.persona.communicationStyle && `Writes: ${meta.persona.communicationStyle}`, meta.persona.languageBackground && `Language: ${meta.persona.languageBackground}`, legacyBehaviourLine(meta.persona.behaviour),
          ...dims.filter((d) => meta.persona.rapport?.[d.key]).map((d) => `${d.name}: ${meta.persona.rapport[d.key].importance || "importance not stated"}${meta.persona.rapport[d.key].note ? ` – ${meta.persona.rapport[d.key].note}` : ""}`)].filter(Boolean).join("\n"))) : null),
    h("div", { class: "card chat-pane" }, h("div", { class: "chat-log tall" }, transcript.length ? transcript : h("p", { class: "empty" }, "No messages yet."))),
  );
}
