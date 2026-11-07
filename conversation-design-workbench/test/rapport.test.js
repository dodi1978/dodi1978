import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, fakeClaude } from "./helpers.js";
import { parseImportance, sanitiseFramework, GAAFFE } from "../src/framework.js";
import { personasFromRows } from "../src/importer.js";

async function setup(t, overrides) {
  const ctx = await makeApp(overrides);
  t.after(() => ctx.db.close());
  await ctx.login();
  const { data } = await ctx.call("POST", "/api/projects", { name: "Rapport study" });
  const projectId = data.project.id;
  await ctx.call("POST", `/api/projects/${projectId}/documents`, { title: "Guide", text: "Appointments can be booked online or by phone.\n\nYou can cancel up to 24 hours before." });
  return { ...ctx, projectId };
}

const b64 = (s) => Buffer.from(s).toString("base64");

test("importance values are read from words and numeric scales", () => {
  assert.equal(parseImportance("High"), "high");
  assert.equal(parseImportance("med"), "medium");
  assert.equal(parseImportance("4", 5), "high");
  assert.equal(parseImportance("3", 5), "medium");
  assert.equal(parseImportance("2/7"), "low");
  assert.equal(parseImportance("wants to choose"), "");
});

test("frameworks keep keys when renamed and get unique keys when added", () => {
  const f = sanitiseFramework({ name: "Mine", dimensions: [{ key: "goals", name: "Task goals" }, { name: "Humour" }, { name: "Humour" }, { name: " " }] });
  assert.deepEqual(f.dimensions.map((d) => d.key), ["goals", "humour", "humour_2"]);
  assert.equal(f.dimensions[0].name, "Task goals");
});

test("each project starts with the GAAFFE taxonomy and can edit or reset it", async (t) => {
  const { call, projectId } = await setup(t);
  const first = await call("GET", `/api/projects/${projectId}/framework`);
  assert.equal(first.data.isDefault, true);
  assert.deepEqual(first.data.framework.dimensions.map((d) => d.name), ["Goals", "Autonomy", "Attention", "Face", "Fairness", "Ethicality"]);
  assert.ok(first.data.framework.dimensions[0].builds.length > 3);

  const persona = await call("POST", `/api/projects/${projectId}/personas`, {
    name: "Carer", rapport: { autonomy: { importance: "high", note: "Wants to choose." }, ethicality: { importance: "extreme" }, made_up: { importance: "high" } },
  });
  assert.deepEqual(persona.data.persona.rapport, { autonomy: { importance: "high", note: "Wants to choose." } }, "invalid levels and unknown dimensions are dropped");

  const edited = first.data.framework;
  edited.dimensions = edited.dimensions.filter((d) => d.key !== "ethicality");
  edited.dimensions.push({ name: "Humour", definition: "Whether playfulness fits the user.", builds: "Light touch\nMatches the user's tone", breaks: "Jokes at the wrong time" });
  const saved = await call("PUT", `/api/projects/${projectId}/framework`, { framework: edited });
  assert.equal(saved.data.isDefault, false);
  assert.deepEqual(saved.data.framework.dimensions.at(-1).builds, ["Light touch", "Matches the user's tone"]);

  const p2 = await call("PATCH", `/api/personas/${persona.data.persona.id}`, { rapport: { humour: { importance: "low", note: "Dislikes jokes." }, autonomy: { importance: "high", note: "Wants to choose." } } });
  assert.deepEqual(Object.keys(p2.data.persona.rapport).sort(), ["autonomy", "humour"]);

  const reset = await call("PUT", `/api/projects/${projectId}/framework`, { reset: true });
  assert.equal(reset.data.isDefault, true);
  assert.equal(reset.data.framework.dimensions.length, 6);
});

test("simulated users act on their rapport needs and report a perception per dimension", async (t) => {
  const claude = fakeClaude();
  const { call, projectId } = await setup(t, { claude });
  const p = (await call("POST", `/api/projects/${projectId}/personas`, { name: "Carer", description: "Looks after her mother.", rapport: { autonomy: { importance: "high", note: "Irritated by pushy prompts." } } })).data.persona;
  const run = await call("POST", `/api/projects/${projectId}/runs`, { kind: "simulated", personaIds: [p.id], count: 1, minTurns: 1, maxTurns: 2 });
  const id = run.data.conversationIds[0];
  for (let i = 0; i < 10; i++) if ((await call("POST", `/api/conversations/${id}/step`)).data.done) break;

  const turnPrompt = claude.calls.find((c) => c.schema?.properties.action).messages[0].content;
  assert.match(turnPrompt, /Rapport needs \(Taxonomy of Human-Chatbot Rapport/);
  assert.match(turnPrompt, /Autonomy \(The degree of control[^)]*\): high importance to this user\. Irritated by pushy prompts\./);
  assert.match(turnPrompt, /React to the chatbot's behaviour in line with this persona's rapport needs/);

  const conv = await call("GET", `/api/conversations/${id}`);
  const meta = conv.data.conversation.meta;
  assert.deepEqual(Object.keys(meta.rapportPerception).sort(), GAAFFE.dimensions.map((d) => d.key).sort());
  assert.equal(meta.rapportPerception.goals.score, 1);
  assert.equal(meta.rating.score, 4);
  assert.equal(meta.framework.dimensions.length, 6, "the framework used is stored with the conversation");
});

test("personas are imported from a spreadsheet, one row each", async (t) => {
  const { call, projectId } = await setup(t);
  const csv = [
    "Persona,Description,Goals importance,Goals note,Autonomy,Attention,Face evidence,Shoe size",
    'P1,"Retired nurse, lives alone",high,Wants quick answers,wants to choose for herself,5,"I hate being talked down to | I know my stuff",6',
    "P2,Student,low,,high,2,,9",
  ].join("\n");
  const preview = await call("POST", `/api/projects/${projectId}/personas/import`, { filename: "personas.csv", contentBase64: b64(csv), dryRun: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.count, 2);
  assert.deepEqual(preview.data.unmapped, ["Shoe size"]);
  assert.equal(preview.data.mapping["Goals importance"], "Goals: importance");
  const [p1] = preview.data.preview;
  assert.deepEqual(p1.rapport.goals, { importance: "high", note: "Wants quick answers" });
  assert.deepEqual(p1.rapport.autonomy, { importance: "", note: "wants to choose for herself" });
  assert.equal(p1.rapport.attention.importance, "high", "5 on a 1-5 scale");
  assert.deepEqual(p1.rapport.face.evidence, ["I hate being talked down to", "I know my stuff"]);
  assert.equal((await call("GET", `/api/projects/${projectId}/personas`)).data.personas.length, 0, "a preview saves nothing");

  const done = await call("POST", `/api/projects/${projectId}/personas/import`, { filename: "personas.csv", contentBase64: b64(csv) });
  assert.equal(done.data.count, 2);
  const list = (await call("GET", `/api/projects/${projectId}/personas`)).data.personas;
  assert.equal(list[1].rapport.attention.importance, "low", "2 on a 1-5 scale");
  assert.match(list[0].source, /Imported from personas\.csv/);
});

test("the importer reports what it could not match", () => {
  assert.throws(() => personasFromRows([["Name"]], GAAFFE), /header row and at least one persona/);
  const { personas } = personasFromRows([["Name", "Ethicality importance"], ["A", "1"], ["B", "3"]], GAAFFE);
  assert.deepEqual(personas.map((p) => p.rapport.ethicality.importance), ["low", "high"], "scale 1-3 detected from the column");
});
