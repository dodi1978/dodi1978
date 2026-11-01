// Calls to Claude. Kept behind one small interface so tests can swap in a fake.

import Anthropic from "@anthropic-ai/sdk";
import { modelInfo, DEFAULT_MODEL } from "./pricing.js";

export class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function explain(err) {
  if (err instanceof Anthropic.AuthenticationError) return new AIError("Claude rejected the API key. Check ANTHROPIC_API_KEY.", 502);
  if (err instanceof Anthropic.PermissionDeniedError) return new AIError("This API key may not use that model.", 502);
  if (err instanceof Anthropic.NotFoundError) return new AIError("Claude does not recognise that model.", 502);
  if (err instanceof Anthropic.RateLimitError) return new AIError("Claude is busy or your spending limit was reached. Try again shortly.", 429);
  if (err instanceof Anthropic.BadRequestError) return new AIError(`Claude could not process the request: ${err.message}`, 502);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new AIError("Claude took too long to answer. Try again, or use a lower effort or a faster model.", 504);
  if (err instanceof Anthropic.APIError) return new AIError(`Claude returned an error (${err.status ?? "network"}).`, 502);
  return err;
}

// Returns { text, model, usage, stopReason, refused }.
export function createClaude({ apiKey, timeoutMs = 25_000 } = {}) {
  let client;
  const getClient = () => (client ??= new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 }));
  return {
    available: Boolean(apiKey),
    async complete({ model = DEFAULT_MODEL, system, messages, maxTokens = 1024, effort = "low" }) {
      if (!apiKey) throw new AIError("Claude is not set up (ANTHROPIC_API_KEY is missing).", 503);
      const info = modelInfo(model);
      const params = {
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort },
      };
      // If a safety classifier declines, the API re-runs the request on a
      // recommended fallback model instead of returning a refusal.
      if (info?.fallback) {
        params.betas = ["server-side-fallback-2026-07-01"];
        params.fallbacks = "default";
      }
      let response;
      try {
        response = await getClient().beta.messages.stream(params).finalMessage();
      } catch (err) {
        throw explain(err);
      }
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      return {
        text,
        model: response.model,
        usage: response.usage,
        stopReason: response.stop_reason,
        refused: response.stop_reason === "refusal",
      };
    },
  };
}
