# Conversation Design Workbench

A web app for conversation designers and researchers: build a RAG chatbot over your own documents, create user interactions with it, and test standard and self-written evals on them, qualitatively and quantitatively.

**Status: Stage 1 of 6** – projects, chatbot builder (documents, meaning-based search, versioned bot settings) and test chat. The full feature list and build order are in the shared feature-list document.

- To put it online: see [DEPLOY.md](DEPLOY.md) (Netlify, step by step).
- Hosting: Netlify (static pages + one serverless function) with Postgres. The same code runs as a plain Node server (`npm start`), for example on Render.

## What Stage 1 does

- **Projects**: create, rename, duplicate (documents and bot versions, not conversations) and delete. Everything is saved in the database.
- **Documents**: upload PDF, Word (.docx), text, Markdown or HTML; add a web page; or paste text. Documents are split into passages of about 1,500 characters and indexed with Voyage AI for meaning-based search, in batches with a progress bar. Keyword search (Postgres full text) works as well, and takes over if Voyage AI is not set up or fails.
- **Try the search**: see which passages a question retrieves, with scores, before the bot answers.
- **Chatbot**: system instructions, model (Claude Opus 5.5, Sonnet 5.5 or Haiku 5.5), effort, passages per question, maximum answer length and a no-answer message. The grounding rules the app adds are shown on screen. Settings are saved as numbered **versions**, and every conversation records which version answered.
- **Test chat**: type as the user and the bot answers live. Each reply shows the passages it was given, search mode, response time, cost, and flags for "no answer", declined requests and model fallbacks. Conversations are saved as `hand-written` interactions for analysis in later stages.
- **Costs**: estimated API cost per project, by service.
- **Passphrase**: one shared passphrase protects the workbench (no user accounts).

## Configuration (environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `WORKBENCH_PASSPHRASE` | yes | The passphrase for opening the workbench |
| `ANTHROPIC_API_KEY` | yes | Claude, for the chatbot |
| `VOYAGE_API_KEY` | recommended | Meaning-based search (keyword search without it) |
| `DATABASE_URL` / `NETLIFY_DB_URL` / `NETLIFY_DATABASE_URL` | yes, online | Postgres connection string (the first one set is used) |
| `VOYAGE_MODEL` | no | Embedding model, default `voyage-4` |
| `INSECURE_COOKIES` | no | Set to `1` only for local testing over plain http |

## Running it on your own computer

```bash
npm install
```

```bash
WORKBENCH_PASSPHRASE=test INSECURE_COOKIES=1 ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then open http://localhost:3000. Without `DATABASE_URL`, data is stored in a local `.data` folder.

## Tests

```bash
npm test
```

The tests use an in-memory Postgres (PGlite) and stand-ins for Claude and Voyage AI, so they cost nothing. Set `TEST_DATABASE_URL` to also run them against a real Postgres (with pgvector, if installed).

## Code layout

| Path | What it is |
|---|---|
| `src/app.js` | The whole API as one function (web-standard Request → Response) |
| `src/rag.js` | Retrieval and building what Claude is sent |
| `src/documents.js` | Text extraction and splitting into passages |
| `src/ai.js`, `src/embeddings.js` | Claude and Voyage AI clients |
| `src/db.js` | Database connection and tables |
| `netlify/functions/api.mjs` | Netlify wrapper around `src/app.js` |
| `server.js` | Plain Node wrapper (local, Render) |
| `public/` | The pages (plain HTML, CSS and JavaScript; no build step) |
