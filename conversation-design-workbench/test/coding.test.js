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

test("the library offers the four code sets, and the rapport set follows the project's framework", async (t) => {
  const { call, projectId } = await setup(t);
  const lib = await call("GET", `/api/projects/${projectId}/code-library`);
  assert.deepEqual(lib.data.presets.map((p) => p.id), ["ccsarp_requests", "brown_levinson", "industry_evals", "rapport"]);
  assert.deepEqual(lib.data.presets.map((p) => p.appliesTo), ["user", "user", "pair", "pair"]);
  assert.equal(lib.data.presets.find((p) => p.id === "rapport").codeCount, 6, "one effect-on-rapport code per GAAFFE dimension");

  const ccsarp = await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" });
  const codes = ccsarp.data.set.codes;
  assert.equal(codes.length, 6);
  assert.deepEqual(codes[0].options.map((o) => o.value), ["no_request", "request_for_information", "request_for_action"]);
  const head = codes.find((c) => c.key === "head_act");
  assert.equal(head.options.length, 12, "3 directness levels with the 9 strategies under them");
  assert.deepEqual(head.options.filter((o) => !o.parent).map((o) => o.value), ["direct", "conventionally_indirect", "non_conventionally_indirect"]);
  assert.equal(head.options.find((o) => o.value === "7_query_preparatory").parent, "conventionally_indirect");
  assert.ok(codes.slice(1).every((c) => c.condition?.codeKey === "request_type" && c.condition.values.join() === "request_for_information,request_for_action"), "request codes apply only to requests");

  const bl = await call("POST", `/api/projects/${projectId}/code-library`, { preset: "brown_levinson" });
  assert.deepEqual(bl.data.set.codes.map((c) => c.key), ["positive_politeness", "negative_politeness", "off_record", "bald_on_record", "no_fta"], "the five superstrategies come first");
  assert.deepEqual(bl.data.set.codes.map((c) => c.options?.length ?? c.type), [15, 10, 15, "yes_no", "yes_no"]);

  await call("PUT", `/api/projects/${projectId}/framework`, { framework: { name: "Mine", dimensions: [{ name: "Warmth", definition: "d", builds: ["Friendly"], breaks: ["Cold"] }] } });
  const rapport = await call("POST", `/api/projects/${projectId}/code-library`, { preset: "rapport" });
  assert.deepEqual(rapport.data.set.codes.map((c) => c.key), ["warmth_effect"]);
  assert.deepEqual(rapport.data.set.codes[0].options.map((o) => [o.label, o.parent ?? null]), [["Builds rapport", null], ["Friendly", "builds_rapport"], ["Breaks rapport", null], ["Cold", "breaks_rapport"], ["Neutral", null]]);
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
    values: { request_type: "request_for_action", head_act: "7_query_preparatory", perspective: "hearer_oriented", internal_modification: ["downtoner", "nonsense"], alerters: ["attention_getter_greeting"] },
    isExample: true,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.human.head_act.value, "7_query_preparatory");
  assert.deepEqual(saved.data.human.internal_modification.value, ["downtoner"], "unknown categories are dropped");
  assert.equal(saved.data.isExample, true);

  const noRequest = await call("PUT", `/api/code-sets/${set.id}/units/${thanks.unitId}`, { values: { request_type: "no_request", head_act: "1_mood_derivable" } });
  assert.deepEqual(Object.keys(noRequest.data.human), ["request_type"], "request codes do not apply to a non-request");

  const notMine = await call("GET", `/api/code-sets/${set.id}/units?status=not_coded_by_me`);
  assert.equal(notMine.data.total, 1);
  const examples = await call("GET", `/api/code-sets/${set.id}/units?status=examples`);
  assert.equal(examples.data.total, 1);

  const pairs = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "industry_evals" })).data.set;
  assert.deepEqual(pairs.levels, ["pair", "conversation"]);
  const pairUnits = await call("GET", `/api/code-sets/${pairs.id}/units?kind=written`);
  assert.equal(pairUnits.data.total, 2);
  assert.ok(pairUnits.data.units.every((u) => u.userText), "each bot reply comes with the user message it answers");
  assert.equal((await call("GET", `/api/code-sets/${pairs.id}/units?level=conversation`)).data.total, 2, "the same set codes whole conversations too");
  assert.equal((await call("GET", `/api/code-sets/${pairs.id}/units?level=user`)).status, 400);
});

