# Conversation Design Workbench

A web app for conversation designers and researchers: build a RAG chatbot over your own documents, create user interactions with it, and test standard and self-written evals on them, qualitatively and quantitatively.

**Status: Stage 2 of 6** – projects, chatbot builder and test chat (stage 1); personas and creating interactions (stage 2). The full feature list and build order are in the shared feature-list document.

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

## What Stage 2 adds

- **Personas**: write your own (who they are, an optional goal, how they write, language background), add a starter set of eight (two of them adversarial), or generate personas from a short brief with AI. Personas are descriptive, as in conversation design practice.
- **Rapport framework**: personas are described with a rapport framework, by default Dippold's Taxonomy of Human-Chatbot Rapport (Goals, Autonomy, Attention, Face, Fairness, Ethicality, with their build/break behaviours). The framework can be edited per project (rename, add or remove dimensions, or reset). For each dimension a persona has an importance (low, medium, high) and a note. Simulated users react to the bot in line with these needs, and at the end rate each dimension 1–5 with a comment, in character. Conversations store the framework they were run with.
- **Personas from user research**: import a spreadsheet (one row per persona; columns matched by name, levels as words or numbers on any scale, with a downloadable template), or let the AI find user types in research text (transcripts, notes, survey comments; text, Word or PDF) and draft a persona for each, with supporting quotes. Quotes that do not appear word for word in the material are removed automatically.
- **Simulated conversations**: an AI plays chosen personas in full multi-turn conversations with a chosen bot version, between a minimum and maximum number of user messages, and gives a satisfaction rating (1–5, with a comment) in character at the end. Each run has a **scenario mix**: how many conversations should include the user asking for a human, giving up partway, or misreading a reply (the rest are normal). Scenarios are assigned at random across personas, the moment each happens is chosen at random, and each conversation is recorded with its scenario, so they are known ground truth for checking evals. Runs go one turn per request (each well within Netlify's time limit) with a progress bar, and can be stopped and continued.
- **Test questions**: generate one-off questions from the documents (a set share of them deliberately not answerable from the documents, and marked as such), edit the list, and run each through the bot.
- **Written conversations**: write both sides by hand, for example a deliberately ungrounded reply.
- **Import**: CSV or Excel (one row per message: conversation, speaker, text) or pasted "User: / Bot:" transcripts, with a preview before importing.
- **Interactions**: every conversation in one list, filterable by source, persona, bot version and run, with a detail page showing the goal, outcome, rating, planned behaviour and the persona as it was used.

## Menu

| Tab | What is in it |
|---|---|
| Overview | Project details, counts, API cost, recent activity |
| Chatbot design | **RAG** (documents, indexing, try the search) and **System settings** (instructions, model, versions) |
| Test chat | Chat with the bot yourself, and **Share with real users** (the public chat link) |
| Personas | Personas, the rapport framework, and adding personas (brief, spreadsheet, research text) |
| Create interactions | All the tools for creating interactions: simulate conversations, test questions, write a conversation, import transcripts; and the runs |
| Interactions | Every interaction, simulated or real, labelled by type (real users set apart from those created in the workbench), with counts per type, filters and a page per conversation |

## Real users (public chat link)

Under Test chat → Share with real users, a project gets a link (`/c/<code>`) that participants open without the passphrase. They see an information text and, optionally, a consent statement to agree to; then they chat with the chosen bot version, and can end the chat or press "Talk to a person" (recorded as an escalation). At the end they can give a 1–5 satisfaction rating with a comment. Conversations are saved as source `real`, with consent time, how the chat ended and the rating; chats closed without ending are shown as "not ended". Participants never see passages or settings. Limits per link: chats per 24 hours and messages per chat. The link can be switched off or replaced (the old one then stops working).

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
| `src/personas.js`, `src/simulate.js` | Personas, the simulated user, question and persona generation, drafting personas from research |
| `src/framework.js` | The rapport framework (GAAFFE default) and persona rapport profiles |
| `src/importer.js` | Reading CSV, Excel and pasted transcripts, and persona spreadsheets |
| `src/ai.js`, `src/embeddings.js` | Claude and Voyage AI clients |
| `src/db.js` | Database connection and tables |
| `netlify/functions/api.mjs` | Netlify wrapper around `src/app.js` |
| `server.js` | Plain Node wrapper (local, Render) |
| `public/` | The pages (plain HTML, CSS and JavaScript; no build step): `app.js` (stage 1 pages), `interactions.js` (personas and interactions), `ui.js` (shared parts), `markdown.js` |
