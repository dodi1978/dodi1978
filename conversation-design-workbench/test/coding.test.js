import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, fakeClaude } from "./helpers.js";
import { cohensKappa, weightedKappa, agreementFor } from "../src/agreement.js";

async function setup(t, overrides) {
  const ctx = await makeApp(overrides);
  t.after(() => ctx.db.close());
  await ctx.login();
  const { data } = await ctx.call("POST", "/api/projects", { name: "Coding study" });
  const projectId = data.project.id;
  await ctx.call("POST", `/api/projects/${projectId}/documents`, { title: "Guide", text: "Appointments can be cancelled up to 24 hours before." });
  // Two conversations to code: one written by hand, one live test chat.
  const written = await ctx.call("POST", `/api/projects/${projectId}/conversations/written`, {
    title: "Polite request",
    messages: [
      { role: "user", text: "Hi, could you possibly tell me how to cancel my appointment?" },
      { role: "assistant", text: "You can cancel up to 24 hours before." },
      { role: "user", text: "Thanks!" },
      { role: "assistant", text: "You're welcome." },
    ],
  });
  const live = await ctx.call("POST", `/api/projects/${projectId}/conversations`, {});
  await ctx.call("POST", `/api/conversations/${live.data.conversation.id}/messages`, { text: "Cancel my appointment now." });
  return { ...ctx, projectId, writtenId: written.data.conversation.id, liveId: live.data.conversation.id };
}

test("kappa is computed correctly", () => {
  // Textbook example: 50 items, po = 0.7, pe = 0.5 → kappa 0.4
  const pairs = [...Array(20).fill(["y", "y"]), ...Array(15).fill(["n", "n"]), ...Array(5).fill(["y", "n"]), ...Array(10).fill(["n", "y"])];
  const r = cohensKappa(pairs);
  assert.equal(r.n, 50);
  assert.ok(Math.abs(r.percentAgreement - 0.7) < 1e-9);
  assert.ok(Math.abs(r.kappa - 0.4) < 1e-9);
  assert.equal(cohensKappa([["a", "a"], ["b", "b"]]).kappa, 1);
  const w = weightedKappa([[1, 1], [2, 2], [3, 3], [4, 5], [5, 4]], 1, 5);
  assert.ok(w.kappa > 0.8 && w.kappa < 1, "near misses on a scale count partly");
  const multi = agreementFor({ type: "multi", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }, [[["a"], ["a"]], [["a", "b"], ["a"]], [[], []]]);
  assert.equal(multi.perOption.find((o) => o.value === "a").kappa, 1);
});

test("the library offers the five code sets, and the rapport set follows the project's framework", async (t) => {
  const { call, projectId } = await setup(t);
  const lib = await call("GET", `/api/projects/${projectId}/code-library`);
  assert.deepEqual(lib.data.presets.map((p) => p.id), ["ccsarp_requests", "brown_levinson", "reply_quality", "conversation_outcomes", "rapport"]);
  assert.deepEqual(lib.data.presets.map((p) => p.appliesTo), ["user", "user", "pair", "conversation", "pair"]);
  assert.equal(lib.data.presets.find((p) => p.id === "rapport").codeCount, 12, "an effect and a behaviours code per GAAFFE dimension");

  const ccsarp = await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" });
  const codes = ccsarp.data.set.codes;
  assert.equal(codes.length, 8);
  assert.deepEqual(codes[0].options.map((o) => o.value), ["request", "no_request"]);
  assert.equal(codes.find((c) => c.key === "head_act").options.length, 9);
  assert.ok(codes.slice(1).every((c) => c.condition?.codeKey === "speech_act" && c.condition.values[0] === "request"), "request codes apply only to requests");

  const bl = await call("POST", `/api/projects/${projectId}/code-library`, { preset: "brown_levinson" });
  const counts = bl.data.set.codes.map((c) => c.options.length);
  assert.deepEqual(counts, [5, 15, 10, 15], "superstrategies, then 15 positive, 10 negative and 15 off-record strategies");

  await call("PUT", `/api/projects/${projectId}/framework`, { framework: { name: "Mine", dimensions: [{ name: "Warmth", definition: "d", builds: ["Friendly"], breaks: ["Cold"] }] } });
  const rapport = await call("POST", `/api/projects/${projectId}/code-library`, { preset: "rapport" });
  assert.deepEqual(rapport.data.set.codes.map((c) => c.key), ["warmth_effect", "warmth_behaviours"]);
  assert.equal(rapport.data.set.name, "Rapport: Mine");
});