test("the AI codes a unit using the scheme and the researcher's examples, and agreement is measured", async (t) => {
  const claude = fakeClaude();
  const { call, projectId } = await setup(t, { claude });
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" })).data.set;
  const units = (await call("GET", `/api/code-sets/${set.id}/units`)).data.units;
  const polite = units.find((u) => /possibly/.test(u.text));
  const blunt = units.find((u) => /now/.test(u.text));
  await call("PUT", `/api/code-sets/${set.id}/units/${polite.unitId}`, { values: { request_type: "request_for_information", head_act: "7_query_preparatory" }, isExample: true });
  await call("PUT", `/api/code-sets/${set.id}/units/${blunt.unitId}`, { values: { request_type: "request_for_information", head_act: "1_mood_derivable" } });

  const est = await call("POST", `/api/code-sets/${set.id}/estimate`, { count: 10, unitId: blunt.unitId });
  assert.ok(est.data.costUsd > 0);
  assert.equal(est.data.exampleCount, 1);

  const coded = await call("POST", `/api/code-sets/${set.id}/units/${blunt.unitId}/ai`);
  assert.equal(coded.status, 200, JSON.stringify(coded.data));
  assert.equal(coded.data.ai.request_type.value, "request_for_information");
  assert.equal(coded.data.ai.head_act.value, "5_want_statement");
  assert.match(coded.data.ai.head_act.explanation, /head_act/);
  assert.equal(coded.data.exampleCount, 1);

  const req = claude.calls.at(-1);
  assert.match(req.system, /CODING SCHEME: CCSARP: requests/);
  assert.match(req.system, /Example 1[\s\S]*could you possibly tell me[\s\S]*head_act: 7_query_preparatory/, "the researcher's example is shown with its codes");
  assert.match(req.system, /Applies only when Request type is Request for information or Request for action/);
  assert.match(req.messages[0].content, /USER MESSAGE TO CODE\nCancel my appointment now\./);
  assert.doesNotMatch(req.system + req.messages[0].content, /scenario|personaName|"kind"|Polite request/i, "the AI codes blind to conversation metadata (type, title, scenario, persona)");
  assert.ok(req.schema.properties.head_act.properties.applies, "conditional codes say whether they apply");

  await call("POST", `/api/code-sets/${set.id}/units/${polite.unitId}/ai`);
  const agr = await call("GET", `/api/code-sets/${set.id}/agreement`);
  assert.equal(agr.data.unitsCodedByBoth, 2);
  const speech = agr.data.codes.find((c) => c.key === "request_type");
  assert.equal(speech.n, 2);
  assert.equal(speech.percentAgreement, 1);
  const head = agr.data.codes.find((c) => c.key === "head_act");
  assert.equal(head.n, 2);
  assert.equal(head.percentAgreement, 0);
  assert.equal(head.disagreements.length, 2);
  assert.ok(head.disagreements.every((d) => d.explanation), "the AI's reasons are shown with each disagreement");

  const accepted = await call("POST", `/api/code-sets/${set.id}/units/${blunt.unitId}/accept-ai`, { codeKey: "head_act" });
  assert.equal(accepted.data.human.head_act.value, "5_want_statement");
  assert.equal(accepted.data.human.request_type.value, "request_for_information", "other codes are kept");

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
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "industry_evals" })).data.set;
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

test("categories can sit under superior categories, and conditions follow the hierarchy", async () => {
  const { sanitiseCode, conditionMet, topLevel } = await import("../src/codebooks.js");
  const code = sanitiseCode({
    name: "Tone", type: "category",
    options: [{ label: "Warm", parent: "Positive" }, { label: "Negative" }, { label: "Positive" }, { label: "Curt", parent: "Negative" }, { label: "Loop A", parent: "Loop B" }, { label: "Loop B", parent: "Loop A" }],
  });
  assert.deepEqual(code.options.map((o) => [o.value, o.parent ?? ""]),
    [["negative", ""], ["curt", "negative"], ["positive", ""], ["warm", "positive"], ["loop_a", ""], ["loop_b", "loop_a"]],
    "tree order; parents given by label; a loop is broken but both categories are kept");
  assert.equal(topLevel(code.options, "warm"), "positive");
  const child = { condition: { codeKey: "tone", values: ["positive"] } };
  assert.equal(conditionMet(child, { tone: "warm" }, code), true, "a subordinate category meets a condition on its superior category");
  assert.equal(conditionMet(child, { tone: "curt" }, code), false);
});

