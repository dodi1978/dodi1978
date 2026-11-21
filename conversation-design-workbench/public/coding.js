// Stage 3 pages: the codebook, coding by hand, AI coding and agreement.

import { state, h, api, toast, fail, plural, fill, busy, confirmDialog, messageView } from "./ui.js";

const PARTS = [["codebook", "Codebook"], ["hand", "Code by hand"], ["ai", "AI coding"], ["agreement", "Agreement"]];
const UNIT_SHORT = { user: "user messages", bot: "bot replies", pair: "bot replies (with the user message)", conversation: "whole conversations" };
const TYPE_FILTER = [["", "All types"], ["real", "Real users"], ["simulated", "Simulated"], ["single_question", "Test questions"], ["live", "Test chats"], ["written", "Written"], ["imported", "Imported"]];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The chosen codes travel with you between Code by hand and AI coding.
function subtabs(projectId, current, setId) {
  const codes = new URLSearchParams(location.hash.split("?")[1] || "").get("codes");
  const suffix = (key) => (codes && setId && (key === "hand" || key === "ai") ? `?codes=${encodeURIComponent(codes)}` : "");
  return h("nav", { class: "subtabs", "aria-label": "Coding sections" },
    PARTS.map(([key, label]) => h("a", { href: `#/p/${projectId}/coding/${key}${setId && key !== "codebook" ? `/${setId}` : ""}${suffix(key)}`, class: key === current ? "active" : "", "aria-current": key === current ? "page" : null }, label)));
}

function query() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

function go(projectId, part, setId, params) {
  const qs = params && [...params].some(([, v]) => v) ? `?${new URLSearchParams([...params].filter(([, v]) => v))}` : "";
  location.hash = `#/p/${projectId}/coding/${part}${setId ? `/${setId}` : ""}${qs}`;
}

// ---------- category hierarchies ----------

function ancestors(options, value) {
  const out = [];
  let o = options.find((x) => x.value === value);
  while (o?.parent && out.length < 10) {
    out.push(o.parent);
    o = options.find((x) => x.value === o.parent);
  }
  return out;
}

function depthOf(options, value) {
  return ancestors(options, value).length;
}

const hasHierarchy = (code) => Boolean(code.options?.some((o) => o.parent));

// "Direct › 1 Mood derivable" for subordinate categories.
function optionPath(code, value) {
  const label = (v) => code.options.find((o) => o.value === v)?.label ?? v;
  return [...ancestors(code.options, value).reverse(), value].map(label).join(" › ");
}

export function formatValue(code, value) {
  if (value === undefined || value === null) return "–";
  if (code.type === "yes_no") return value ? "Yes" : "No";
  if (code.type === "category") return optionPath(code, value);
  if (code.type === "multi") return value.length ? value.map((v) => optionPath(code, v)).join("; ") : "(none)";
  return String(value);
}

// codes: all codes of the set, so a condition on a superior category is met by its subordinates.
function conditionMet(code, values, codes = []) {
  if (!code.condition) return true;
  const parent = values[code.condition.codeKey];
  if (parent === undefined || parent === null) return false;
  const parentCode = codes.find((c) => c.key === code.condition.codeKey);
  const have = (Array.isArray(parent) ? parent.map(String) : [String(parent)])
    .flatMap((v) => (parentCode?.options ? [v, ...ancestors(parentCode.options, v)] : [v]));
  return code.condition.values.some((v) => have.includes(v));
}

// ---------- choosing which codes to use ----------

function selectedKeys(set, params) {
  const raw = (params.get("codes") || "").split(",").filter(Boolean);
  const valid = raw.filter((k) => set.codes.some((c) => c.key === k));
  return valid.length ? valid : null;
}

// The chosen codes plus the codes their conditions depend on, in codebook order.
function scoped(set, keys) {
  if (!keys) return set.codes;
  const want = new Set(keys);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of set.codes) {
      if (want.has(c.key) && c.condition && !want.has(c.condition.codeKey)) {
        want.add(c.condition.codeKey);
        grew = true;
      }
    }
  }
  return set.codes.filter((c) => want.has(c.key));
}

function codePicker(set, keys, onChange) {
  const chosen = new Set(keys ?? set.codes.map((c) => c.key));
  const needed = new Set(scoped(set, [...chosen]).map((c) => c.key));
  const boxes = set.codes.map((c) => {
    const autoAdded = !chosen.has(c.key) && needed.has(c.key);
    return h("label", { class: "check code-pick", title: c.definition || "" },
      h("input", { type: "checkbox", value: c.key, checked: chosen.has(c.key), style: "width:auto" }),
      ` ${c.name}`, autoAdded ? h("span", { class: "small muted" }, " (included: another code depends on it)") : null);
  });
  const apply = () => {
    const picked = boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
    onChange(picked.length === set.codes.length || !picked.length ? null : picked);
  };
  boxes.forEach((b) => b.querySelector("input").addEventListener("change", apply));
  const summary = keys ? `${keys.length} of ${set.codes.length} codes` : `all ${set.codes.length} codes`;
  return h("details", { class: "code-picker", open: Boolean(keys) || undefined },
    h("summary", {}, h("strong", {}, "Codes to use: "), summary),
    h("p", { class: "hint" }, "Choose which codes to work on. Your other codes on the same units are kept. Codes that another chosen code depends on are included automatically."),
    h("div", { class: "row", style: "margin-bottom:0.4rem" },
      h("button", { type: "button", class: "link-button small", onclick: () => onChange(null) }, "All codes"),
      h("button", { type: "button", class: "link-button small", onclick: () => { boxes.forEach((b) => (b.querySelector("input").checked = false)); } }, "Clear")),
    h("div", { class: "code-pick-list" }, boxes));
}

function withCodes(params, keys) {
  const next = new URLSearchParams(params);
  if (keys) next.set("codes", keys.join(","));
  else next.delete("codes");
  next.delete("unit");
  next.delete("offset");
  return next;
}