test("codes can be created, edited (with versions), moved and deleted", async (t) => {
  const { call, projectId } = await setup(t);
  const set = (await call("POST", `/api/projects/${projectId}/code-sets`, { name: "My codes", appliesTo: "user" })).data.set;
  assert.equal((await call("POST", `/api/projects/${projectId}/code-sets`, { name: "x", appliesTo: "nothing" })).status, 400);
  assert.equal((await call("POST", `/api/code-sets/${set.id}/codes`, { name: "Emotion", type: "category", options: [{ label: "Angry" }] })).status, 400, "a category code needs two categories");
  let s = (await call("POST", `/api/code-sets/${set.id}/codes`, { name: "Emotion", type: "category", options: [{ label: "Angry" }, { label: "Calm" }] })).data.set;
  s = (await call("POST", `/api/code-sets/${set.id}/codes`, { name: "Intensity", type: "scale", scale: { min: 1, max: 5 }, condition: { codeKey: "emotion", values: ["angry"] } })).data.set;
  assert.equal(s.codes[1].condition.codeKey, "emotion");
  const emotion = s.codes[0];
  s = (await call("PATCH", `/api/codes/${emotion.id}`, { definition: "How the user feels." })).data.set;
  assert.equal(s.codes[0].version, 2, "changing the meaning makes a new version");
  assert.equal(s.codes[0].key, "emotion", "the key never changes");
  assert.equal((await call("DELETE", `/api/codes/${emotion.id}`)).status, 400, "cannot delete a code others depend on");
  s = (await call("POST", `/api/codes/${s.codes[1].id}/move`, { direction: "up" })).data.set;
  assert.equal(s.codes[0].key, "intensity");
  const copy = await call("POST", `/api/code-sets/${set.id}/duplicate`);
  assert.equal(copy.data.set.codes.length, 2);
});

test("units are listed per set type, and coding by hand respects conditions", async (t) => {
  const { call, projectId } = await setup(t);
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" })).data.set;
  const units = await call("GET", `/api/code-sets/${set.id}/units`);
  assert.equal(units.data.total, 3, "three user messages");
  const polite = units.data.units.find((u) => /possibly/.test(u.text));
  const thanks = units.data.units.find((u) => u.text === "Thanks!");

  const saved = await call("PUT", `/api/code-sets/${set.id}/units/${polite.unitId}`, {
    values: { speech_act: "request", head_act: "7_query_preparatory_conventionally_indir", perspective: "hearer_oriented", lexical_downgraders: ["downtoner", "nonsense"], alerters: ["attention_getter_greeting"] },
    isExample: true,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.human.head_act.value, "7_query_preparatory_conventionally_indir");
  assert.deepEqual(saved.data.human.lexical_downgraders.value, ["downtoner"], "unknown categories are dropped");
  assert.equal(saved.data.isExample, true);

  const noRequest = await call("PUT", `/api/code-sets/${set.id}/units/${thanks.unitId}`, { values: { speech_act: "no_request", head_act: "1_mood_derivable_direct" } });
  assert.deepEqual(Object.keys(noRequest.data.human), ["speech_act"], "request codes do not apply to a non-request");

  const notMine = await call("GET", `/api/code-sets/${set.id}/units?status=not_coded_by_me`);
  assert.equal(notMine.data.total, 1);
  const examples = await call("GET", `/api/code-sets/${set.id}/units?status=examples`);
  assert.equal(examples.data.total, 1);

  const pairs = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "reply_quality" })).data.set;
  const pairUnits = await call("GET", `/api/code-sets/${pairs.id}/units?kind=written`);
  assert.equal(pairUnits.data.total, 2);
  assert.ok(pairUnits.data.units.every((u) => u.userText), "each bot reply comes with the user message it answers");
  const convs = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "conversation_outcomes" })).data.set;
  assert.equal((await call("GET", `/api/code-sets/${convs.id}/units`)).data.total, 2);
});