test("coding only some codes keeps the others, for you and for the AI", async (t) => {
  const claude = fakeClaude();
  const { call, projectId } = await setup(t, { claude });
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" })).data.set;
  const unit = (await call("GET", `/api/code-sets/${set.id}/units`)).data.units.find((u) => /possibly/.test(u.text));
  await call("PUT", `/api/code-sets/${set.id}/units/${unit.unitId}`, { values: { request_type: "request_for_action", head_act: "7_query_preparatory", perspective: "hearer_oriented" } });
  // Now code only the internal modification: head act and perspective stay.
  const later = await call("PUT", `/api/code-sets/${set.id}/units/${unit.unitId}`, { codeKeys: ["internal_modification"], values: { request_type: "request_for_action", internal_modification: ["downtoner", "conditional"] } });
  assert.deepEqual(Object.keys(later.data.human).sort(), ["head_act", "internal_modification", "perspective", "request_type"]);
  assert.equal(later.data.human.head_act.value, "7_query_preparatory");
  // Status filters follow the chosen codes.
  const notYet = await call("GET", `/api/code-sets/${set.id}/units?status=not_coded_by_me&codes=alerters`);
  assert.ok(notYet.data.units.some((u) => u.unitId === unit.unitId) === false, "request_type (needed by alerters) counts as coded");

  // The AI codes only the head act (plus "contains a request", which it depends on).
  await call("POST", `/api/code-sets/${set.id}/units/${unit.unitId}/ai`);
  const before = claude.calls.length;
  const partial = await call("POST", `/api/code-sets/${set.id}/units/${unit.unitId}/ai`, { codeKeys: ["head_act"] });
  assert.equal(partial.status, 200, JSON.stringify(partial.data));
  const req = claude.calls[before];
  assert.deepEqual(Object.keys(req.schema.properties).sort(), ["head_act", "request_type"]);
  assert.doesNotMatch(req.system, /### perspective/);
  assert.match(req.system, /indented categories are subordinate/);
  assert.ok(partial.data.ai.perspective, "the AI's other codes are kept");
  const est = await call("POST", `/api/code-sets/${set.id}/estimate`, { count: 10, unitId: unit.unitId, codeKeys: ["head_act"] });
  const estAll = await call("POST", `/api/code-sets/${set.id}/estimate`, { count: 10, unitId: unit.unitId });
  assert.ok(est.data.costUsd < estAll.data.costUsd, "fewer codes cost less");
});

test("agreement is also measured at the level of superior categories", async (t) => {
  const { call, projectId } = await setup(t, { claude: fakeClaude() });
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" })).data.set;
  const units = (await call("GET", `/api/code-sets/${set.id}/units`)).data.units.filter((u) => u.text !== "Thanks!");
  // The fake AI codes "5 Want statement" (direct). Code one unit 5 (same) and one 4 (same level, other strategy).
  await call("PUT", `/api/code-sets/${set.id}/units/${units[0].unitId}`, { values: { request_type: "request_for_action", head_act: "5_want_statement" } });
  await call("PUT", `/api/code-sets/${set.id}/units/${units[1].unitId}`, { values: { request_type: "request_for_action", head_act: "4_obligation_statement" } });
  for (const u of units) await call("POST", `/api/code-sets/${set.id}/units/${u.unitId}/ai`, { codeKeys: ["head_act"] });
  const agr = await call("GET", `/api/code-sets/${set.id}/agreement`);
  const head = agr.data.codes.find((c) => c.key === "head_act");
  assert.equal(head.percentAgreement, 0.5, "strategies: one of two agree");
  assert.equal(head.superior.percentAgreement, 1, "directness level: both agree");
  assert.deepEqual(head.superior.categories, ["Direct", "Conventionally indirect", "Non-conventionally indirect"]);
});

test("notes: memos on codes stay private, and notes made while coding are kept", async (t) => {
  const claude = fakeClaude();
  const { call, projectId } = await setup(t, { claude });
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" })).data.set;
  const head = set.codes.find((c) => c.key === "head_act");
  const s = (await call("PATCH", `/api/codes/${head.id}`, { memo: "Check hints against Weizman's coding." })).data.set;
  const edited = s.codes.find((c) => c.key === "head_act");
  assert.equal(edited.memo, "Check hints against Weizman's coding.");
  assert.equal(edited.version, 1, "a memo does not change what the code means");

  const unit = (await call("GET", `/api/code-sets/${set.id}/units`)).data.units.find((u) => /possibly/.test(u.text));
  await call("PUT", `/api/code-sets/${set.id}/units/${unit.unitId}`, { values: { request_type: "request_for_action", head_act: "7_query_preparatory" }, notes: { head_act: "Could also be a hedged want statement." } });
  const later = await call("PUT", `/api/code-sets/${set.id}/units/${unit.unitId}`, { codeKeys: ["perspective"], values: { request_type: "request_for_action", perspective: "hearer_oriented" } });
  assert.equal(later.data.human.head_act.explanation, "Could also be a hedged want statement.", "notes survive coding other codes");

  await call("POST", `/api/code-sets/${set.id}/units/${unit.unitId}/ai`);
  assert.doesNotMatch(claude.calls.at(-1).system, /Weizman/, "memos are not shown to the AI");
});

test("applied codes are counted per category, with totals for superior categories", async (t) => {
  const { call, projectId, writtenId } = await setup(t, { claude: fakeClaude() });
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "ccsarp_requests" })).data.set;
  const units = (await call("GET", `/api/code-sets/${set.id}/units`)).data.units;
  const polite = units.find((u) => /possibly/.test(u.text));
  const blunt = units.find((u) => /now/.test(u.text));
  await call("PUT", `/api/code-sets/${set.id}/units/${polite.unitId}`, { values: { request_type: "request_for_action", head_act: "7_query_preparatory" } });
  await call("PUT", `/api/code-sets/${set.id}/units/${blunt.unitId}`, { values: { request_type: "request_for_action", head_act: "conventionally_indirect" } });
  await call("POST", `/api/code-sets/${set.id}/units/${blunt.unitId}/ai`);
  const f = await call("GET", `/api/code-sets/${set.id}/frequencies`);
  assert.equal(f.status, 200, JSON.stringify(f.data));
  assert.deepEqual(f.data.coded, { human: 2, ai: 1 });
  const head = f.data.codes.find((c) => c.key === "head_act");
  const cat = (v) => head.categories.find((c) => c.value === v);
  assert.equal(cat("conventionally_indirect").human, 2, "the superior category counts its own and its subordinates' units");
  assert.equal(cat("conventionally_indirect").superior, true);
  assert.equal(cat("7_query_preparatory").human, 1);
  assert.equal(cat("5_want_statement").ai, 1);
  assert.equal(cat("direct").ai, 1);
  const onlyWritten = await call("GET", `/api/code-sets/${set.id}/frequencies?kind=written`);
  assert.equal(onlyWritten.data.coded.human, 1, "filters by interaction type");

  const conv = await call("GET", `/api/conversations/${writtenId}/codes`);
  assert.equal(conv.data.sets[0].name, "CCSARP: requests");
  assert.ok(conv.data.annotations.some((a) => a.unitId === polite.unitId && a.coder === "human" && a.value === "7_query_preparatory"));
});