function setPicker(sets, current, onChange) {
  return h("div", { class: "field set-picker" }, h("label", { for: "set-pick" }, "Code set"),
    h("select", { id: "set-pick", onchange: (e) => onChange(e.target.value) },
      sets.map((s) => h("option", { value: s.id, selected: s.id === current }, `${s.name} (${UNIT_SHORT[s.appliesTo]})`))));
}

export async function codingTab(body, projectId, _overview, extra = []) {
  const part = PARTS.find(([k]) => k === extra[0])?.[0];
  if (!part) {
    location.replace(`#/p/${projectId}/coding/codebook`);
    return;
  }
  const { sets } = await api("GET", `/api/projects/${projectId}/code-sets`);
  const setId = extra[1];
  if (part === "codebook") return codebookPage(body, projectId, sets, setId);
  if (!sets.length) {
    fill(body, subtabs(projectId, part), h("div", { class: "card empty" }, h("p", {}, "There are no code sets yet."), h("a", { class: "button primary", href: `#/p/${projectId}/coding/codebook` }, "Set up the codebook")));
    return;
  }
  const set = sets.find((s) => s.id === setId);
  if (!set) {
    location.replace(`#/p/${projectId}/coding/${part}/${sets[0].id}${location.hash.includes("?") ? `?${location.hash.split("?")[1]}` : ""}`);
    return;
  }
  if (part === "hand") return handPage(body, projectId, sets, set);
  if (part === "ai") return aiPage(body, projectId, sets, set);
  return agreementPage(body, projectId, sets, set);
}

// ---------- codebook ----------

async function codebookPage(body, projectId, sets, setId) {
  if (setId) return setEditor(body, projectId, setId);
  const { presets } = await api("GET", `/api/projects/${projectId}/code-library`);
  const reload = () => codingTab(body, projectId, null, ["codebook"]).catch(fail);

  const setCards = sets.map((s) => h("div", { class: "card set-card" },
    h("div", { class: "row" }, h("a", { class: "set-title", href: `#/p/${projectId}/coding/codebook/${s.id}` }, s.name), h("span", { class: "spacer" }), h("span", { class: `badge unit-${s.appliesTo}` }, UNIT_SHORT[s.appliesTo])),
    h("p", { class: "small muted" }, `${plural(s.codes.length, "code")} · you have coded ${plural(s.humanUnits, "unit")}${s.examples ? ` (${s.examples} as examples)` : ""} · the AI has coded ${plural(s.aiUnits, "unit")}`),
    h("div", { class: "row" },
      h("a", { class: "button", href: `#/p/${projectId}/coding/codebook/${s.id}` }, "Edit codes"),
      h("a", { class: "button", href: `#/p/${projectId}/coding/hand/${s.id}` }, "Code by hand"),
      h("a", { class: "button", href: `#/p/${projectId}/coding/ai/${s.id}` }, "AI coding"),
      h("a", { class: "button", href: `#/p/${projectId}/coding/agreement/${s.id}` }, "Agreement"),
      h("span", { class: "spacer" }),
      h("button", { class: "link-button", onclick: async () => { try { await api("POST", `/api/code-sets/${s.id}/duplicate`); reload(); } catch (err) { fail(err); } } }, "Duplicate"),
      h("button", { class: "link-button danger", onclick: async () => {
        if (!(await confirmDialog(`Delete “${s.name}” with its codes and all coding done with it (yours and the AI's)? This cannot be undone.`))) return;
        try {
          await api("DELETE", `/api/code-sets/${s.id}`);
          reload();
        } catch (err) {
          fail(err);
        }
      } }, "Delete"))));

  const libCards = presets.map((p) => {
    const add = h("button", { class: "primary", onclick: async () => {
      const done = busy(add, "Adding…");
      try {
        const { set } = await api("POST", `/api/projects/${projectId}/code-library`, { preset: p.id });
        toast(`Added “${set.name}”.`);
        location.hash = `#/p/${projectId}/coding/codebook/${set.id}`;
      } catch (err) {
        fail(err);
        done();
      }
    } }, sets.some((s) => s.name === p.name) ? "Add another copy" : "Add to this project");
    return h("div", { class: "card set-card" },
      h("div", { class: "row" }, h("strong", {}, p.name), h("span", { class: "spacer" }), h("span", { class: `badge unit-${p.appliesTo}` }, UNIT_SHORT[p.appliesTo])),
      h("p", { class: "small" }, p.description),
      h("p", { class: "small muted" }, h("em", {}, p.source)),
      h("details", { class: "small" }, h("summary", {}, `${plural(p.codeCount, "code")}`), h("ul", {}, p.codeNames.map((n) => h("li", {}, n)))),
      h("div", { class: "row" }, add));
  });

  const name = h("input", { id: "ns-name", placeholder: "e.g. Emotion in user messages", maxlength: 200 });
  const applies = h("select", { id: "ns-applies" }, Object.entries(UNIT_SHORT).map(([k, l]) => h("option", { value: k }, l[0].toUpperCase() + l.slice(1))));
  const create = h("button", { type: "submit" }, "Create empty code set");
  const newForm = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    const done = busy(create, "Creating…");
    try {
      const { set } = await api("POST", `/api/projects/${projectId}/code-sets`, { name: name.value, appliesTo: applies.value });
      location.hash = `#/p/${projectId}/coding/codebook/${set.id}`;
    } catch (err) {
      fail(err);
      done();
    }
  } },
    h("h2", {}, "Your own code set"),
    h("p", { class: "muted" }, "Start an empty code set and add your own codes. A code set applies to one kind of unit."),
    h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { for: "ns-name" }, "Name"), name), h("div", { class: "field" }, h("label", { for: "ns-applies" }, "Codes apply to"), applies)),
    create);

  fill(body, subtabs(projectId, "codebook"),
    h("h2", { class: "section-title", style: "margin-top:0" }, `Code sets in this project (${sets.length})`),
    sets.length ? h("div", { class: "set-list" }, setCards) : h("p", { class: "muted" }, "No code sets yet. Add one from the library below, or create your own."),
    h("h2", { class: "section-title" }, "Library"),
    h("p", { class: "muted" }, "Ready-made code sets. Adding one copies it into this project, where you can change anything."),
    h("div", { class: "persona-grid" }, libCards),
    newForm);
}

