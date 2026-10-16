import { test } from "node:test";
import assert from "node:assert/strict";
import { demoTurn, demoReport, detectTopics, detectRisk, detectCues } from "../src/demo.js";
import { findConceptsInText } from "../src/knowledge/concepts.js";
import { getService } from "../src/knowledge/services.js";

function converse(messages, session = {}) {
  const history = [];
  let demoState = null;
  const replies = [];
  let last;
  for (const text of messages) {
    history.push({ role: "user", text });
    last = demoTurn({ history, session, demoState });
    demoState = last.state;
    replies.push(last.result.reply);
    history.push({ role: "assistant", text: last.result.reply });
  }
  return { history, demoState, result: last.result, replies };
}

const LABELS = /\b(abuse|abusive|abuser|violence|violent|victim|perpetrator)\b/i;

test("detects the everyday problems that come with domestic abuse", () => {
  const topics = detectTopics("my visa is a spouse visa, we have debts and the kids, and I need somewhere to live");
  for (const t of ["immigration", "money", "family"]) assert.ok(topics.includes(t), t);
});

test("ordinary mentions of a partner are not treated as disclosure", () => {
  assert.deepEqual(detectTopics("my husband and I need help with council tax").filter((t) => t === "safety"), []);
  assert.deepEqual(detectCues("my husband and I need help with council tax"), []);
});

test("recognises indirect signs of abuse", () => {
  assert.ok(detectCues("he takes my wages every month").includes("Economic abuse"));
  assert.ok(detectCues("he checks my phone all the time").includes("Coercive control"));
  assert.ok(detectCues("I am walking on eggshells").includes("Fear"));
  assert.ok(detectCues("he keeps my passport").includes("Immigration abuse"));
});

test("flags immediate danger", () => {
  assert.equal(detectRisk("he is going to kill me").level, "immediate");
  assert.equal(detectRisk("he gets angry a lot").level, "concern");
  assert.equal(detectRisk("I need help with a form").level, "none");
});

test("helps with the money problem first, without naming abuse", () => {
  const { replies } = converse(["I need help with money"]);
  assert.match(replies[0], /main money problem/);
  assert.doesNotMatch(replies[0], LABELS);
});

test("an indirect sign leads to one gentle question that is easy to decline, never a label", () => {
  const { replies, result } = converse(["I need help with money", "Someone else controls the money"]);
  assert.match(replies[1], /bigger worry at home/);
  assert.match(replies[1], /do not have to answer/);
  assert.doesNotMatch(replies[1], LABELS);
  assert.ok(result.quick_replies.includes("No"));
});

test("if she says no, TACSI accepts it, keeps helping and does not ask again", () => {
  const { replies } = converse([
    "I need help with money",
    "He takes my wages",
    "No",
    "Yes",
    "A few weeks",
    "My partner",
  ]);
  assert.match(replies[2], /That is OK/);
  assert.equal(replies.filter((r) => /bigger worry at home/.test(r)).length, 1);
  for (const r of replies) assert.doesNotMatch(r, LABELS);
});

test("if she says yes, TACSI believes her and first checks it is safe to talk", () => {
  const { replies } = converse(["I need help with money", "He takes my wages", "Yes, things are hard at home"]);
  assert.match(replies[2], /not your fault/);
  assert.match(replies[2], /safe to talk|OK to talk/i);
});

test("if someone is with her, TACSI keeps it short and skips sensitive questions", () => {
  const { replies, demoState } = converse(["My husband hurts me", "Someone is with me"]);
  assert.match(replies[1], /Leave this page/);
  assert.equal(demoState.notPrivate, true);
  assert.doesNotMatch(replies[1], /strangle|kill/i);
});

test("a later mention of problems at home is recognised", () => {
  const { demoState } = converse(["I need help with my visa", "I'm on a spouse or partner visa", "things are hard at home"]);
  assert.equal(demoState.disclosure, "direct");
  assert.ok(demoState.topics.includes("safety"));
});

test("covers family law, criminal law and immigration questions", () => {
  assert.match(converse(["I need help with the children and court"]).result.reply, /family or children/);
  assert.match(converse(["I want to talk about the police"]).result.reply, /What is this about/);
  assert.match(converse(["I have a spouse visa"]).result.reply, /closest to your situation/);
});

test("explains legal ideas in plain words", () => {
  const found = findConceptsInText("can I get a non-molestation order and what is Clare's Law").map((c) => c.id);
  assert.ok(found.includes("non-molestation-order"));
  assert.ok(found.includes("clares-law"));
});