test("the AI codes a unit using the scheme and the researcher's examples, and agreement is measured", async (t) => {
  const claude = fakeClaude();
  const { call, projectId } = await setup(t, { claude });
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" })).data.set;
  const units = (await call("GET", `/api/code-sets/${set.id}/units`)).data.units;
  const polite = units.find((u) => /possibly/.test(u.text));
  const blunt = units.find((u) => /now/.test(u.text));
  await call("PUT", `/api/code-sets/${set.id}/units/${polite.unitId}`, { values: { speech_act: "request", head_act: "7_query_preparatory_conventionally_indir" }, isExample: true });
  await call("PUT", `/api/code-sets/${set.id}/units/${blunt.unitId}`, { values: { speech_act: "request", head_act: "1_mood_derivable_direct" } });

  const est = await call("POST", `/api/code-sets/${set.id}/estimate`, { count: 10, unitId: blunt.unitId });
  assert.ok(est.data.costUsd > 0);
  assert.equal(est.data.exampleCount, 1);

  const coded = await call("POST", `/api/code-sets/${set.id}/units/${blunt.unitId}/ai`);
  assert.equal(coded.status, 200, JSON.stringify(coded.data));
  assert.equal(coded.data.ai.speech_act.value, "request");
  assert.equal(coded.data.ai.head_act.value, "5_want_statement_direct");
  assert.match(coded.data.ai.head_act.explanation, /head_act/);
  assert.equal(coded.data.exampleCount, 1);

  const req = claude.calls.at(-1);
  assert.match(req.system, /CODING SCHEME: CCSARP: requests/);
  assert.match(req.system, /Example 1[\s\S]*could you possibly tell me[\s\S]*head_act: 7_query_preparatory/, "the researcher's example is shown with its codes");
  assert.match(req.system, /Applies only when Contains a request is Request/);
  assert.match(req.messages[0].content, /USER MESSAGE TO CODE\nCancel my appointment now\./);
  assert.doesNotMatch(req.system + req.messages[0].content, /scenario|personaName|"kind"|Polite request/i, "the AI codes blind to conversation metadata (type, title, scenario, persona)");
  assert.ok(req.schema.properties.head_act.properties.applies, "conditional codes say whether they apply");

  await call("POST", `/api/code-sets/${set.id}/units/${polite.unitId}/ai`);
  const agr = await call("GET", `/api/code-sets/${set.id}/agreement`);
  assert.equal(agr.data.unitsCodedByBoth, 2);
  const speech = agr.data.codes.find((c) => c.key === "speech_act");
  assert.equal(speech.n, 2);
  assert.equal(speech.percentAgreement, 1);
  const head = agr.data.codes.find((c) => c.key === "head_act");
  assert.equal(head.n, 2);
  assert.equal(head.percentAgreement, 0);
  assert.equal(head.disagreements.length, 2);
  assert.ok(head.disagreements.every((d) => d.explanation), "the AI's reasons are shown with each disagreement");

  const accepted = await call("POST", `/api/code-sets/${set.id}/units/${blunt.unitId}/accept-ai`, { codeKey: "head_act" });
  assert.equal(accepted.data.human.head_act.value, "5_want_statement_direct");
  assert.equal(accepted.data.human.speech_act.value, "request", "other codes are kept");

  const s = (await call("PATCH", `/api/codes/${set.codes[1].id}`, { definition: "Changed." })).data.set;
  const after = await call("GET", `/api/code-sets/${set.id}/agreement`);
  assert.ok(after.data.codes.find((c) => c.key === "head_act").outdated > 0, "codes from an older version of a code are kept apart");
  assert.equal(s.codes[1].version, 2);

  const usage = await call("GET", `/api/projects/${projectId}`);
  assert.ok(usage.data.usage.rows.some((r) => r.kind === "AI coding"));
});

test("bot replies are coded with the passages and system instructions; deleting a set removes its codes", async (t) => {
  const claude = fakeClaude();
  const { call, projectId, liveId } = await setup(t, { claude });
  await call("POST", `/api/projects/${projectId}/embed`);
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "reply_quality" })).data.set;
  const unit = (await call("GET", `/api/code-sets/${set.id}/units?conversationId=${liveId}`)).data.units[0];
  await call("POST", `/api/code-sets/${set.id}/units/${unit.unitId}/ai`);
  const prompt = claude.calls.at(-1).messages[0].content;
  assert.match(prompt, /USER MESSAGE\nCancel my appointment now\./);
  assert.match(prompt, /THE CHATBOT'S SYSTEM INSTRUCTIONS/);
  assert.match(prompt, /PASSAGES THE CHATBOT WAS GIVEN\n\[1\] \(Guide\) Appointments can be cancelled/);
  assert.match(prompt, /CHATBOT REPLY TO CODE/);
  await call("DELETE", `/api/code-sets/${set.id}`);
  assert.equal((await call("GET", `/api/projects/${projectId}/code-sets`)).data.sets.length, 0);
});