function codeSummary(code, codes) {
  const parts = [state.codeTypes?.[code.type] ?? code.type];
  if (code.options) {
    const top = code.options.filter((o) => !o.parent).length;
    parts.push(hasHierarchy(code)
      ? `${code.options.length - top} categories under ${top} superior categories`
      : `${code.options.length} ${code.options.length === 1 ? "category" : "categories"}`);
  }
  if (code.scale) parts.push(`${code.scale.min}–${code.scale.max}`);
  if (code.condition) {
    const parent = codes.find((c) => c.key === code.condition.codeKey);
    parts.push(`only when ${parent?.name ?? code.condition.codeKey} is ${code.condition.values.map((v) => parent?.options?.find((o) => o.value === v)?.label ?? v).join(" or ")}`);
  }
  return parts.join(" · ");
}

async function setEditor(body, projectId, setId) {
  const { set, codeTypes } = await api("GET", `/api/code-sets/${setId}`);
  state.codeTypes = codeTypes;
  const reload = () => setEditor(body, projectId, setId).catch(fail);
  const name = h("input", { id: "se-name", value: set.name, maxlength: 200 });
  const description = h("textarea", { id: "se-desc", rows: 3 }, set.description);
  const model = h("select", { id: "se-model" }, state.session.models.map((m) => h("option", { value: m.id, selected: m.id === set.ai.model }, m.label)));
  const effort = h("select", { id: "se-effort" }, ["low", "medium", "high"].map((e) => h("option", { value: e, selected: e === set.ai.effort }, e)));
  const saveSet = h("button", { type: "submit" }, "Save");
  const editorHolder = h("div");

  const codeRows = set.codes.map((code, i) => h("div", { class: "code-row" },
    h("div", { class: "code-main" },
      h("strong", {}, code.name), code.version > 1 ? h("span", { class: "badge", title: "Changed since first created; coding from older versions is kept apart in Agreement." }, `v${code.version}`) : null,
      h("div", { class: "small muted" }, codeSummary(code, set.codes)),
      code.definition ? h("div", { class: "small" }, code.definition) : null),
    h("div", { class: "code-actions" },
      h("button", { class: "link-button", disabled: i === 0, "aria-label": `Move ${code.name} up`, onclick: async () => { try { await api("POST", `/api/codes/${code.id}/move`, { direction: "up" }); reload(); } catch (err) { fail(err); } } }, "↑"),
      h("button", { class: "link-button", disabled: i === set.codes.length - 1, "aria-label": `Move ${code.name} down`, onclick: async () => { try { await api("POST", `/api/codes/${code.id}/move`, { direction: "down" }); reload(); } catch (err) { fail(err); } } }, "↓"),
      h("button", { onclick: () => { fill(editorHolder, codeEditor(set, code, reload)); editorHolder.scrollIntoView({ behavior: "smooth" }); } }, "Edit"),
      h("button", { class: "link-button danger", onclick: async () => {
        if (!(await confirmDialog(`Delete the code “${code.name}” and all coding done with it?`))) return;
        try {
          await api("DELETE", `/api/codes/${code.id}`);
          reload();
        } catch (err) {
          fail(err);
        }
      } }, "Delete"))));

  fill(body, subtabs(projectId, "codebook"),
    h("p", {}, h("a", { href: `#/p/${projectId}/coding/codebook` }, "← All code sets")),
    h("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault();
      const done = busy(saveSet, "Saving…");
      try {
        await api("PATCH", `/api/code-sets/${setId}`, { name: name.value, description: description.value, ai: { model: model.value, effort: effort.value } });
        toast("Saved.");
        reload();
      } catch (err) {
        fail(err);
        done();
      }
    } },
      h("div", { class: "row" }, h("h2", { style: "margin:0" }, set.name), h("span", { class: "spacer" }), h("span", { class: `badge unit-${set.appliesTo}` }, `applies to ${UNIT_SHORT[set.appliesTo]}`)),
      set.source ? h("p", { class: "small muted" }, h("em", {}, set.source)) : null,
      h("div", { class: "field" }, h("label", { for: "se-name" }, "Name"), name),
      h("div", { class: "field" }, h("label", { for: "se-desc" }, "Description"), description, h("div", { class: "hint" }, "Shown to the AI as the introduction to the coding scheme.")),
      h("div", { class: "grid-2" },
        h("div", { class: "field" }, h("label", { for: "se-model" }, "AI coder model"), model),
        h("div", { class: "field" }, h("label", { for: "se-effort" }, "AI coder effort"), effort, h("div", { class: "hint" }, "Higher effort may code more carefully, but is slower and costs more."))),
      saveSet),
    h("div", { class: "card" },
      h("div", { class: "row" }, h("h2", { style: "margin:0" }, `Codes (${set.codes.length})`), h("span", { class: "spacer" }),
        h("button", { class: "primary", onclick: () => { fill(editorHolder, codeEditor(set, null, reload)); editorHolder.scrollIntoView({ behavior: "smooth" }); } }, "+ Add code")),
      set.codes.length ? h("div", { class: "code-list" }, codeRows) : h("p", { class: "muted" }, "No codes yet.")),
    editorHolder);
}

