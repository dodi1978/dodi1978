import { randomUUID } from "node:crypto";

export async function logUsage(db, { projectId = null, provider, model, kind, inputTokens = 0, outputTokens = 0, costUsd = 0 }) {
  await db.query(
    `INSERT INTO usage_log (id, project_id, provider, model, kind, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), projectId, provider, model, kind, inputTokens, outputTokens, costUsd],
  );
}

export async function projectUsage(db, projectId) {
  const rows = await db.query(
    `SELECT provider, kind, count(*)::int AS calls, COALESCE(sum(input_tokens), 0)::int AS input_tokens,
            COALESCE(sum(output_tokens), 0)::int AS output_tokens, COALESCE(sum(cost_usd), 0)::float AS cost_usd
       FROM usage_log WHERE project_id = $1 GROUP BY provider, kind ORDER BY provider, kind`,
    [projectId],
  );
  const total = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  return { rows, totalUsd: Math.round(total * 10000) / 10000 };
}