test("passport kept by someone else is noted as a sign", () => {
  const { demoState } = converse(["I have a spouse visa", "I'm on a spouse or partner visa", "No, someone else keeps them"]);
  assert.ok(demoState.cues.some((c) => c.theme === "Immigration abuse"));
});

test("high-risk answers raise the priority and recommend IDVA and MARAC", () => {
  const { history, demoState } = converse(["My husband hurts me", "It's OK to talk", "Yes", "Yes", "Yes", "Yes"]);
  const report = demoReport({ history, demoState });
  assert.equal(report.staff.disclosure, "direct");
  assert.notEqual(report.staff.priority, "standard");
  assert.ok(report.staff.risk_indicators.some((r) => /strangling/i.test(r.theme)));
  assert.ok(report.staff.recommended_actions.some((a) => /MARAC/.test(a)));
});

test("the report for an indirect disclosure refers to specialist help without labelling her", () => {
  const { history, demoState } = converse(["I need help with money", "He takes my wages", "No", "No", "Months or longer", "No, that's everything"]);
  const report = demoReport({ history, demoState });
  assert.equal(report.staff.disclosure, "indirect");
  assert.ok(report.staff.risk_indicators.some((r) => r.theme === "Economic abuse"));
  const ids = report.citizen.referrals.map((r) => r.service_id);
  assert.ok(ids.includes("domestic-abuse-helpline"));
  assert.ok(ids.includes("local-da-service"));
  for (const id of ids) assert.ok(getService(id), `unknown service ${id}`);
  assert.doesNotMatch(report.citizen.summary, LABELS);
  assert.ok(report.citizen.do_now.some((x) => /if it is safe/.test(x)));
});

test("no signs, no domestic abuse referral", () => {
  const { history, demoState } = converse(["I owe council tax", "I owe money", "Council tax", "No", "Yes", "A few weeks", "No, that's everything"]);
  const report = demoReport({ history, demoState });
  assert.equal(report.staff.disclosure, "none");
  assert.ok(!report.citizen.referrals.some((r) => r.service_id === "domestic-abuse-helpline"));
});

test("AI output is normalised: signs of abuse always count as at least indirect", async () => {
  const { normaliseReport } = await import("../src/conversation.js");
  const report = normaliseReport({
    citizen: { referrals: [{ service_id: "shelter" }, { service_id: "made-up" }] },
    staff: {
      priority: "Urgent", triage_types: [], presenting_issues: [], referrals: [],
      disclosure: "none", risk_indicators: [{ theme: "Economic abuse", evidence: "takes my wages" }],
    },
  });
  assert.equal(report.staff.disclosure, "indirect");
  assert.deepEqual(report.citizen.referrals.map((r) => r.service_id), ["shelter"]);
});

test("Claude is told which questions it has already asked", async () => {
  const { toMessages } = await import("../src/conversation.js");
  const history = [
    { role: "assistant", text: "Hello. I am TACSI." },
    { role: "user", text: "I need money help" },
    { role: "assistant", text: "Thank you. What is the main money problem?" },
    { role: "user", text: "He takes my wages" },
  ];
  const messages = toMessages(history, { language: "en", languageName: "English" }, { tips: [] });
  assert.match(messages.at(-1).content, /- What is the main money problem\?/);
});

test("the system prompt carries the indirect-disclosure rules", async () => {
  const { SYSTEM_PROMPT, REPORT_INSTRUCTIONS } = await import("../src/prompt.js");
  assert.match(SYSTEM_PROMPT, /Do not name it as abuse/);
  assert.match(SYSTEM_PROMPT, /Family law/);
  assert.match(SYSTEM_PROMPT, /Criminal law/);
  assert.match(SYSTEM_PROMPT, /couples counselling, family mediation/);
  assert.match(REPORT_INSTRUCTIONS, /DASH/);
});

test("the demo does not offer group-specific services to everyone, or repeat itself", () => {
  const { history, demoState, replies } = converse(["I can't pay the bills", "Someone else controls the money", "Yes, things are hard at home"]);
  assert.equal(replies[2].match(/not your fault/g).length, 1);
  assert.equal(demoState.topics.filter((t) => t === "safety").length, 1);
  const ids = demoReport({ history, demoState }).citizen.referrals.map((r) => r.service_id);
  assert.ok(!ids.includes("mens-advice-line") && !ids.includes("galop"));
});