function codeEditor(set, code, reload) {
  const c = code ?? { name: "", definition: "", type: "category", options: [], instructions: "" };
  const name = h("input", { id: "ce-name", value: c.name, maxlength: 120, required: true });
  const definition = h("textarea", { id: "ce-def", rows: 3 }, c.definition);
  const type = h("select", { id: "ce-type" }, Object.entries(state.codeTypes).map(([k, l]) => h("option", { value: k, selected: k === c.type }, l)));
  const instructions = h("textarea", { id: "ce-instr", rows: 2, placeholder: "Optional: extra guidance for the AI, e.g. how to treat borderline cases" }, c.instructions ?? "");
  const optionList = h("div", { class: "option-list" });
  const labelOf = (value) => (c.options ?? []).find((o) => o.value === value)?.label ?? "";
  // The "Superior category" list offers the other categories by their current names;
  // it is refreshed whenever it is opened, so new or renamed categories appear.
  const fillParents = (select, row, current) => {
    const labels = [...optionList.querySelectorAll(".option-row")].filter((r) => r !== row)
      .map((r) => r.querySelector(".opt-label").value.trim()).filter(Boolean);
    fill(select, h("option", { value: "" }, "— none (top level) —"), labels.map((l) => h("option", { value: l, selected: l === current }, `under “${l}”`)));
    if (current && !labels.includes(current)) select.value = "";
  };
  const addOption = (o = { value: "", label: "", definition: "", parent: "" }) => {
    const parentSelect = h("select", { class: "opt-parent", "aria-label": "Superior category" });
    const row = h("div", { class: `option-row ${o.parent ? "is-sub" : ""}`, "data-value": o.value },
      h("input", { class: "opt-label", value: o.label, placeholder: "Category", "aria-label": "Category" }),
      h("input", { class: "opt-def", value: o.definition, placeholder: "Definition or example (optional)", "aria-label": "Definition" }),
      parentSelect,
      h("button", { type: "button", class: "link-button danger", onclick: () => row.remove() }, "Remove"));
    parentSelect.dataset.current = labelOf(o.parent) || o.parent || "";
    parentSelect.addEventListener("focus", () => fillParents(parentSelect, row, parentSelect.value || parentSelect.dataset.current));
    parentSelect.addEventListener("change", () => {
      parentSelect.dataset.current = parentSelect.value;
      row.classList.toggle("is-sub", Boolean(parentSelect.value));
    });
    optionList.append(row);
    fillParents(parentSelect, row, parentSelect.dataset.current);
  };
  (c.options ?? []).forEach(addOption);
  const scaleMin = h("input", { id: "ce-min", type: "number", min: 0, max: 9, value: c.scale?.min ?? 1 });
  const scaleMax = h("input", { id: "ce-max", type: "number", min: 1, max: 10, value: c.scale?.max ?? 5 });
  const minLabel = h("input", { id: "ce-minl", value: c.scale?.minLabel ?? "", placeholder: "e.g. Not at all" });
  const maxLabel = h("input", { id: "ce-maxl", value: c.scale?.maxLabel ?? "", placeholder: "e.g. Completely" });
  const parents = set.codes.filter((p) => p.key !== c.key && ["category", "multi", "yes_no"].includes(p.type));
  const condParent = h("select", { id: "ce-cond" }, h("option", { value: "" }, "Always"), parents.map((p) => h("option", { value: p.key, selected: c.condition?.codeKey === p.key }, `Only when “${p.name}” is…`)));
  const condValues = h("div", { class: "check-list" });
  const drawCondValues = () => {
    const parent = parents.find((p) => p.key === condParent.value);
    const opts = parent ? (parent.type === "yes_no" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : parent.options) : [];
    fill(condValues, opts.map((o) => h("label", { class: "check" }, h("input", { type: "checkbox", value: o.value, style: "width:auto", checked: c.condition?.codeKey === parent.key && c.condition.values.includes(o.value) }), ` ${o.label}`)));
  };
  condParent.addEventListener("change", drawCondValues);
  drawCondValues();
  const optionsBox = h("div", { class: "field" }, h("label", {}, "Categories"),
    h("div", { class: "hint", style: "margin:0 0 0.4rem" }, "To group categories, put subordinate categories under a superior one with the last menu in their row (up to three levels). Coders can then choose either level, and Agreement is also measured at the superior level."),
    optionList, h("button", { type: "button", onclick: () => addOption() }, "+ Category"));
  const scaleBox = h("div", { class: "grid-4" },
    h("div", { class: "field" }, h("label", { for: "ce-min" }, "From"), scaleMin), h("div", { class: "field" }, h("label", { for: "ce-minl" }, "meaning"), minLabel),
    h("div", { class: "field" }, h("label", { for: "ce-max" }, "To"), scaleMax), h("div", { class: "field" }, h("label", { for: "ce-maxl" }, "meaning"), maxLabel));
  // style.display, not the hidden attribute: the grid layout would override "hidden".
  const showType = () => {
    optionsBox.style.display = ["category", "multi"].includes(type.value) ? "" : "none";
    scaleBox.style.display = type.value === "scale" ? "" : "none";
  };
  type.addEventListener("change", showType);
  showType();
  const save = h("button", { class: "primary", type: "submit" }, code ? "Save code" : "Add code");
  const holder = h("form", { class: "card code-editor", onsubmit: async (e) => {
    e.preventDefault();
    const payload = {
      name: name.value, definition: definition.value, type: type.value, instructions: instructions.value,
      options: [...optionList.querySelectorAll(".option-row")].map((r) => ({
        value: r.dataset.value || undefined, label: r.querySelector(".opt-label").value, definition: r.querySelector(".opt-def").value,
        parent: r.querySelector(".opt-parent").value || r.querySelector(".opt-parent").dataset.current || "",
      })),
      scale: { min: Number(scaleMin.value), max: Number(scaleMax.value), minLabel: minLabel.value, maxLabel: maxLabel.value },
      condition: condParent.value ? { codeKey: condParent.value, values: [...condValues.querySelectorAll("input:checked")].map((i) => i.value) } : null,
    };
    if (payload.condition && !payload.condition.values.length) payload.condition = null;
    const done = busy(save, "Saving…");
    try {
      if (code) await api("PATCH", `/api/codes/${code.id}`, payload);
      else await api("POST", `/api/code-sets/${set.id}/codes`, payload);
      toast(code ? "Code saved." : "Code added.");
      reload();
    } catch (err) {
      fail(err);
      done();
    }
  } },
    h("h2", {}, code ? `Edit “${code.name}”` : "New code"),
    code && code.version >= 1 ? h("p", { class: "hint" }, "Changing the name, definition, type, categories, scale, condition or instructions makes a new version of the code. Existing coding is kept, and Agreement compares only coding done with the same version.") : null,
    h("div", { class: "grid-2" }, h("div", { class: "field" }, h("label", { for: "ce-name" }, "Name"), name), h("div", { class: "field" }, h("label", { for: "ce-type" }, "Result type"), type)),
    h("div", { class: "field" }, h("label", { for: "ce-def" }, "Definition"), definition),
    optionsBox,
    scaleBox,
    parents.length ? h("div", { class: "field" }, h("label", { for: "ce-cond" }, "Applies"), condParent, condValues) : null,
    h("div", { class: "field" }, h("label", { for: "ce-instr" }, "Instructions for the AI coder"), instructions),
    h("div", { class: "row end" }, h("button", { type: "button", onclick: () => holder.remove() }, "Cancel"), save));
  return holder;
}

