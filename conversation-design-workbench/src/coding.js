// Coding: code sets, units to code, coding by hand, AI coding and agreement.

import { randomUUID } from "node:crypto";
import { UNIT_TYPES, CODE_TYPES, MEANING_FIELDS, sanitiseCode, cleanValue, conditionMet, presetList, presetCodes, hasHierarchy, topLevel } from "./codebooks.js";
import { agreementFor, interpretKappa } from "./agreement.js";
import { frameworkOf } from "./framework.js";
import { modelInfo, claudeCost, DEFAULT_MODEL } from "./pricing.js";

const NA = "__not_applicable__";
const MAX_EXAMPLES = 8;

// Codes chosen for one coding session ("codes=a,b"), plus any codes their conditions
// depend on, so a condition can always be decided. No choice means all codes.
export function parseKeys(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return null;
}

export function scopeCodes(codes, keys) {
  if (!keys || !keys.length) return codes;
  const want = new Set(keys);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of codes) {
      if (want.has(c.key) && c.condition && !want.has(c.condition.codeKey)) {
        want.add(c.condition.codeKey);
        grew = true;
      }
    }
  }
  const scoped = codes.filter((c) => want.has(c.key));
  return scoped.length ? scoped : codes;
}

// JSON with object keys in sorted order, so equal values compare equal.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

function meets(code, values, codes) {
  return conditionMet(code, values, code.condition ? codes.find((c) => c.key === code.condition.codeKey) : undefined);
}

