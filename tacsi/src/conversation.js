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