// ---------- code by hand ----------

function filterBar(projectId, part, set, params, statusOptions) {
  const change = (key) => (e) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(key, e.target.value);
    else next.delete(key);
    next.delete("unit");
    go(projectId, part, set.id, next);
  };
  return h("div", { class: "grid-2 filters" },
    h("div", { class: "field" }, h("label", { for: "cf-kind" }, "Interactions"), h("select", { id: "cf-kind", onchange: change("kind") }, TYPE_FILTER.map(([v, l]) => h("option", { value: v, selected: (params.get("kind") || "") === v }, l)))),
    h("div", { class: "field" }, h("label", { for: "cf-status" }, "Show"), h("select", { id: "cf-status", onchange: change("status") }, statusOptions.map(([v, l]) => h("option", { value: v, selected: (params.get("status") ?? statusOptions[0][0]) === v }, l)))));
}

function codeControl(code, value, onChange) {
  const id = `cv-${code.key}`;
  const hint = code.definition ? h("div", { class: "hint" }, code.definition) : null;
  // Superior categories are shown in bold, with their subordinate categories indented under them.
  // Either level can be chosen: the most specific where possible, the superior one if that is all you can say.
  const choiceClass = (o) => {
    if (code.type === "yes_no") return "choice";
    const d = depthOf(code.options, o.value);
    const superior = code.options.some((x) => x.parent === o.value);
    return `choice level-${d}${superior ? " superior" : ""}`;
  };
  const hierarchyHint = hasHierarchy(code) ? h("div", { class: "hint" }, code.type === "multi"
    ? "Tick the most specific categories that apply. Tick a superior category (in bold) on its own only if none of its subordinate categories fits."
    : "Choose the most specific category that applies, or a superior category (in bold) if none of its subordinate categories fits.") : null;
  if (code.type === "category" || code.type === "yes_no") {
    const opts = code.type === "yes_no" ? [{ value: true, label: "Yes" }, { value: false, label: "No" }] : code.options;
    return h("fieldset", { class: "code-field" }, h("legend", {}, code.name), hint, hierarchyHint,
      h("div", { class: "choice-list" }, opts.map((o) => h("label", { class: choiceClass(o), title: o.definition || "" },
        h("input", { type: "radio", name: id, checked: value === o.value, onchange: () => onChange(o.value) }),
        h("span", {}, o.label, o.definition ? h("span", { class: "choice-def" }, o.definition) : null)))),
      value !== undefined ? h("button", { type: "button", class: "link-button small", onclick: () => onChange(undefined) }, "Clear") : null);
  }
  if (code.type === "multi") {
    const current = new Set(value ?? []);
    return h("fieldset", { class: "code-field" }, h("legend", {}, code.name), hint, hierarchyHint,
      h("div", { class: "choice-list" }, code.options.map((o) => h("label", { class: choiceClass(o), title: o.definition || "" },
        h("input", { type: "checkbox", checked: current.has(o.value), onchange: (e) => { if (e.target.checked) current.add(o.value); else current.delete(o.value); onChange([...current]); } }),
        h("span", {}, o.label, o.definition ? h("span", { class: "choice-def" }, o.definition) : null)))));
  }
  if (code.type === "scale") {
    const points = Array.from({ length: code.scale.max - code.scale.min + 1 }, (_, i) => code.scale.min + i);
    return h("fieldset", { class: "code-field" }, h("legend", {}, code.name), hint,
      h("div", { class: "scale-row" },
        code.scale.minLabel ? h("span", { class: "small muted" }, code.scale.minLabel) : null,
        points.map((n) => h("label", { class: "scale-point" }, h("input", { type: "radio", name: id, checked: value === n, onchange: () => onChange(n) }), h("span", {}, n))),
        code.scale.maxLabel ? h("span", { class: "small muted" }, code.scale.maxLabel) : null));
  }
  if (code.type === "number") {
    return h("div", { class: "code-field" }, h("label", { for: id }, code.name), hint, h("input", { id, type: "number", value: value ?? "", oninput: (e) => onChange(e.target.value === "" ? undefined : Number(e.target.value)) }));
  }
  return h("div", { class: "code-field" }, h("label", { for: id }, code.name), hint, h("textarea", { id, rows: 2, oninput: (e) => onChange(e.target.value || undefined) }, value ?? ""));
}

function unitPreview(unit) {
  if (unit.userText) return `${unit.userText} → ${unit.text}`;
  return unit.text;
}