export function codingRoutes({ HttpError, loadProject, requireText, logClaude }) {
  // ---------- code sets and codes ----------

  async function loadSet(db, id) {
    const [set] = await db.query("SELECT * FROM code_sets WHERE id = $1", [id]);
    if (!set) throw new HttpError(404, "That code set does not exist.");
    return set;
  }

  async function codesOf(db, setId) {
    const rows = await db.query("SELECT * FROM codes WHERE set_id = $1 ORDER BY position, created_at", [setId]);
    return rows.map((r) => ({ id: r.id, version: r.version, ...r.data }));
  }

  // The units a set's codes are coded on: the set's own unit first, then any other.
  function levelsOf(set, codes) {
    return [...new Set([set.applies_to, ...codes.map((c) => c.unit ?? set.applies_to)])];
  }

  // One level of a set: the set as if it applied to that unit, with only that unit's codes.
  async function loadLevel(db, id, level) {
    const set = await loadSet(db, id);
    const all = await codesOf(db, id);
    const lv = level || set.applies_to;
    if (!levelsOf(set, all).includes(lv)) throw new HttpError(400, "This code set has no codes for that unit.");
    return { set: { ...set, applies_to: lv }, codes: all.filter((c) => (c.unit ?? set.applies_to) === lv) };
  }

  const levelParam = (url, body) => body?.level || url?.searchParams?.get("level") || "";

  function setOut(s, codes, counts = {}) {
    return {
      id: s.id, projectId: s.project_id, name: s.name, description: s.description, appliesTo: s.applies_to, levels: levelsOf(s, codes),
      source: s.data?.source ?? "", ai: { model: s.data?.ai?.model ?? DEFAULT_MODEL, effort: s.data?.ai?.effort ?? "low" },
      codes, createdAt: s.created_at, updatedAt: s.updated_at, ...counts,
    };
  }

  async function setCounts(db, setId) {
    const [c] = await db.query(
      `SELECT count(DISTINCT unit_id) FILTER (WHERE coder = 'human')::int AS human_units,
              count(DISTINCT unit_id) FILTER (WHERE coder = 'ai')::int AS ai_units,
              count(DISTINCT unit_id) FILTER (WHERE coder = 'human' AND is_example)::int AS examples
         FROM annotations WHERE set_id = $1`,
      [setId],
    );
    return { humanUnits: c.human_units, aiUnits: c.ai_units, examples: c.examples };
  }

  async function listSets({ db }, { id }) {
    await loadProject(db, id);
    const sets = await db.query("SELECT * FROM code_sets WHERE project_id = $1 ORDER BY position, created_at", [id]);
    const out = [];
    for (const s of sets) out.push(setOut(s, await codesOf(db, s.id), await setCounts(db, s.id)));
    return { sets: out, unitTypes: UNIT_TYPES, codeTypes: CODE_TYPES };
  }

  async function getSet({ db }, { id }) {
    const s = await loadSet(db, id);
    return { set: setOut(s, await codesOf(db, id), await setCounts(db, id)), unitTypes: UNIT_TYPES, codeTypes: CODE_TYPES };
  }

  async function insertSet(db, projectId, { name, description = "", appliesTo, source = "" }, codes = []) {
    if (!UNIT_TYPES[appliesTo]) throw new HttpError(400, "Choose what the codes apply to.");
    const setId = randomUUID();
    const [{ pos }] = await db.query("SELECT COALESCE(max(position), 0) + 1 AS pos FROM code_sets WHERE project_id = $1", [projectId]);
    await db.query(
      "INSERT INTO code_sets (id, project_id, name, description, applies_to, position, data) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [setId, projectId, String(name).slice(0, 200), String(description).slice(0, 3000), appliesTo, pos, JSON.stringify({ source, ai: { model: DEFAULT_MODEL, effort: "low" } })],
    );
    for (const [i, code] of codes.entries()) {
      await db.query("INSERT INTO codes (id, set_id, project_id, position, version, data) VALUES ($1, $2, $3, $4, 1, $5)", [randomUUID(), setId, projectId, i + 1, JSON.stringify(code)]);
    }
    return setId;
  }

  async function createSet({ db }, { id }, body) {
    await loadProject(db, id);
    const setId = await insertSet(db, id, { name: requireText(body.name, "Name", 200), description: body.description ?? "", appliesTo: body.appliesTo });
    return getSet({ db }, { id: setId });
  }

  async function listPresets({ db }, { id }) {
    const framework = frameworkOf(await loadProject(db, id));
    return { presets: presetList(framework).map((p) => ({ id: p.id, name: p.name, appliesTo: p.appliesTo, description: p.description, source: p.source, codeCount: p.codes.length, codeNames: p.codes.map((c) => c.name), codes: presetCodes(p).map((c) => ({ name: c.name, options: c.options ?? null, unit: c.unit ?? null })) })) };
  }

  async function addPreset({ db }, { id }, body) {
    const framework = frameworkOf(await loadProject(db, id));
    const preset = presetList(framework).find((p) => p.id === body.preset);
    if (!preset) throw new HttpError(400, "Unknown code set in the library.");
    const setId = await insertSet(db, id, preset, presetCodes(preset));
    return getSet({ db }, { id: setId });
  }

  async function updateSet({ db }, { id }, body) {
    const s = await loadSet(db, id);
    const data = { ...s.data };
    if (body.ai) {
      data.ai = {
        model: modelInfo(body.ai.model) ? body.ai.model : data.ai?.model ?? DEFAULT_MODEL,
        effort: ["low", "medium", "high"].includes(body.ai.effort) ? body.ai.effort : data.ai?.effort ?? "low",
      };
    }
    const name = body.name !== undefined ? requireText(body.name, "Name", 200) : s.name;
    const description = body.description !== undefined ? String(body.description).slice(0, 3000) : s.description;
    await db.query("UPDATE code_sets SET name = $2, description = $3, data = $4, updated_at = now() WHERE id = $1", [id, name, description, JSON.stringify(data)]);
    return getSet({ db }, { id });
  }

  async function deleteSet({ db }, { id }) {
    await loadSet(db, id);
    await db.query("DELETE FROM code_sets WHERE id = $1", [id]);
    return { ok: true };
  }

  async function duplicateSet({ db }, { id }) {
    const s = await loadSet(db, id);
    const codes = (await codesOf(db, id)).map(({ id: _i, version: _v, ...c }) => c);
    const setId = await insertSet(db, s.project_id, { name: `${s.name} (copy)`, description: s.description, appliesTo: s.applies_to, source: s.data?.source ?? "" }, codes);
    return getSet({ db }, { id: setId });
  }

  async function createCode({ db }, { id }, body) {
    const s = await loadSet(db, id);
    const existing = await codesOf(db, id);
    const code = sanitiseCode(body, { keys: new Set(existing.map((c) => c.key)) });
    if (code.unit === s.applies_to) delete code.unit;
    if (!code.name) throw new HttpError(400, "Give the code a name.");
    checkCode(code, existing, s);
    const [{ pos }] = await db.query("SELECT COALESCE(max(position), 0) + 1 AS pos FROM codes WHERE set_id = $1", [id]);
    await db.query("INSERT INTO codes (id, set_id, project_id, position, version, data) VALUES ($1, $2, $3, $4, 1, $5)", [randomUUID(), id, s.project_id, pos, JSON.stringify(code)]);
    await db.query("UPDATE code_sets SET updated_at = now() WHERE id = $1", [id]);
    return getSet({ db }, { id });
  }

  function checkCode(code, others, set) {
    if ((code.type === "category" || code.type === "multi") && code.options.length < (code.type === "category" ? 2 : 1)) {
      throw new HttpError(400, code.type === "category" ? "A category code needs at least two categories." : "Add at least one category.");
    }
    if (code.condition) {
      const parent = others.find((c) => c.key === code.condition.codeKey && c.key !== code.key);
      if (!parent || !["category", "multi", "yes_no"].includes(parent.type)) throw new HttpError(400, "A code can only depend on a yes/no or category code in the same set.");
      if ((parent.unit ?? set.applies_to) !== (code.unit ?? set.applies_to)) throw new HttpError(400, "A code can only depend on a code that is coded on the same unit.");
    }
  }

  async function loadCode(db, id) {
    const [row] = await db.query("SELECT * FROM codes WHERE id = $1", [id]);
    if (!row) throw new HttpError(404, "That code does not exist.");
    return row;
  }

  async function updateCode({ db }, { id }, body) {
    const row = await loadCode(db, id);
    const others = (await codesOf(db, row.set_id)).filter((c) => c.id !== id);
    const code = sanitiseCode({ ...row.data, ...body, key: row.data.key }, { keys: new Set() });
    const set = await loadSet(db, row.set_id);
    if (code.unit === set.applies_to) delete code.unit;
    if (!code.name) throw new HttpError(400, "Give the code a name.");
    checkCode(code, others, set);
    if (others.some((c) => c.condition?.codeKey === code.key && (c.unit ?? set.applies_to) !== (code.unit ?? set.applies_to))) {
      throw new HttpError(400, "Other codes depend on this one, so it must stay on the same unit as them.");
    }
    // Compared with keys sorted: the database may store an object's keys in another order.
    const changed = MEANING_FIELDS.some((f) => stable(code[f] ?? null) !== stable(row.data[f] ?? null));
    await db.query("UPDATE codes SET data = $2, version = version + $3, updated_at = now() WHERE id = $1", [id, JSON.stringify(code), changed ? 1 : 0]);
    return getSet({ db }, { id: row.set_id });
  }

  async function deleteCode({ db }, { id }) {
    const row = await loadCode(db, id);
    const dependants = (await codesOf(db, row.set_id)).filter((c) => c.condition?.codeKey === row.data.key);
    if (dependants.length) throw new HttpError(400, `Other codes depend on this one: ${dependants.map((c) => c.name).join(", ")}. Change or delete those first.`);
    await db.query("DELETE FROM codes WHERE id = $1", [id]);
    return getSet({ db }, { id: row.set_id });
  }

  async function moveCode({ db }, { id }, body) {
    const row = await loadCode(db, id);
    const codes = await codesOf(db, row.set_id);
    const i = codes.findIndex((c) => c.id === id);
    const j = body.direction === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < codes.length) {
      [codes[i], codes[j]] = [codes[j], codes[i]];
      for (const [k, c] of codes.entries()) await db.query("UPDATE codes SET position = $2 WHERE id = $1", [c.id, k + 1]);
    }
    return getSet({ db }, { id: row.set_id });
  }

  // ---------- units ----------

  // Filters on the conversations the units come from, as on the Interactions page.
  // codeIds: when coding only some codes, "coded" means coded with at least one of them.
  function unitQuery(set, q, codeIds = null) {
    const params = [set.project_id];
    const where = ["c.project_id = $1"];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (q.get("kind")) add("COALESCE(c.meta->>'kind', CASE c.source WHEN 'hand-written' THEN 'live' ELSE c.source END) = ?", q.get("kind"));
    if (q.get("personaId")) add("c.persona_id = ?", q.get("personaId"));
    if (q.get("runId")) add("c.run_id = ?", q.get("runId"));
    if (q.get("versionId")) add("c.bot_version_id = ?", q.get("versionId"));
    if (q.get("conversationId")) add("c.id = ?", q.get("conversationId"));
    if (q.get("unitId")) add(`${set.applies_to === "conversation" ? "c.id" : "m.id"} = ?`, q.get("unitId"));
    // The set id is only passed to the database when a status filter needs it.
    let setParamName = null;
    const setParam = () => {
      if (!setParamName) {
        params.push(set.id);
        setParamName = `$${params.length}`;
      }
      return setParamName;
    };
    const unitCol = set.applies_to === "conversation" ? "c.id" : "m.id";
    let codesParamName = null;
    const codeFilter = () => {
      if (!codeIds) return "";
      if (!codesParamName) {
        params.push(codeIds);
        codesParamName = `$${params.length}`;
      }
      return ` AND a.code_id = ANY(${codesParamName})`;
    };
    const coded = (coder) => `EXISTS (SELECT 1 FROM annotations a WHERE a.set_id = ${setParam()} AND a.unit_id = ${unitCol} AND a.coder = '${coder}'${codeFilter()})`;
    const status = q.get("status");
    if (status === "not_coded_by_me") where.push(`NOT ${coded("human")}`);
    if (status === "coded_by_me") where.push(coded("human"));
    if (status === "not_coded_by_ai") where.push(`NOT ${coded("ai")}`);
    if (status === "coded_by_ai") where.push(coded("ai"));
    if (status === "coded_by_both") where.push(`${coded("human")} AND ${coded("ai")}`);
    if (status === "examples") where.push(`EXISTS (SELECT 1 FROM annotations a WHERE a.set_id = ${setParam()} AND a.unit_id = ${unitCol} AND a.coder = 'human' AND a.is_example)`);
    let from;
    let select;
    if (set.applies_to === "conversation") {
      from = "conversations c";
      select = "c.id AS unit_id, c.id AS conversation_id, NULL::int AS idx, c.title AS text, c.title, c.source, c.meta->>'kind' AS kind, c.created_at";
    } else {
      const role = set.applies_to === "user" ? "user" : "assistant";
      from = "messages m JOIN conversations c ON c.id = m.conversation_id";
      where.push(`m.role = '${role}'`);
      select = `m.id AS unit_id, m.conversation_id, m.idx, m.text, c.title, c.source, c.meta->>'kind' AS kind, c.created_at${set.applies_to === "pair" ? ", (SELECT p.text FROM messages p WHERE p.conversation_id = m.conversation_id AND p.idx = m.idx - 1 AND p.role = 'user') AS user_text" : ""}`;
    }
    return { sql: `FROM ${from} WHERE ${where.join(" AND ")}`, select, params };
  }

  async function annotationsFor(db, setId, unitIds) {
    if (!unitIds.length) return [];
    return db.query("SELECT a.*, c.data->>'key' AS code_key FROM annotations a JOIN codes c ON c.id = a.code_id WHERE a.set_id = $1 AND a.unit_id = ANY($2)", [setId, unitIds]);
  }

  function groupAnnotations(rows) {
    const byUnit = {};
    for (const a of rows) {
      const u = (byUnit[a.unit_id] ??= { human: {}, ai: {}, isExample: false, aiModel: null });
      u[a.coder][a.code_key] = { value: a.value, explanation: a.explanation || "", version: a.code_version };
      if (a.coder === "human" && a.is_example) u.isExample = true;
      if (a.coder === "ai") u.aiModel = a.model;
    }
    return byUnit;
  }

  async function listUnits({ db }, { id }, _body, url) {
    const q = url?.searchParams ?? new URLSearchParams();
    const { set, codes } = await loadLevel(db, id, q.get("level"));
    const keys = parseKeys(q.get("codes"));
    const codeIds = (keys ? scopeCodes(codes, keys) : codes).map((c) => c.id);
    const { sql, select, params } = unitQuery(set, q, codeIds);
    const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 50));
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const [{ total }] = await db.query(`SELECT count(*)::int AS total ${sql}`, params);
    const rows = await db.query(`SELECT ${select} ${sql} ORDER BY c.created_at DESC, ${set.applies_to === "conversation" ? "c.id" : "m.idx"} LIMIT ${limit} OFFSET ${offset}`, params);
    const grouped = groupAnnotations(await annotationsFor(db, id, rows.map((r) => r.unit_id)));
    return {
      total,
      units: rows.map((r) => ({
        unitId: r.unit_id, conversationId: r.conversation_id, idx: r.idx, text: r.text, userText: r.user_text ?? undefined,
        title: r.title, source: r.source, kind: r.kind, ...(grouped[r.unit_id] ?? { human: {}, ai: {}, isExample: false }),
      })),
    };
  }

  // Everything one unit needs, for coding by hand or by the AI.
  async function loadUnit(db, set, unitId) {
    if (set.applies_to === "conversation") {
      const [conv] = await db.query("SELECT c.*, v.settings FROM conversations c LEFT JOIN bot_versions v ON v.id = c.bot_version_id WHERE c.id = $1 AND c.project_id = $2", [unitId, set.project_id]);
      if (!conv) throw new HttpError(404, "That conversation does not exist.");
      const messages = await db.query("SELECT id, idx, role, text, meta FROM messages WHERE conversation_id = $1 ORDER BY idx", [unitId]);
      return { conversation: conv, messages, target: null };
    }
    const [msg] = await db.query("SELECT m.*, c.project_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1", [unitId]);
    if (!msg || msg.project_id !== set.project_id) throw new HttpError(404, "That message does not exist.");
    const wantRole = set.applies_to === "user" ? "user" : "assistant";
    if (msg.role !== wantRole) throw new HttpError(400, `This code set applies to ${UNIT_TYPES[set.applies_to].toLowerCase()}.`);
    const [conv] = await db.query("SELECT c.*, v.settings FROM conversations c LEFT JOIN bot_versions v ON v.id = c.bot_version_id WHERE c.id = $1", [msg.conversation_id]);
    const messages = await db.query("SELECT id, idx, role, text, meta FROM messages WHERE conversation_id = $1 ORDER BY idx", [msg.conversation_id]);
    return { conversation: conv, messages, target: msg };
  }

  // ---------- coding by hand ----------

  // Rewrites one coder's annotations for a unit. entries: key → { value, explanation, version, model }.
  // Codes whose condition is no longer met are dropped, so the coding stays consistent.
  async function writeAnnotations(db, set, unit, unitId, coder, codes, entries, isExample = false) {
    const values = Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, e.value]));
    await db.query("DELETE FROM annotations WHERE set_id = $1 AND unit_id = $2 AND coder = $3", [set.id, unitId, coder]);
    for (const code of codes) {
      const e = entries[code.key];
      if (!e || e.value === undefined || !meets(code, values, codes)) continue;
      await db.query(
        `INSERT INTO annotations (id, project_id, set_id, code_id, unit_type, unit_id, conversation_id, coder, value, explanation, is_example, code_version, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [randomUUID(), set.project_id, set.id, code.id, set.applies_to, unitId, unit.conversation.id, coder, JSON.stringify(e.value), String(e.explanation ?? "").slice(0, 2000), coder === "human" && isExample, e.version ?? code.version, e.model ?? null],
      );
    }
  }

  // body.codeKeys: the codes coded in this session; your other codes on the unit are kept.
  async function saveHuman({ db }, { id, unitId }, body, url) {
    const { set, codes } = await loadLevel(db, id, levelParam(url, body));
    const unit = await loadUnit(db, set, unitId);
    const scope = new Set(scopeCodes(codes, parseKeys(body.codeKeys)).map((c) => c.key));
    const existing = groupAnnotations(await annotationsFor(db, id, [unitId]))[unitId];
    const raw = body.values && typeof body.values === "object" ? body.values : {};
    const notes = body.notes && typeof body.notes === "object" ? body.notes : {};
    const entries = {};
    for (const code of codes) {
      if (scope.has(code.key)) {
        const v = cleanValue(code, raw[code.key]);
        if (v !== undefined) entries[code.key] = { value: v, explanation: notes[code.key] ?? existing?.human?.[code.key]?.explanation ?? "", version: code.version };
      } else if (existing?.human?.[code.key]) {
        entries[code.key] = existing.human[code.key];
      }
    }
    const isExample = body.isExample === undefined ? Boolean(existing?.isExample) : Boolean(body.isExample);
    await writeAnnotations(db, set, unit, unitId, "human", codes, entries, isExample);
    const grouped = groupAnnotations(await annotationsFor(db, id, [unitId]));
    return { unitId, ...(grouped[unitId] ?? { human: {}, ai: {}, isExample: false }) };
  }

  async function setExample({ db }, { id, unitId }, body) {
    await loadSet(db, id);
    const rows = await db.query("UPDATE annotations SET is_example = $3 WHERE set_id = $1 AND unit_id = $2 AND coder = 'human' RETURNING id", [id, unitId, Boolean(body.isExample)]);
    if (!rows.length) throw new HttpError(400, "Code this unit yourself first; only your own coding can be an example for the AI.");
    return { ok: true, isExample: Boolean(body.isExample) };
  }

  // Copies the AI's codes for this unit into yours (all codes, or one).
  async function acceptAi(ctx, { id, unitId }, body) {
    const { db } = ctx;
    await loadSet(db, id);
    const grouped = groupAnnotations(await annotationsFor(db, id, [unitId]))[unitId];
    if (!grouped || !Object.keys(grouped.ai).length) throw new HttpError(400, "The AI has not coded this unit.");
    const values = Object.fromEntries(Object.entries(grouped.human).map(([k, v]) => [k, v.value]));
    const notes = Object.fromEntries(Object.entries(grouped.human).map(([k, v]) => [k, v.explanation]));
    if (body.codeKey) {
      if (body.codeKey in grouped.ai) values[body.codeKey] = grouped.ai[body.codeKey].value;
      else delete values[body.codeKey];
    } else {
      for (const k of Object.keys(values)) delete values[k];
      for (const [k, v] of Object.entries(grouped.ai)) values[k] = v.value;
    }
    return saveHuman(ctx, { id, unitId }, { values, notes, level: body.level, ...(body.codeKey ? { codeKeys: [body.codeKey] } : {}) });
  }

  // ---------- AI coding ----------

  function valueSchema(code) {
    switch (code.type) {
      case "yes_no": return { type: "boolean" };
      case "category": return { type: "string", enum: code.options.map((o) => o.value) };
      case "multi": return { type: "array", items: { type: "string", enum: code.options.map((o) => o.value) } };
      case "scale": return { type: "integer", enum: Array.from({ length: code.scale.max - code.scale.min + 1 }, (_, i) => code.scale.min + i) };
      case "number": return { type: "number" };
      default: return { type: "string" };
    }
  }

  function codingSchema(codes) {
    return {
      type: "object",
      properties: Object.fromEntries(codes.map((code) => {
        const props = { value: valueSchema(code), explanation: { type: "string", description: "One short sentence: why, citing the words in the unit that justify it." } };
        if (code.condition) props.applies = { type: "boolean", description: "Whether this code applies, given its condition." };
        return [code.key, { type: "object", properties: props, required: Object.keys(props), additionalProperties: false }];
      })),
      required: codes.map((c) => c.key),
      additionalProperties: false,
    };
  }

  function describeCode(code, codes) {
    const lines = [`### ${code.key}: ${code.name} (${CODE_TYPES[code.type]})`];
    if (code.definition) lines.push(code.definition);
    if (code.condition) {
      const parent = codes.find((c) => c.key === code.condition.codeKey);
      const labels = code.condition.values.map((v) => parent?.options?.find((o) => o.value === v)?.label ?? v);
      lines.push(`Applies only when ${parent?.name ?? code.condition.codeKey} is ${labels.join(" or ")}. Otherwise set "applies" to false.`);
    }
    if (code.options) {
      const depth = (o) => (o.parent ? 1 + depth(code.options.find((p) => p.value === o.parent) ?? {}) : 0);
      lines.push(...code.options.map((o) => `${"  ".repeat(depth(o))}- ${o.value}: ${o.label}${o.definition ? `. ${o.definition}` : ""}`));
      if (hasHierarchy(code)) {
        lines.push(code.type === "multi"
          ? "Categories are grouped: indented categories are subordinate to the category above them. Give the most specific categories that apply; give a superior category on its own only when none of its subordinate categories fits."
          : "Categories are grouped: indented categories are subordinate to the category above them. Choose the most specific category that applies; choose a superior category only when none of its subordinate categories fits.");
      }
    }
    if (code.scale) lines.push(`Scale from ${code.scale.min}${code.scale.minLabel ? ` (${code.scale.minLabel})` : ""} to ${code.scale.max}${code.scale.maxLabel ? ` (${code.scale.maxLabel})` : ""}.`);
    if (code.type === "multi") lines.push("Give every category that applies; an empty list if none do.");
    if (code.instructions) lines.push(`Coding instructions: ${code.instructions}`);
    return lines.join("\n");
  }

  function transcript(messages, upToIdx) {
    return messages.filter((m) => upToIdx === undefined || m.idx <= upToIdx)
      .map((m) => `${m.role === "user" ? "USER" : "CHATBOT"}: ${m.text}`).join("\n\n");
  }

  // What the coder sees for one unit. Simulation metadata (scenario, persona, ratings) is
  // never shown, so the AI codes from the conversation alone, as a human coder would.
  function unitText(set, unit, { forExample = false } = {}) {
    if (set.applies_to === "conversation") return `CONVERSATION\n${transcript(unit.messages)}`;
    const t = unit.target;
    const before = transcript(unit.messages, t.idx - 1);
    const parts = [];
    if (before && !forExample) parts.push(`CONVERSATION SO FAR (context only)\n${before}`);
    if (set.applies_to === "user") parts.push(`USER MESSAGE TO CODE\n${t.text}`);
    else {
      const userMsg = unit.messages.find((m) => m.idx === t.idx - 1 && m.role === "user");
      if (set.applies_to === "pair" && userMsg) parts.push(`USER MESSAGE\n${userMsg.text}`);
      if (!forExample) {
        if (unit.conversation.settings?.systemPrompt) parts.push(`THE CHATBOT'S SYSTEM INSTRUCTIONS\n${unit.conversation.settings.systemPrompt}`);
        const passages = t.meta?.passages;
        if (Array.isArray(passages)) parts.push(`PASSAGES THE CHATBOT WAS GIVEN\n${passages.length ? passages.map((p, i) => `[${i + 1}] (${p.documentTitle}) ${p.text}`).join("\n\n") : "(none found)"}`);
      }
      parts.push(`CHATBOT REPLY TO CODE\n${t.text}`);
    }
    return parts.join("\n\n");
  }

  function formatValue(code, value) {
    if (code.type === "yes_no") return value ? "yes" : "no";
    if (code.type === "multi") return value.length ? value.join(", ") : "(none)";
    return String(value);
  }

  async function examplesFor(db, set, codes, excludeUnitId) {
    const rows = await db.query(
      `SELECT DISTINCT unit_id, max(updated_at) AS at FROM annotations
        WHERE set_id = $1 AND coder = 'human' AND is_example AND unit_id <> $2 AND unit_type = $3
        GROUP BY unit_id ORDER BY at DESC LIMIT ${MAX_EXAMPLES}`,
      [set.id, excludeUnitId, set.applies_to],
    );
    const out = [];
    for (const r of rows) {
      let unit;
      try {
        unit = await loadUnit(db, set, r.unit_id);
      } catch {
        continue;
      }
      const grouped = groupAnnotations(await annotationsFor(db, set.id, [r.unit_id]))[r.unit_id];
      const lines = codes.map((c) => {
        const a = grouped?.human?.[c.key];
        return `${c.key}: ${a ? formatValue(c, a.value) : "not applicable"}${a?.explanation ? ` (note: ${a.explanation})` : ""}`;
      });
      out.push(`${unitText(set, unit, { forExample: true })}\n\nCODES\n${lines.join("\n")}`);
    }
    return out;
  }

  async function buildPrompt(db, set, codes, unit, unitId) {
    const examples = await examplesFor(db, set, codes, unitId);
    const system = [
      "You are an expert coder in pragmatics, conversation analysis and conversation design, applying a coding scheme to chatbot conversation data for research.",
      "Apply the definitions exactly as written; do not use your own categories. Code only what is in the unit; use earlier conversation only as context. When in doubt between categories, choose the one the definitions support best and say why.",
      `CODING SCHEME: ${set.name}`,
      set.description,
      `Unit of coding: ${UNIT_TYPES[set.applies_to]}.`,
      `CODES\n${codes.map((c) => describeCode(c, codes)).join("\n\n")}`,
      examples.length ? `EXAMPLES CODED BY THE RESEARCHER (follow how these were coded)\n\n${examples.map((e, i) => `--- Example ${i + 1} ---\n${e}`).join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n");
    return { system, user: `${unitText(set, unit)}\n\nCode this unit with every code in the scheme.`, exampleCount: examples.length };
  }

  // body.codeKeys: code only these (plus what their conditions need); the AI's other codes are kept.
  async function aiCodeUnit(ctx, { id, unitId }, body = {}, url) {
    const { db, claude } = ctx;
    const { set, codes: allCodes } = await loadLevel(db, id, levelParam(url, body));
    if (!allCodes.length) throw new HttpError(400, "Add codes to this set first.");
    const codes = scopeCodes(allCodes, parseKeys(body.codeKeys));
    const unit = await loadUnit(db, set, unitId);
    const { system, user, exampleCount } = await buildPrompt(db, set, codes, unit, unitId);
    const ai = { model: set.data?.ai?.model ?? DEFAULT_MODEL, effort: set.data?.ai?.effort ?? "low" };
    const result = await claude.complete({ model: ai.model, effort: ai.effort, system, messages: [{ role: "user", content: user }], maxTokens: 6000, schema: codingSchema(codes) });
    await logClaude(db, set.project_id, result, "AI coding");
    if (result.refused || !result.json) throw new HttpError(502, "The AI could not code this unit.");
    const existing = groupAnnotations(await annotationsFor(db, id, [unitId]))[unitId];
    const inScope = new Set(codes.map((c) => c.key));
    const entries = {};
    for (const code of allCodes) {
      if (!inScope.has(code.key)) {
        if (existing?.ai?.[code.key]) entries[code.key] = { ...existing.ai[code.key], model: existing.aiModel };
        continue;
      }
      const r = result.json[code.key];
      if (!r || (code.condition && r.applies === false)) continue;
      const v = cleanValue(code, r.value);
      if (v !== undefined) entries[code.key] = { value: v, explanation: r.explanation ?? "", version: code.version, model: result.model };
    }
    await writeAnnotations(db, set, unit, unitId, "ai", allCodes, entries);
    const grouped = groupAnnotations(await annotationsFor(db, id, [unitId]));
    return { unitId, exampleCount, ...(grouped[unitId] ?? { human: {}, ai: {} }) };
  }

  // A rough cost estimate before an AI coding run, from the prompt for one unit.
  async function estimate({ db }, { id }, body, url) {
    const { set, codes: levelCodes } = await loadLevel(db, id, levelParam(url, body));
    const codes = scopeCodes(levelCodes, parseKeys(body.codeKeys));
    const count = Math.max(0, Math.min(10000, Number(body.count) || 0));
    if (!codes.length || !count) return { count, costUsd: 0 };
    const sample = body.unitId;
    let inputTokens = 2000;
    let exampleCount = 0;
    if (sample) {
      const unit = await loadUnit(db, set, sample);
      const prompt = await buildPrompt(db, set, codes, unit, sample);
      inputTokens = Math.ceil((prompt.system.length + prompt.user.length) / 3.5);
      exampleCount = prompt.exampleCount;
    }
    const outputTokens = 60 * codes.length + 200;
    const model = set.data?.ai?.model ?? DEFAULT_MODEL;
    const per = claudeCost(model, { input_tokens: inputTokens, output_tokens: outputTokens });
    return { count, model, exampleCount, costUsd: Math.round(per * count * 100) / 100, perUnitUsd: per };
  }

  // ---------- agreement ----------

  async function agreement({ db }, { id }, _body, url) {
    const { set, codes } = await loadLevel(db, id, levelParam(url));
    const rows = await db.query("SELECT a.*, c.data->>'key' AS code_key FROM annotations a JOIN codes c ON c.id = a.code_id WHERE a.set_id = $1 AND a.unit_type = $2", [id, set.applies_to]);
    const grouped = groupAnnotations(rows);
    const both = Object.entries(grouped).filter(([, g]) => Object.keys(g.human).length && Object.keys(g.ai).length);
    const units = both.map(([unitId]) => unitId);
    const texts = units.length
      ? Object.fromEntries((await db.query(
          set.applies_to === "conversation" ? "SELECT id AS unit_id, title AS text, id AS conversation_id FROM conversations WHERE id = ANY($1)" : "SELECT id AS unit_id, text, conversation_id FROM messages WHERE id = ANY($1)",
          [units],
        )).map((r) => [r.unit_id, r]))
      : {};
    const results = codes.map((code) => {
      const pairs = [];
      const disagreements = [];
      let outdated = 0;
      for (const [unitId, g] of both) {
        const h = g.human[code.key];
        const a = g.ai[code.key];
        if ((h && h.version !== code.version) || (a && a.version !== code.version)) {
          outdated++;
          continue;
        }
        let hv = h?.value;
        let av = a?.value;
        if (code.condition) {
          // Whether a conditional code applies at all is part of the agreement.
          if (hv === undefined && av === undefined) continue;
          if (code.type === "category" || code.type === "yes_no") {
            hv = hv ?? NA;
            av = av ?? NA;
          } else if (code.type === "multi") {
            hv = hv ?? [];
            av = av ?? [];
          } else if (hv === undefined || av === undefined) continue;
        } else if (hv === undefined || av === undefined) continue;
        pairs.push([hv, av]);
        if (JSON.stringify(hv) !== JSON.stringify(av) && disagreements.length < 100) {
          disagreements.push({ unitId, conversationId: texts[unitId]?.conversation_id, text: texts[unitId]?.text ?? "", human: hv === NA ? null : hv, ai: av === NA ? null : av, explanation: a?.explanation ?? "", humanNote: h?.explanation ?? "" });
        }
      }
      const r = agreementFor(code, pairs);
      // With superior and subordinate categories, also compare at the superior level
      // (e.g. directness level as well as head act strategy).
      let superior;
      if (hasHierarchy(code) && pairs.length) {
        const up = (v) => (v === NA ? NA : topLevel(code.options, v));
        const superPairs = pairs.map(([a, b]) => (code.type === "multi"
          ? [[...new Set(a.map(up))].sort(), [...new Set(b.map(up))].sort()]
          : [up(a), up(b)]));
        const topOptions = code.options.filter((o) => !o.parent);
        const s = agreementFor({ ...code, options: topOptions }, superPairs);
        superior = { ...s, interpretation: interpretKappa(s.kappa), categories: topOptions.map((o) => o.label) };
      }
      return { codeId: code.id, key: code.key, name: code.name, type: code.type, outdated, ...r, interpretation: interpretKappa(r.kappa), disagreements, ...(superior ? { superior } : {}) };
    });
    return { unitsCodedByBoth: both.length, codes: results };
  }

  // ---------- which codes were applied ----------

  // How often each code and category was applied, by you and by the AI. A superior
  // category's total counts the units coded with it or any of its subordinate categories.
  async function frequencies({ db }, { id }, _body, url) {
    const { set, codes } = await loadLevel(db, id, levelParam(url));
    const q = url?.searchParams ?? new URLSearchParams();
    const { sql, params } = unitQuery(set, new URLSearchParams(q.get("kind") ? [["kind", q.get("kind")]] : []));
    const unitIds = (await db.query(`SELECT ${set.applies_to === "conversation" ? "c.id" : "m.id"} AS unit_id ${sql}`, params)).map((r) => r.unit_id);
    const rows = unitIds.length ? await annotationsFor(db, id, unitIds) : [];
    const grouped = groupAnnotations(rows);
    const coded = { human: 0, ai: 0 };
    for (const g of Object.values(grouped)) {
      if (Object.keys(g.human).length) coded.human++;
      if (Object.keys(g.ai).length) coded.ai++;
    }
    const out = codes.map((code) => {
      const counts = { human: {}, ai: {} };
      const applied = { human: 0, ai: 0 };
      for (const g of Object.values(grouped)) {
        for (const coder of ["human", "ai"]) {
          const a = g[coder][code.key];
          if (!a) continue;
          applied[coder]++;
          const values = code.type === "multi" ? a.value : [a.value];
          const hit = new Set();
          for (const v of values) {
            const key = String(v);
            hit.add(key);
            if (code.options) for (const anc of ancestorsOf(code.options, key)) hit.add(anc);
          }
          for (const k of hit) counts[coder][k] = (counts[coder][k] ?? 0) + 1;
        }
      }
      let categories;
      if (code.type === "category" || code.type === "multi") {
        categories = code.options.map((o) => ({
          value: o.value, label: o.label, parent: o.parent ?? null,
          superior: code.options.some((x) => x.parent === o.value),
          human: counts.human[o.value] ?? 0, ai: counts.ai[o.value] ?? 0,
        }));
      } else if (code.type === "yes_no") {
        categories = [["true", "Yes"], ["false", "No"]].map(([v, label]) => ({ value: v, label, parent: null, superior: false, human: counts.human[v] ?? 0, ai: counts.ai[v] ?? 0 }));
      } else if (code.type === "scale") {
        categories = Array.from({ length: code.scale.max - code.scale.min + 1 }, (_, i) => String(code.scale.min + i))
          .map((v) => ({ value: v, label: v, parent: null, superior: false, human: counts.human[v] ?? 0, ai: counts.ai[v] ?? 0 }));
      }
      return { key: code.key, name: code.name, type: code.type, applied, ...(categories ? { categories } : {}) };
    });
    return { unitsInScope: unitIds.length, coded, codes: out };
  }

  function ancestorsOf(options, value) {
    const out = [];
    let o = options.find((x) => x.value === value);
    while (o?.parent && out.length < 10) {
      out.push(o.parent);
      o = options.find((x) => x.value === o.parent);
    }
    return out;
  }

  // The codes applied to the messages (and the whole) of one conversation, from every set.
  async function conversationCodes({ db }, { id }) {
    const [conv] = await db.query("SELECT project_id FROM conversations WHERE id = $1", [id]);
    if (!conv) throw new HttpError(404, "That conversation does not exist.");
    const rows = await db.query(
      `SELECT a.unit_id, a.unit_type, a.coder, a.value, a.explanation, a.set_id, c.id AS code_id
         FROM annotations a JOIN codes c ON c.id = a.code_id WHERE a.conversation_id = $1`,
      [id],
    );
    const setIds = [...new Set(rows.map((r) => r.set_id))];
    const sets = [];
    for (const sid of setIds) {
      const s = await loadSet(db, sid);
      sets.push({ id: s.id, name: s.name, appliesTo: s.applies_to, codes: await codesOf(db, sid) });
    }
    return {
      sets,
      annotations: rows.map((r) => ({ unitId: r.unit_id, unitType: r.unit_type, coder: r.coder, value: r.value, note: r.explanation, setId: r.set_id, codeId: r.code_id })),
    };
  }

  return [
    ["GET", "/api/code-sets/:id/frequencies", frequencies],
    ["GET", "/api/conversations/:id/codes", conversationCodes],
    ["GET", "/api/projects/:id/code-sets", listSets],
    ["POST", "/api/projects/:id/code-sets", createSet],
    ["GET", "/api/projects/:id/code-library", listPresets],
    ["POST", "/api/projects/:id/code-library", addPreset],
    ["GET", "/api/code-sets/:id", getSet],
    ["PATCH", "/api/code-sets/:id", updateSet],
    ["DELETE", "/api/code-sets/:id", deleteSet],
    ["POST", "/api/code-sets/:id/duplicate", duplicateSet],
    ["POST", "/api/code-sets/:id/codes", createCode],
    ["PATCH", "/api/codes/:id", updateCode],
    ["DELETE", "/api/codes/:id", deleteCode],
    ["POST", "/api/codes/:id/move", moveCode],
    ["GET", "/api/code-sets/:id/units", listUnits],
    ["PUT", "/api/code-sets/:id/units/:unitId", saveHuman],
    ["POST", "/api/code-sets/:id/units/:unitId/example", setExample],
    ["POST", "/api/code-sets/:id/units/:unitId/accept-ai", acceptAi],
    ["POST", "/api/code-sets/:id/units/:unitId/ai", aiCodeUnit],
    ["POST", "/api/code-sets/:id/estimate", estimate],
    ["GET", "/api/code-sets/:id/agreement", agreement],
  ];
}
