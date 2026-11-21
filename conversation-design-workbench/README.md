# Conversation Design Workbench

A web app for conversation designers and researchers: build a RAG chatbot over your own documents, create user interactions with it, and test standard and self-written evals on them, qualitatively and quantitatively.

**Status: Stage 3 of 6** – projects, chatbot builder and test chat (stage 1); personas and creating interactions (stage 2); the codebook, coding by hand and by AI, and agreement (stage 3). The full feature list and build order are in the shared feature-list document.

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
- **Personas from user research**: import a spreadsheet (one row per persona; columns matched by name, levels as words or numbers on any scale, optional evidence quotes, with a downloadable template).
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
| Chat | **Real user chat** (the link for participants, its settings, and recent chats with real users) and **Test chat** (chat with the bot yourself) |
| Personas | **Generate manually** (the persona form, with the rapport framework, editable from there), **Add starter set**, **Generate from brief**, **Import a spreadsheet**, **Created personas** (the project's personas) |
| Create interactions | All the tools for creating interactions: simulate conversations, test questions, write a conversation, import transcripts; and the runs |
| Interactions | Every interaction, simulated or real, labelled by type (real users set apart from those created in the workbench), with counts per type, filters and a page per conversation |
| Coding | **Codebook** (code sets and their codes; library), **Code by hand**, **AI coding**, **Agreement** |

## Coding (Stage 3)

- **Code sets** apply to one kind of unit: user messages, bot replies, bot replies with the user message they answer (pairs), or whole conversations. Each code has a definition and a result type (yes/no, one category, several categories, scale, number, comment), optional categories with definitions, optional instructions for the AI, and an optional condition (it applies only when another code has certain values). Changing what a code means makes a new version; agreement compares only coding done with the same version.
- **Library** (copied into a project, then editable): CCSARP requests (Blum-Kulka, House & Kasper 1989: request type – no request, request for information, request for action; head act strategy, the nine strategies under the three levels of directness; perspective; alerters; internal modification, with syntactic downgraders, lexical/phrasal downgraders and upgraders as superior categories; supportive moves, mitigating and aggravating; some categories adapted for written chat); Brown & Levinson (1987) politeness, one code per superstrategy (positive politeness, negative politeness and off record with their 15, 10 and 15 strategies; bald on record; no FTA); industry evals in one set at two levels: reply quality per bot reply (groundedness, answer relevance, retrieval relevance, completeness, instruction following, text quality, multi-turn quality, safety) and outcomes per whole conversation (resolution, overall quality, adversarial attempt and outcome); and rapport, built from the project's framework (per dimension, one “effect on rapport” code: builds rapport and breaks rapport, each with the framework's behaviours under it, or neutral). Changes to the library only affect sets added afterwards.
- **Codes on more than one unit**: a code can be “Coded on” another unit than its set (e.g. whole conversations in a set of reply codes). Code by hand, AI coding, Applied codes and Agreement then show a switch for each unit, and each unit is coded, compared and counted on its own. A code can only depend on a code on the same unit.
- **Superior and subordinate categories**: any category can sit under a superior category (up to three levels). Coders choose the most specific category, or the superior one if none of its subordinate categories fits; conditions on a superior category are met by its subordinate ones; and agreement is also reported at the level of superior categories (e.g. directness level as well as head act strategy).
- **Building hierarchies yourself**: in the code editor each category is a row in an outline. → puts a category under the one above it, ← moves it back up a level, ↑ ↓ reorder, and “+ sub” adds a subordinate category. Each project keeps its own hierarchies; library sets are only a starting point.
- **Notes**: each code has “Your notes on this code” (a memo for you; not shown to the AI and not a new version of the code). While coding by hand, “+ Note” adds a note to the code you just chose for that message; your notes appear next to the AI's reasons under Agreement.
- **Applied codes**: a chart per code of how many units each category was applied to, by you and by the AI, with the hierarchy shown (superior categories in bold with totals that include their subordinate categories). Tick “Only show categories that were used” to hide categories nobody has applied yet; a superior category stays visible when any of its subordinate categories was used. Each conversation's page also lists the codes applied to each message, and to the whole conversation, with the hierarchy path, who applied them (you, AI, or “you & AI” when you agree) and any notes or AI reasons.
- **Choosing which codes to use**: in Code by hand and AI coding you can work on some of a set's codes only (the choice carries over between the two); codes that a chosen code depends on are included automatically, and your (or the AI's) other codes on the same units are kept.
- **Code by hand**: each unit is shown in its conversation; conditional codes appear only when they apply. Any coded unit can be marked as an example for the AI. The AI's codes can be shown alongside (hidden by default).
- **AI coding**: one request per unit (within the time limit), three at a time, with a cost estimate first, progress and stop. The AI sees the code definitions, up to 8 of your most recent examples, the unit and the conversation before it, and for bot replies the passages and system instructions the bot had. It does not see the interaction type, title, persona, scenario or ratings. It gives a short reason per code.
- **Agreement**: per code, the number of units coded by both, percentage agreement and Cohen's kappa (quadratic weighted kappa for scales; category by category for multi-choice codes), with Landis & Koch labels. Disagreements are listed with the AI's reason, and you can look again, accept the AI's code, or keep yours and make it an example.

## Real users (public chat link)

Under Chat → Real user chat, every project has a link (switched off until you switch it on) (`/c/<code>`) that participants open without the passphrase. They see an information text and, optionally, a consent statement to agree to; then they chat with the chosen bot version, and can end the chat or press "Talk to a person" (recorded as an escalation). At the end they can give a 1–5 satisfaction rating with a comment. Conversations are saved as source `real`, with consent time, how the chat ended and the rating; chats closed without ending are shown as "not ended". Participants never see passages or settings. Limits per link: chats per 24 hours and messages per chat. The link can be switched off or replaced (the old one then stops working).

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

The tests use an in-memory Postgres (PGlite) and stand-ins for Claude and Voyage AI, so they cost nothing. To also run them against a real Postgres (with pgvector, if installed), set `TEST_DATABASE_URL` and run the files one at a time, since they share that database:

```bash
TEST_DATABASE_URL=postgres://… node --test --test-concurrency=1 test/*.test.js
```

## Code layout

| Path | What it is |
|---|---|
| `src/app.js` | The whole API as one function (web-standard Request → Response) |
| `src/rag.js` | Retrieval and building what Claude is sent |
| `src/documents.js` | Text extraction and splitting into passages |
| `src/personas.js`, `src/simulate.js` | Personas, the simulated user, question and persona generation |
| `src/framework.js` | The rapport framework (GAAFFE default) and persona rapport profiles |
| `src/codebooks.js`, `src/coding.js`, `src/agreement.js` | The code library, coding (units, by hand, by AI) and agreement statistics |
| `src/importer.js` | Reading CSV, Excel and pasted transcripts, and persona spreadsheets |
| `src/ai.js`, `src/embeddings.js` | Claude and Voyage AI clients |
| `src/db.js` | Database connection and tables |
| `netlify/functions/api.mjs` | Netlify wrapper around `src/app.js` |
| `server.js` | Plain Node wrapper (local, Render) |
| `public/` | The pages (plain HTML, CSS and JavaScript; no build step): `app.js` (stage 1 pages), `interactions.js` (personas and interactions), `coding.js` (coding), `ui.js` (shared parts), `markdown.js` |
