// Database access. Works with any Postgres (Netlify Database, Neon, Render, local)
// through `pg`, and with PGlite (in-process Postgres) for tests and local tinkering.
// Every query goes through `db.query(sql, params)`, which returns the rows.

import pg from "pg";

export const EMBEDDING_DIMENSIONS = 1024;

export function databaseUrl(env = process.env) {
  // Netlify Database sets NETLIFY_DB_URL; the older Netlify DB extension set NETLIFY_DATABASE_URL.
  return env.DATABASE_URL || env.NETLIFY_DB_URL || env.NETLIFY_DATABASE_URL || "";
}

export function fromPool(pool) {
  return {
    kind: "postgres",
    vector: false,
    async query(text, params = []) {
      const result = await pool.query(text, params);
      return result.rows;
    },
    async close() {
      await pool.end();
    },
  };
}

export function connectPostgres(url) {
  const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  return fromPool(pool);
}

export function fromPglite(pglite) {
  return {
    kind: "pglite",
    vector: false,
    async query(text, params = []) {
      const result = await pglite.query(text, params);
      return result.rows;
    },
    async close() {
      await pglite.close();
    },
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     bot_draft JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     source_type TEXT NOT NULL,
     source_ref TEXT NOT NULL DEFAULT '',
     char_count INTEGER NOT NULL DEFAULT 0,
     chunk_count INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS chunks (
     id TEXT PRIMARY KEY,
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     idx INTEGER NOT NULL,
     text TEXT NOT NULL,
     embedded BOOLEAN NOT NULL DEFAULT false,
     embedding_json JSONB
   )`,
  `CREATE INDEX IF NOT EXISTS chunks_project_idx ON chunks(project_id)`,
  `CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id)`,
  `CREATE TABLE IF NOT EXISTS bot_versions (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     version_no INTEGER NOT NULL,
     label TEXT NOT NULL DEFAULT '',
     settings JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (project_id, version_no)
   )`,
  `CREATE TABLE IF NOT EXISTS conversations (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     bot_version_id TEXT REFERENCES bot_versions(id) ON DELETE SET NULL,
     source TEXT NOT NULL,
     title TEXT NOT NULL DEFAULT '',
     persona_id TEXT,
     meta JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS conversations_project_idx ON conversations(project_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
     id TEXT PRIMARY KEY,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     idx INTEGER NOT NULL,
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     meta JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id)`,
  `CREATE TABLE IF NOT EXISTS usage_log (
     id TEXT PRIMARY KEY,
     project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
     provider TEXT NOT NULL,
     model TEXT NOT NULL,
     kind TEXT NOT NULL,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS usage_project_idx ON usage_log(project_id)`,
  // Stage 2: personas, and runs that group generated conversations.
  `CREATE TABLE IF NOT EXISTS personas (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     data JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS personas_project_idx ON personas(project_id)`,
  `CREATE TABLE IF NOT EXISTS runs (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     label TEXT NOT NULL DEFAULT '',
     settings JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS run_id TEXT REFERENCES runs(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS conversations_run_idx ON conversations(run_id)`,
  // Rapport framework per project (NULL means the default GAAFFE taxonomy).
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS framework JSONB`,
  // Public chat link for real users (NULL until set up).
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS share JSONB`,
  `CREATE INDEX IF NOT EXISTS projects_share_token_idx ON projects ((share->>'token'))`,
  // Stage 3: code sets (codebooks), their codes, and annotations by you or the AI.
  `CREATE TABLE IF NOT EXISTS code_sets (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     applies_to TEXT NOT NULL,
     position INTEGER NOT NULL DEFAULT 0,
     data JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS code_sets_project_idx ON code_sets(project_id)`,
  `CREATE TABLE IF NOT EXISTS codes (
     id TEXT PRIMARY KEY,
     set_id TEXT NOT NULL REFERENCES code_sets(id) ON DELETE CASCADE,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     position INTEGER NOT NULL DEFAULT 0,
     version INTEGER NOT NULL DEFAULT 1,
     data JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS codes_set_idx ON codes(set_id)`,
  `CREATE TABLE IF NOT EXISTS annotations (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     set_id TEXT NOT NULL REFERENCES code_sets(id) ON DELETE CASCADE,
     code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
     unit_type TEXT NOT NULL,
     unit_id TEXT NOT NULL,
     conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
     coder TEXT NOT NULL,
     value JSONB NOT NULL,
     explanation TEXT NOT NULL DEFAULT '',
     is_example BOOLEAN NOT NULL DEFAULT false,
     code_version INTEGER NOT NULL DEFAULT 1,
     model TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS annotations_set_unit_idx ON annotations(set_id, unit_id)`,
  `CREATE INDEX IF NOT EXISTS annotations_conversation_idx ON annotations(conversation_id)`,
  // Your own code sets saved to the library, for use in any project. A copy: it stays
  // when the project it came from is deleted.
  `CREATE TABLE IF NOT EXISTS library_sets (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     applies_to TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT '',
     codes JSONB NOT NULL DEFAULT '[]'::jsonb,
     from_set_id TEXT,
     from_project_name TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS library_sets_from_set_idx ON library_sets(from_set_id)`,
];

// Creates the tables if they are missing. Safe to run on every cold start.
// Turns on pgvector when the database offers it; otherwise embeddings are stored
// as JSON and compared in JavaScript (fine for a few thousand passages).
export async function migrate(db) {
  for (const statement of SCHEMA) await db.query(statement);
  try {
    await db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await db.query(`ALTER TABLE chunks ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIMENSIONS})`);
    db.vector = true;
  } catch {
    db.vector = false;
  }
  return db;
}
