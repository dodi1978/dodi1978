// Conversation helpers shared by the server (Claude API) and the shareable
// link version (Claude through the viewer's claude.ai account).

import { REPORT_INSTRUCTIONS, sessionContext } from "./prompt.js";
import { RISK_LEVELS, PRIORITIES, TRIAGE_TYPES } from "./schemas.js";
import { SERVICES, TOPICS } from "./knowledge/services.js";

// history: [{ role: "user" | "assistant", text }]. Leading assistant turns
// (the on-screen greeting) are dropped because the API needs a user turn first.
export function toMessages(history, session) {
  const firstUser = history.findIndex((m) => m.role === "user");
  const turns = firstUser === -1 ? [] : history.slice(firstUser);
  const messages = [];
  for (const m of turns) {
    const prev = messages.at(-1);
    if (prev && prev.role === m.role) {
      prev.content += `\n\n${m.text}`;
    } else {
      messages.push({ role: m.role, content: m.text });
    }
  }
  if (messages.length) messages[0].content = `${sessionContext(session)}\n\nThe person says:\n${messages[0].content}`;
  return messages;
}

export function reportRequest({ history, session }) {
  const transcript = history
    .map((m) => `${m.role === "user" ? "Person" : "TACSI"}: ${m.text}${m.english && m.english !== m.text ? `\n  [English: ${m.english}]` : ""}`)
    .join("\n");
  return `${sessionContext(session)}\n\nTranscript:\n${transcript}\n\n${REPORT_INSTRUCTIONS}`;
}

const clean = (v) => String(v ?? "").trim().toLowerCase();
const pick = (v, allowed, fallback) => (allowed.includes(clean(v)) ? clean(v) : fallback);

// Unknown values fall to the safer side: a risk level we cannot read counts as "concern".
export function normaliseTurn(turn) {
  turn.topics = [...new Set(turn.topics.map(clean).filter((x) => TOPICS.includes(x)))];
  turn.risk.level = pick(turn.risk.level, RISK_LEVELS, "concern");
  turn.quick_replies = turn.quick_replies.slice(0, 4);
  return turn;
}

export function normaliseReport(report) {
  const s = report.staff;
  s.priority = pick(s.priority, PRIORITIES, "high");
  s.triage_types = [...new Set(s.triage_types.map(clean).filter((x) => TRIAGE_TYPES.includes(x)))];
  s.presenting_issues = s.presenting_issues.map((i) => ({ ...i, topic: pick(i.topic, TOPICS, "other") }));
  // Drop any referral the model invented outside the directory.
  const known = new Set(SERVICES.map((x) => x.id));
  report.citizen.referrals = report.citizen.referrals.filter((r) => known.has(r.service_id));
  s.referrals = s.referrals.filter((r) => known.has(r.service_id));
  return report;
}

// The link version gets plain JSON back, not schema-enforced output. Fill
// gaps with safe defaults so one missing field does not throw away a good
// answer; only a missing reply (or report summary) counts as a failure.
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const strs = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const terms = (v) => (Array.isArray(v) ? v.map(obj).filter((c) => c.term).map((c) => ({ term: str(c.term), explanation: str(c.explanation) })) : []);

export function coerceTurn(raw) {
  const t = obj(raw);
  if (!str(t.reply).trim()) throw new Error("Answer had no reply");
  return normaliseTurn({
    reply: str(t.reply),
    reply_english: str(t.reply_english) || str(t.reply),
    user_message_english: str(t.user_message_english),
    quick_replies: strs(t.quick_replies),
    concepts: terms(t.concepts),
    topics: strs(t.topics),
    risk: { level: str(obj(t.risk).level), reason: str(obj(t.risk).reason) },
    first_aid: strs(t.first_aid),
    ready_for_referral: t.ready_for_referral === true,
  });
}

export function coerceReport(raw) {
  const c = obj(obj(raw).citizen);
  const s = obj(obj(raw).staff);
  if (!str(c.summary).trim()) throw new Error("Report had no summary");
  return normaliseReport({
    citizen: {
      summary: str(c.summary),
      referrals: (Array.isArray(c.referrals) ? c.referrals : []).map(obj).map((r) => ({
        service_id: str(r.service_id),
        why: str(r.why),
        what_to_say: str(r.what_to_say),
        what_to_bring: strs(r.what_to_bring),
      })),
      do_now: strs(c.do_now),
      dont: strs(c.dont),
      words_to_know: terms(c.words_to_know),
    },
    staff: {
      headline: str(s.headline) || "TACSI referral",
      priority: str(s.priority),
      priority_reason: str(s.priority_reason),
      triage_types: strs(s.triage_types),
      presenting_issues: (Array.isArray(s.presenting_issues) ? s.presenting_issues : []).map(obj).map((i) => ({ topic: str(i.topic), description: str(i.description) })),
      key_facts: strs(s.key_facts),
      deadlines: strs(s.deadlines),
      safeguarding_flags: strs(s.safeguarding_flags),
      access_needs: strs(s.access_needs),
      person_goals: str(s.person_goals),
      unknowns: strs(s.unknowns),
      recommended_actions: strs(s.recommended_actions),
      referrals: (Array.isArray(s.referrals) ? s.referrals : []).map(obj).map((r) => ({ service_id: str(r.service_id), rationale: str(r.rationale) })),
    },
  });
}
