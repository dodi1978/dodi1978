import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { SYSTEM_PROMPT } from "./prompt.js";
import { TurnSchema, ReportSchema } from "./schemas.js";
import { toMessages, reportRequest, normaliseTurn, normaliseReport } from "./conversation.js";

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

export async function aiTurn({ history, session }) {
  const messages = toMessages(history, session);
  if (!messages.length || messages.at(-1).role !== "user") {
    throw new Error("The last message must come from the person");
  }
  return normaliseTurn(await call(messages, TurnSchema, TURN_EFFORT, 4000));
}

export async function aiReport({ history, session }) {
  return normaliseReport(await call([{ role: "user", content: reportRequest({ history, session }) }], ReportSchema, REPORT_EFFORT, 16000));
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.TACSI_FORCE_AI);
}