async function handPage(body, projectId, sets, set) {
  const params = query();
  if (!params.has("status")) params.set("status", "not_coded_by_me");
  const keys = selectedKeys(set, params);
  const codes = scoped(set, keys);
  const offset = Number(params.get("offset")) || 0;
  const list = await api("GET", `/api/code-sets/${set.id}/units?${new URLSearchParams([...params].filter(([k]) => k !== "unit"))}&limit=50&offset=${offset}`);
  const unitId = params.get("unit") || list.units[0]?.unitId;
  const pane = h("div", { class: "card code-pane" });
  const unitList = h("div", { class: "card unit-list" },
    h("div", { class: "small muted", style: "margin-bottom:0.4rem" }, `${plural(list.total, "unit")}`),
    list.units.length
      ? list.units.map((u) => h("a", {
          class: `unit-item ${u.unitId === unitId ? "active" : ""}`,
          href: `#/p/${projectId}/coding/hand/${set.id}?${new URLSearchParams([...params, ["unit", u.unitId]].filter(([k, v]) => k !== "unit" || v === u.unitId))}`,
        },
          h("div", { class: "unit-text" }, unitPreview(u)),
          h("div", { class: "meta" }, Object.keys(u.human).length ? h("span", { class: "badge ok" }, "coded") : h("span", { class: "badge" }, "not coded"),
            Object.keys(u.ai).length ? h("span", { class: "badge accent" }, "AI") : null, u.isExample ? h("span", { class: "badge warn" }, "example") : null)))
      : h("p", { class: "muted small" }, "Nothing to show with these filters."),
    list.total > offset + 50 || offset ? h("div", { class: "row" },
      offset ? h("button", { onclick: () => { params.set("offset", Math.max(0, offset - 50)); go(projectId, "hand", set.id, params); } }, "Previous") : null,
      list.total > offset + 50 ? h("button", { onclick: () => { params.set("offset", offset + 50); go(projectId, "hand", set.id, params); } }, "Next") : null) : null);

  fill(body, subtabs(projectId, "hand", set.id),
    h("div", { class: "card" },
      h("div", { class: "grid-2" }, setPicker(sets, set.id, (id) => go(projectId, "hand", id, new URLSearchParams([["status", params.get("status")]]))),
        h("div", { class: "field" }, h("label", {}, "Unit"), h("div", { class: "muted small", style: "padding-top:0.5rem" }, `This set codes ${UNIT_SHORT[set.appliesTo]}. ${plural(set.codes.length, "code")}.`))),
      filterBar(projectId, "hand", set, params, [["not_coded_by_me", "Not yet coded by me (with these codes)"], ["coded_by_me", "Coded by me"], ["examples", "My examples for the AI"], ["coded_by_ai", "Coded by the AI"], ["", "All"]]),
      codePicker(set, keys, (k) => go(projectId, "hand", set.id, withCodes(params, k)))),
    h("div", { class: "coding-layout" }, unitList, pane));

  if (!set.codes.length) {
    fill(pane, h("p", {}, "This set has no codes yet. "), h("a", { href: `#/p/${projectId}/coding/codebook/${set.id}` }, "Add codes"));
    return;
  }
  if (!unitId) {
    fill(pane, h("div", { class: "empty" }, "Nothing to code with these filters."));
    return;
  }
  const unit = list.units.find((u) => u.unitId === unitId) ?? (await api("GET", `/api/code-sets/${set.id}/units?unitId=${encodeURIComponent(unitId)}`)).units[0];
  if (!unit) {
    fill(pane, h("p", {}, "That unit is not available."));
    return;
  }
  const { messages } = await api("GET", `/api/conversations/${unit.conversationId}`);

  // The unit in its conversation, with the unit highlighted.
  const targetIdx = set.appliesTo === "conversation" ? null : unit.idx;
  const context = h("div", { class: "chat-log context" }, messages.map((m) => {
    const view = messageView(m);
    const isTarget = targetIdx === null || m.idx === targetIdx || (set.appliesTo === "pair" && m.idx === targetIdx - 1);
    view.classList.add(isTarget ? "target" : "context-msg");
    view.querySelectorAll("details").forEach((d) => { if (!(m.idx === targetIdx)) d.remove(); });
    return view;
  }));

  const values = Object.fromEntries(Object.entries(unit.human).map(([k, v]) => [k, v.value]));
  const form = h("div", { class: "code-form" });
  let showAi = false;
  const drawForm = () => {
    fill(form, codes.map((code) => {
      if (!conditionMet(code, values, set.codes)) return null;
      const control = codeControl(code, values[code.key], (v) => {
        if (v === undefined) delete values[code.key];
        else values[code.key] = v;
        drawForm();
      });
      const ai = unit.ai[code.key];
      if (showAi && Object.keys(unit.ai).length) {
        control.append(h("div", { class: `ai-note ${ai && JSON.stringify(ai.value) === JSON.stringify(values[code.key]) ? "same" : ""}` },
          h("strong", {}, "AI: "), ai ? formatValue(code, ai.value) : "not applicable", ai?.explanation ? h("span", { class: "muted" }, ` – ${ai.explanation}`) : null));
      }
      return control;
    }));
  };
  drawForm();
  const example = h("input", { type: "checkbox", id: "cx-example", checked: unit.isExample, style: "width:auto" });
  const aiToggle = Object.keys(unit.ai).length ? h("label", { class: "check small" }, h("input", { type: "checkbox", style: "width:auto", onchange: (e) => { showAi = e.target.checked; drawForm(); } }), " Show the AI's codes") : null;
  const save = h("button", { class: "primary", type: "button", onclick: async () => {
    const done = busy(save, "Saving…");
    try {
      // Only the codes on screen are saved; your other codes on this unit stay as they are.
      await api("PUT", `/api/code-sets/${set.id}/units/${unit.unitId}`, { values, isExample: example.checked, codeKeys: codes.map((c) => c.key) });
      toast("Saved.");
      // Next: the following unit in the list (the saved one may drop out of a "not yet coded" list).
      const i = list.units.findIndex((u) => u.unitId === unit.unitId);
      const next = list.units[i + 1] ?? (params.get("status") === "not_coded_by_me" ? null : list.units[i]);
      const p = new URLSearchParams(params);
      if (next && next.unitId !== unit.unitId) p.set("unit", next.unitId);
      else p.delete("unit");
      go(projectId, "hand", set.id, p);
      if (`#/p/${projectId}/coding/hand/${set.id}?${p}` === location.hash) codingTab(body, projectId, null, ["hand", set.id]).catch(fail);
    } catch (err) {
      fail(err);
      done();
    }
  } }, "Save and next");

  fill(pane,
    h("div", { class: "row" }, h("strong", {}, unit.title), h("span", { class: "badge" }, unit.kind ?? unit.source), h("span", { class: "spacer" }), aiToggle),
    context,
    form,
    h("div", { class: "row code-save" },
      h("label", { class: "check", for: "cx-example" }, example, " Use as an example for the AI"),
      h("span", { class: "spacer" }), save),
    h("p", { class: "hint" }, "Examples show the AI how you apply the codes. Pick clear cases, and some borderline ones with a note in the codebook. The AI sees up to 8 of your most recent examples."));
}

