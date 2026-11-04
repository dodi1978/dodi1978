// Builds the app once per server (or per warm Netlify function) from environment variables.

import { createApp } from "./app.js";
import { createClaude } from "./ai.js";
import { createEmbedder } from "./embeddings.js";
import { connectPostgres, databaseUrl, migrate } from "./db.js";

let appPromise;

export async function buildApp(env = process.env, { db } = {}) {
  let database = db;
  if (!database) {
    const url = databaseUrl(env);
    if (url) database = await migrate(connectPostgres(url));
  }
  return createApp({
    db: database,
    claude: createClaude({ apiKey: env.ANTHROPIC_API_KEY }),
    embedder: createEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.VOYAGE_MODEL || "voyage-4" }),
    passphrase: env.WORKBENCH_PASSPHRASE || "",
    secureCookies: env.INSECURE_COOKIES !== "1",
  });
}

export function getApp() {
  appPromise ??= buildApp().catch((err) => {
    appPromise = undefined;
    throw err;
  });
  return appPromise;
}
