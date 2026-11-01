// Approximate API prices in US dollars per million tokens, used for the running
// cost totals in the app. Check the providers' pricing pages for current rates.

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (most capable)", input: 4, output: 20, fallback: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, cheaper)", input: 2, output: 10, fallback: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)", input: 0.1, output: 0.5, fallback: false },
];

export const DEFAULT_MODEL = "claude-opus-5-5";
export const EFFORTS = ["low", "medium", "high"];

const VOYAGE_PER_MILLION = { "voyage-4": 0.06, "voyage-4-lite": 0.02, "voyage-4-large": 0.12 };

export function modelInfo(id) {
  return MODELS.find((m) => m.id === id);
}

// usage: the `usage` object of a Claude response.
export function claudeCost(modelId, usage = {}) {
  const info = modelInfo(modelId) ?? MODELS[0];
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * info.input + (usage.output_tokens ?? 0) * info.output) / 1_000_000;
}

// Voyage gives each account 200 million free tokens; this is the list price after that.
export function voyageCost(model, tokens) {
  return ((VOYAGE_PER_MILLION[model] ?? 0.06) * tokens) / 1_000_000;
}