test("one set can hold codes for bot replies and for whole conversations", async (t) => {
  const claude = fakeClaude();
  const { call, projectId, liveId } = await setup(t, { claude });
  const set = (await call("POST", `/api/projects/${projectId}/code-library`, { preset: "industry_evals" })).data.set;
  const reply = (await call("GET", `/api/code-sets/${set.id}/units?conversationId=${liveId}`)).data.units[0];
  await call("POST", `/api/code-sets/${set.id}/units/${reply.unitId}/ai`, {});
  assert.ok(!("task_success" in claude.calls.at(-1).schema.properties), "reply-level coding leaves out conversation codes");
  assert.ok("groundedness" in claude.calls.at(-1).schema.properties);

  const saved = await call("PUT", `/api/code-sets/${set.id}/units/${liveId}`, { level: "conversation", values: { task_success: "resolved", overall_quality: 4, groundedness: "fully_grounded" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(Object.keys(saved.data.human).sort(), ["overall_quality", "task_success"], "only the conversation's own codes are kept");
  const ai = await call("POST", `/api/code-sets/${set.id}/units/${liveId}/ai`, { level: "conversation" });
  assert.equal(ai.status, 200, JSON.stringify(ai.data));
  assert.match(claude.calls.at(-1).messages[0].content, /^CONVERSATION\n/);
  assert.deepEqual(Object.keys(claude.calls.at(-1).schema.properties).sort(), ["adversarial", "overall_quality", "task_success"]);
  const coded = await call("GET", `/api/code-sets/${set.id}/units?level=conversation&status=coded_by_both`);
  assert.equal(coded.data.total, 1);
  assert.equal((await call("GET", `/api/code-sets/${set.id}/units?status=coded_by_me`)).data.total, 0, "reply units are counted on their own");

  const agr = await call("GET", `/api/code-sets/${set.id}/agreement?level=conversation`);
  assert.deepEqual(agr.data.codes.map((c) => c.key), ["task_success", "overall_quality", "adversarial"]);
  assert.equal(agr.data.unitsCodedByBoth, 1);
  const replyAgr = await call("GET", `/api/code-sets/${set.id}/agreement`);
  assert.equal(replyAgr.data.unitsCodedByBoth, 0);
  const freq = await call("GET", `/api/code-sets/${set.id}/frequencies?level=conversation`);
  assert.equal(freq.data.coded.human, 1);

  // A code can only depend on a code on the same unit.
  const bad = await call("POST", `/api/code-sets/${set.id}/codes`, { name: "Why not resolved", type: "comment", condition: { codeKey: "task_success", values: ["not_resolved"] } });
  assert.equal(bad.status, 400);
  const good = await call("POST", `/api/code-sets/${set.id}/codes`, { name: "Why not resolved", type: "comment", unit: "conversation", condition: { codeKey: "task_success", values: ["not_resolved"] } });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  const moved = await call("POST", `/api/code-sets/${set.id}/codes`, { name: "Tone", type: "comment", unit: "pair" });
  assert.equal(moved.data.set.codes.at(-1).unit, undefined, "a code on the set's own unit needs no unit of its own");
});
