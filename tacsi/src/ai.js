import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { SYSTEM_PROMPT, REPORT_INSTRUCTIONS, sessionContext } from "./prompt.js";
import { TurnSchema, ReportSchema, RISK_LEVELS, PRIORITIES, TRIAGE_TYPES } from "./schemas.js";
import { SERVICES, TOPICS } from "./knowledge/services.js";

const MODEL = process.env.TACSI_MODEL || "claude-opus-5";
const TURN_EFFORT = process.env.TACSI_TURN_EFFORT || "medium";
const REPORT_EFFORT = process.env.TACSI_REPORT_EFFORT || "high";

let client;
function getClient() {
  client ??= new Anthropic();
  return client;
}

export class AIUnavailableError extends Error {}

const system = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];

async function call(messages, schema, effort, maxTokens) {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    // If a safety classifier declines, the API re-runs the request on a
    // recommended fallback model instead of returning a refusal.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages,
    output_config: { effort, format: betaZodOutputFormat(schema) },
  });
  if (response.stop_reason === "refusal") {
    throw new AIUnavailableError(`Model declined (${response.stop_details?.category ?? "unknown"})`);
  }
  if (!response.parsed_output) {
    throw new AIUnavailableError(`No structured output (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

// history: [{ role: "user" | "assistant", text }]. Leading assistant turns
// (the on-screen greeting) are dropped because the API needs a user turn first.
function toMessages(history, session) {
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

export async function aiTurn({ history, session }) {
  const messages = toMessages(history, session);
  if (!messages.length || messages.at(-1).role !== "user") {
    throw new Error("The last message must come from the person");
  }
  return normaliseTurn(await call(messages, TurnSchema, TURN_EFFORT, 4000));
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

export async function aiReport({ history, session }) {
  const transcript = history
    .map((m) => `${m.role === "user" ? "Person" : "TACSI"}: ${m.text}${m.english && m.english !== m.text ? `\n  [English: ${m.english}]` : ""}`)
    .join("\n");
  const content = `${sessionContext(session)}\n\nTranscript:\n${transcript}\n\n${REPORT_INSTRUCTIONS}`;
  return normaliseReport(await call([{ role: "user", content }], ReportSchema, REPORT_EFFORT, 16000));
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.TACSI_FORCE_AI);
}
