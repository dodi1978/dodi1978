import { test } from "node:test";
import assert from "node:assert/strict";
import { demoTurn, demoReport, detectTopics, detectRisk } from "../src/demo.js";
import { findConceptsInText } from "../src/knowledge/concepts.js";
import { getService } from "../src/knowledge/services.js";

function converse(messages, session = {}) {
  const history = [];
  let demoState = null;
  let last;
  for (const text of messages) {
    history.push({ role: "user", text });
    last = demoTurn({ history, session, demoState });
    demoState = last.state;
    history.push({ role: "assistant", text: last.result.reply });
  }
  return { history, demoState, result: last.result };
}

test("detects several linked needs in one messy message", () => {
  const topics = detectTopics("my husband hits me and we owe council tax and landlord says leave");
  assert.deepEqual(new Set(topics), new Set(["safety", "money", "housing"]));
});

test("does not treat everyday words as needs", () => {
  assert.deepEqual(detectTopics("can you send me the form"), []);
});

test("flags immediate danger", () => {
  assert.equal(detectRisk("I want to end my life").level, "immediate");
  assert.equal(detectRisk("he hits me sometimes").level, "concern");
  assert.equal(detectRisk("I need help with a form").level, "none");
});

test("explains UK concepts found in what people write", () => {
  const found = findConceptsInText("I got a letter about council tax and bailiffs").map((c) => c.id);
  assert.ok(found.includes("council-tax"));
  assert.ok(found.includes("bailiffs"));
});

test("asks what it is about when the topic is unclear", () => {
  const { result } = converse(["I don't know what to do"]);
  assert.match(result.reply, /What is this mostly about/);
  assert.ok(result.quick_replies.length > 0);
});

test("scaffolds with one question at a time and gives first aid for debt", () => {
  const { result } = converse(["I owe council tax and a man said bailiffs are coming"]);
  assert.match(result.reply, /Who do you owe money to/);
  assert.ok(result.first_aid.some((x) => /door/i.test(x)));
  assert.ok(result.concepts.length > 0);
});

test("shows emergency help straight away when someone is not safe", () => {
  const { result } = converse(["my partner is going to kill me"]);
  assert.equal(result.risk.level, "immediate");
  assert.match(result.reply, /999/);
});

test("a full conversation reaches a referral with a staff report", () => {
  const { history, demoState, result } = converse(
    ["My landlord gave me a section 21 letter", "I rent from a private landlord", "Yes", "Yes", "No, that's everything"],
  );
  assert.equal(result.ready_for_referral, true);
  const report = demoReport({ history, demoState });
  assert.ok(report.citizen.referrals.length > 0);
  for (const r of report.citizen.referrals) assert.ok(getService(r.service_id), `unknown service ${r.service_id}`);
  assert.ok(report.citizen.referrals.some((r) => r.service_id === "shelter"));
  assert.equal(report.staff.priority, "high");
  assert.ok(report.citizen.words_to_know.some((w) => /Eviction/.test(w.term)));
});

test("picture buttons tapped before the chat guide the questions", () => {
  const { result } = converse(["I need help"], { topics: ["education"] });
  assert.match(result.reply, /school place/);
});

test("urgent report includes 999 and is marked urgent", () => {
  const { history, demoState } = converse(["He is hurting me now and I am scared", "No"]);
  const report = demoReport({ history, demoState });
  assert.equal(report.staff.priority, "urgent");
  assert.equal(report.citizen.referrals[0].service_id, "emergency-999");
  assert.ok(report.staff.safeguarding_flags.length > 0);
});

test("AI output is normalised to known values, erring on the safe side", async () => {
  const { normaliseTurn, normaliseReport } = await import("../src/conversation.js");
  const turn = normaliseTurn({ topics: ["Money", "space travel"], risk: { level: "HIGH?", reason: "" }, quick_replies: ["a", "b", "c", "d", "e"] });
  assert.deepEqual(turn.topics, ["money"]);
  assert.equal(turn.risk.level, "concern");
  assert.equal(turn.quick_replies.length, 4);
  const report = normaliseReport({
    citizen: { referrals: [{ service_id: "shelter" }, { service_id: "made-up" }] },
    staff: { priority: "Urgent", triage_types: ["global", "x"], presenting_issues: [{ topic: "moon", description: "" }], referrals: [{ service_id: "made-up" }] },
  });
  assert.equal(report.staff.priority, "urgent");
  assert.deepEqual(report.citizen.referrals.map((r) => r.service_id), ["shelter"]);
  assert.equal(report.staff.presenting_issues[0].topic, "other");
  assert.equal(report.staff.referrals.length, 0);
});