// ---------- AI coding ----------

async function fetchUnitIds(setId, params, max) {
  const ids = [];
  let offset = 0;
  while (ids.length < max) {
    const page = await api("GET", `/api/code-sets/${setId}/units?${params}&limit=200&offset=${offset}`);
    ids.push(...page.units.map((u) => u.unitId));
    if (page.units.length < 200) break;
    offset += 200;
  }
  return ids.slice(0, max);
}

async function aiPage(body, projectId, sets, set) {
  const params = query();
  if (!params.has("status")) params.set("status", "not_coded_by_ai");
  const filterParams = new URLSearchParams([...params].filter(([k]) => ["kind", "status", "codes"].includes(k)));
  const keys = selectedKeys(set, params);
  const codeKeys = keys ? scoped(set, keys).map((c) => c.key) : undefined;
  const { total, units } = await api("GET", `/api/code-sets/${set.id}/units?${filterParams}&limit=1`);
  const count = h("input", { id: "ai-count", type: "number", min: 1, max: Math.max(1, total), value: Math.min(total, 20) });
  const estimateText = h("div", { class: "small muted" });
  const updateEstimate = async () => {
    const n = Math.min(Number(count.value) || 0, total);
    if (!n || !units[0]) {
      estimateText.textContent = "";
      return;
    }
    try {
      const e = await api("POST", `/api/code-sets/${set.id}/estimate`, { count: n, unitId: units[0].unitId, codeKeys });
      estimateText.textContent = `Estimated cost: about $${e.costUsd.toFixed(2)} for ${plural(n, "unit")} with ${e.model}. The AI will see ${e.exampleCount} of your example${e.exampleCount === 1 ? "" : "s"}.`;
    } catch {
      estimateText.textContent = "";
    }
  };
  count.addEventListener("change", updateEstimate);
  const progressHolder = h("div");
  const start = h("button", { class: "primary", type: "button", disabled: !total, onclick: async () => {
    const n = Math.min(Number(count.value) || 0, total);
    if (!n) return;
    start.disabled = true;
    const ids = await fetchUnitIds(set.id, filterParams, n);
    let finished = 0;
    let failed = 0;
    let lastError = "";
    let stop = false;
    const bar = h("span");
    const text = h("div", { class: "small muted" });
    const stopButton = h("button", { type: "button", onclick: () => { stop = true; stopButton.disabled = true; stopButton.textContent = "Stopping…"; } }, "Stop");
    fill(progressHolder, h("div", { class: "card run-progress" }, h("div", { class: "progress", style: "margin-bottom:0.5rem" }, bar), text, h("div", { class: "row", style: "margin-top:0.6rem" }, stopButton)));
    const report = () => {
      bar.style.width = `${Math.round(((finished + failed) / ids.length) * 100)}%`;
      text.textContent = `${finished} of ${ids.length} coded${failed ? ` · ${failed} failed (${lastError})` : ""}`;
    };
    report();
    const queue = [...ids];
    const worker = async () => {
      while (queue.length && !stop) {
        const id = queue.shift();
        for (let attempt = 0; ; attempt++) {
          try {
            await api("POST", `/api/code-sets/${set.id}/units/${id}/ai`, codeKeys ? { codeKeys } : {});
            finished++;
            break;
          } catch (err) {
            if (err.status === 401) throw err;
            lastError = err.message;
            if (err.status === 429) {
              await sleep(10_000);
              continue;
            }
            if (attempt >= 1) {
              failed++;
              break;
            }
            await sleep(1500);
          }
        }
        report();
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
      toast(stop ? "Stopped." : `AI coding finished: ${plural(finished, "unit")}${failed ? `, ${failed} failed` : ""}.`, failed ? "error" : "");
    } catch (err) {
      fail(err);
    }
    codingTab(body, projectId, null, ["ai", set.id]).catch(fail);
  } }, "Start AI coding");

  fill(body, subtabs(projectId, "ai", set.id),
    h("div", { class: "card" },
      setPicker(sets, set.id, (id) => go(projectId, "ai", id, filterParams)),
      h("p", { class: "muted" }, `The AI codes ${UNIT_SHORT[set.appliesTo]} with ${codeKeys ? `${plural(codeKeys.length, "code")} chosen from` : `the ${plural(set.codes.length, "code")} in`} this set, following the definitions and the examples you marked in Code by hand. It gives a short reason for each code. It does not see the interaction type, persona or scenario, only the conversation itself${set.appliesTo === "pair" || set.appliesTo === "bot" ? ", plus the passages and system instructions the bot had" : ""}.`),
      h("p", { class: "small" }, `AI coder: ${state.session.models.find((m) => m.id === set.ai.model)?.label ?? set.ai.model}, effort ${set.ai.effort}. `, h("a", { href: `#/p/${projectId}/coding/codebook/${set.id}` }, "Change")),
      filterBar(projectId, "ai", set, params, [["not_coded_by_ai", "Not yet coded by the AI (with these codes)"], ["coded_by_me", "Coded by me (to compare with the AI)"], ["", "All (re-code)"]]),
      codePicker(set, keys, (k) => go(projectId, "ai", set.id, withCodes(params, k))),
      h("p", {}, h("strong", {}, plural(total, "unit")), " match."),
      h("div", { class: "row" }, h("div", { class: "field", style: "max-width:160px;margin:0" }, h("label", { for: "ai-count" }, "How many to code"), count), start),
      estimateText,
      set.examples ? null : h("p", { class: "notice warn small" }, "You have not marked any examples yet. The AI will code from the definitions alone. For better agreement, code some units yourself and tick “Use as an example for the AI”.")),
    progressHolder);
  updateEstimate();
}

// ---------- agreement ----------

function kappaCell(r) {
  if (r.kappa === null || r.kappa === undefined) return h("span", { class: "muted" }, r.type === "comment" ? "not applicable" : "–");
  const cls = r.kappa > 0.6 ? "ok" : r.kappa > 0.4 ? "warn" : "danger";
  return h("span", {}, h("span", { class: `badge ${cls}` }, r.kappa.toFixed(2)), " ", h("span", { class: "small muted" }, r.interpretation + (r.weighted ? " (weighted)" : r.meanOverOptions ? " (mean over categories)" : "")),
    r.n < 20 ? h("div", { class: "small muted" }, "Few units: treat with caution.") : null);
}

async function agreementPage(body, projectId, sets, set) {
  const data = await api("GET", `/api/code-sets/${set.id}/agreement`);
  const reload = () => codingTab(body, projectId, null, ["agreement", set.id]).catch(fail);
  const codesByKey = Object.fromEntries(set.codes.map((c) => [c.key, c]));
  const rows = data.codes.map((r) => {
    const code = codesByKey[r.key];
    const detail = h("div", { class: "disagreements", hidden: true });
    const toggle = r.disagreements.length ? h("button", { class: "link-button small", onclick: () => { detail.hidden = !detail.hidden; } }, `${plural(r.disagreements.length, "disagreement")}`) : h("span", { class: "small muted" }, r.n ? "none" : "");
    fill(detail,
      r.perOption ? h("div", { class: "table-wrap" }, h("table", { class: "small" }, h("thead", {}, h("tr", {}, h("th", {}, "Category"), h("th", {}, "Agreement"), h("th", {}, "Kappa"))),
        h("tbody", {}, r.perOption.filter((o) => o.used).map((o) => h("tr", {}, h("td", {}, o.label), h("td", {}, `${Math.round(o.percentAgreement * 100)}%`), h("td", {}, kappaCell({ ...o, type: "category" }))))))) : null,
      r.disagreements.map((d) => h("div", { class: "disagreement" },
        h("div", { class: "unit-text" }, d.text),
        h("div", { class: "grid-2" },
          h("div", {}, h("div", { class: "fact-label" }, "You"), formatValue(code, d.human)),
          h("div", {}, h("div", { class: "fact-label" }, "AI"), formatValue(code, d.ai), d.explanation ? h("div", { class: "small muted" }, d.explanation) : null)),
        h("div", { class: "row" },
          h("a", { class: "button", href: `#/p/${projectId}/coding/hand/${set.id}?status=&unit=${d.unitId}` }, "Look again"),
          h("button", { onclick: async (e) => {
            const done = busy(e.target, "Saving…");
            try {
              await api("POST", `/api/code-sets/${set.id}/units/${d.unitId}/accept-ai`, { codeKey: r.key });
              toast("Changed your code to the AI's.");
              reload();
            } catch (err) {
              fail(err);
              done();
            }
          } }, "Accept the AI's code"),
          h("button", { onclick: async (e) => {
            try {
              await api("POST", `/api/code-sets/${set.id}/units/${d.unitId}/example`, { isExample: true });
              e.target.disabled = true;
              e.target.textContent = "Marked as example";
            } catch (err) {
              fail(err);
            }
          } }, "Keep mine, use as example")))));
    return [
      h("tr", {},
        h("td", {}, h("strong", {}, r.name), r.outdated ? h("div", { class: "small muted" }, `${r.outdated} coded with an older version, not counted`) : null),
        h("td", {}, r.n),
        h("td", {}, r.percentAgreement === null || r.percentAgreement === undefined ? "–" : `${Math.round(r.percentAgreement * 100)}%`),
        h("td", {}, kappaCell(r)),
        h("td", {}, toggle)),
      r.superior ? h("tr", { class: "superior-row" },
        h("td", {}, h("span", { class: "small" }, "↳ at the level of superior categories"), h("div", { class: "small muted" }, r.superior.categories.join(" / "))),
        h("td", {}, r.superior.n),
        h("td", {}, r.superior.percentAgreement === null || r.superior.percentAgreement === undefined ? "–" : `${Math.round(r.superior.percentAgreement * 100)}%`),
        h("td", {}, kappaCell({ ...r.superior, type: r.type })),
        h("td", {})) : null,
      h("tr", { class: "detail-row" }, h("td", { colspan: 5 }, detail)),
    ];
  });

  fill(body, subtabs(projectId, "agreement", set.id),
    h("div", { class: "card" },
      setPicker(sets, set.id, (id) => go(projectId, "agreement", id)),
      h("p", {}, h("strong", {}, plural(data.unitsCodedByBoth, "unit")), " coded by both you and the AI."),
      h("p", { class: "small muted" }, "Cohen's kappa corrects agreement for chance. Scales use weighted kappa (near-misses count partly); multi-choice codes are compared category by category. Labels follow Landis & Koch (1977): slight, fair, moderate, substantial, almost perfect. For conditional codes, whether the code applies at all is part of the comparison."),
      data.unitsCodedByBoth
        ? h("div", { class: "table-wrap" }, h("table", { class: "agreement" },
            h("thead", {}, h("tr", {}, h("th", {}, "Code"), h("th", {}, "Units"), h("th", {}, "Agreement"), h("th", {}, "Cohen's kappa"), h("th", {}, "Disagreements"))),
            h("tbody", {}, rows.flat())))
        : h("p", { class: "notice" }, "Code some units yourself (Code by hand) and have the AI code the same units (AI coding, “Coded by me”), then come back here.")));
}
