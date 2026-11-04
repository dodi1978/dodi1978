// Meaning-based search: Voyage AI turns text into embeddings ("meaning fingerprints").

import { EMBEDDING_DIMENSIONS } from "./db.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export class EmbeddingError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createEmbedder({ apiKey, model = "voyage-4", fetchImpl = fetch } = {}) {
  return {
    available: Boolean(apiKey),
    model,
    // inputType is "document" for passages and "query" for questions.
    async embed(texts, inputType) {
      if (!apiKey) throw new EmbeddingError("Voyage AI is not set up (VOYAGE_API_KEY is missing).", 503);
      let response;
      try {
        response = await fetchImpl(VOYAGE_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ input: texts, model, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new EmbeddingError("Voyage AI could not be reached.", 502);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const hint = response.status === 401 ? " Check VOYAGE_API_KEY." : response.status === 429 ? " Too many requests: add a payment method in Voyage AI to raise the limit, or wait a minute." : "";
        throw new EmbeddingError(`Voyage AI returned an error (${response.status}).${hint} ${detail.slice(0, 200)}`.trim(), 502);
      }
      const body = await response.json();
      const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      return { vectors, tokens: body.usage?.total_tokens ?? 0 };
    },
  };
}

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function toPgVector(vector) {
  return `[${vector.join(",")}]`;
}
