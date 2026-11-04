import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, fakeEmbedder, fakeClaude, PASSPHRASE } from "./helpers.js";

const GUIDE = `Opening hours

The library is open from 9am to 5pm on weekdays. On Saturdays it opens from 10am to 2pm. It is closed on Sundays and bank holidays.

Borrowing books

Members can borrow up to ten books at a time. Loans last three weeks and can be renewed online twice.

Late fees

Late returns cost 20p per book per day, up to a maximum of five pounds per book.`;

async function projectWithDoc(t, overrides) {
  const ctx = await makeApp(overrides);
  t.after(() => ctx.db.close());
  await ctx.login();
  const { data } = await ctx.call("POST", "/api/projects", { name: "Library bot" });
  const projectId = data.project.id;
  const doc = await ctx.call("POST", `/api/projects/${projectId}/documents`, { title: "Library guide", text: GUIDE });
  assert.equal(doc.status, 200, JSON.stringify(doc.data));
  return { ...ctx, projectId, documentId: doc.data.document.id };
}

test("the passphrase protects the API", async (t) => {
  const { call, login, db } = await makeApp();
  t.after(() => db.close());
  assert.equal((await call("GET", "/api/projects")).status, 401);
  const wrong = await call("POST", "/api/login", { passphrase: "nope" }, { auth: false });
  assert.equal(wrong.status, 401);
  const right = await login();
  assert.equal(right.status, 200);
  assert.match(right.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await call("GET", "/api/projects")).status, 200);
  assert.notEqual(PASSPHRASE, right.headers.get("set-cookie"));
});

test("projects can be created, renamed, listed, duplicated and deleted", async (t) => {
  const { call, login, db } = await makeApp();
  t.after(() => db.close());
  await login();
  assert.equal((await call("POST", "/api/projects", { name: " " })).status, 400);
  const created = await call("POST", "/api/projects", { name: "Study A", description: "Politeness" });
  const id = created.data.project.id;
  const renamed = await call("PATCH", `/api/projects/${id}`, { name: "Study A (pilot)" });
  assert.equal(renamed.data.project.name, "Study A (pilot)");
  const overview = await call("GET", `/api/projects/${id}`);
  assert.equal(overview.data.counts.versions, 1, "a starting bot version is created");
  await call("POST", `/api/projects/${id}/documents`, { title: "Notes", text: "Some notes about the study." });
  const copy = await call("POST", `/api/projects/${id}/duplicate`);
  assert.equal(copy.data.project.name, "Study A (pilot) (copy)");
  const copyOverview = await call("GET", `/api/projects/${copy.data.project.id}`);
  assert.equal(copyOverview.data.counts.documents, 1);
  assert.equal(copyOverview.data.counts.passages, 1);
  const list = await call("GET", "/api/projects");
  assert.equal(list.data.projects.length, 2);
  assert.equal((await call("DELETE", `/api/projects/${id}`)).status, 200);
  assert.equal((await call("GET", `/api/projects/${id}`)).status, 404);
  assert.equal((await call("GET", "/api/projects")).data.projects.length, 1);
});

test("documents are split into passages and embedded in batches", async (t) => {
  const { call, projectId, documentId, embedder } = await projectWithDoc(t);
  const docs = await call("GET", `/api/projects/${projectId}/documents`);
  assert.equal(docs.data.documents.length, 1);
  assert.ok(docs.data.documents[0].chunkCount >= 1);
  const first = await call("POST", `/api/projects/${projectId}/embed`);
  assert.equal(first.data.remaining, 0);
  assert.equal(embedder.calls[0].inputType, "document");
  const again = await call("POST", `/api/projects/${projectId}/embed`);
  assert.equal(again.data.embeddedNow, 0);
  const detail = await call("GET", `/api/documents/${documentId}`);
  assert.ok(detail.data.passages.every((p) => p.embedded));
  const overview = await call("GET", `/api/projects/${projectId}`);
  assert.ok(overview.data.usage.rows.some((r) => r.provider === "voyage"));
});

test("meaning-based search finds the right passage", async (t) => {
  const { call, projectId } = await projectWithDoc(t);
  await call("POST", `/api/projects/${projectId}/embed`);
  const result = await call("POST", `/api/projects/${projectId}/search`, { query: "How much are late fees per book?" });
  assert.equal(result.data.mode, "meaning");
  assert.match(result.data.passages[0].text, /Late returns cost/);
});

test("keyword search is used when Voyage AI is not set up", async (t) => {
  const { call, projectId } = await projectWithDoc(t, { embedder: fakeEmbedder({ available: false }) });
  const embed = await call("POST", `/api/projects/${projectId}/embed`);
  assert.equal(embed.status, 503);
  const result = await call("POST", `/api/projects/${projectId}/search`, { query: "opening hours saturday" });
  assert.equal(result.data.mode, "keyword");
  assert.match(result.data.passages[0].text, /Saturdays/);
});

test("keyword search takes over if Voyage AI fails during a chat", async (t) => {
  const embedder = fakeEmbedder();
  const ctx = await projectWithDoc(t, { embedder });
  await ctx.call("POST", `/api/projects/${ctx.projectId}/embed`);
  embedder.embed = async () => {
    throw new Error("rate limited");
  };
  const result = await ctx.call("POST", `/api/projects/${ctx.projectId}/search`, { query: "late fees" });
  assert.equal(result.data.mode, "keyword");
  assert.match(result.data.warning, /rate limited/);
});

test("bot drafts and versions are saved, and chats use the chosen version", async (t) => {
  const claude = fakeClaude();
  const { call, projectId } = await projectWithDoc(t, { claude });
  await call("POST", `/api/projects/${projectId}/embed`);
  const bad = await call("PUT", `/api/projects/${projectId}/bot`, { draft: { model: "gpt-5" } });
  assert.equal(bad.status, 400);
  const draft = await call("PUT", `/api/projects/${projectId}/bot`, { draft: { systemPrompt: "You are the library assistant.", topK: 2, model: "claude-sonnet-5-5" } });
  assert.equal(draft.data.draft.topK, 2);
  const v2 = await call("POST", `/api/projects/${projectId}/bot/versions`, { label: "Library tone" });
  assert.equal(v2.data.version.versionNo, 2);
  const bot = await call("GET", `/api/projects/${projectId}/bot`);
  assert.equal(bot.data.versions.length, 2);

  const conv = await call("POST", `/api/projects/${projectId}/conversations`, { botVersionId: v2.data.version.id });
  const convId = conv.data.conversation.id;
  assert.equal(conv.data.conversation.source, "hand-written");
  const sent = await call("POST", `/api/conversations/${convId}/messages`, { text: "What are the late fees?" });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const [user, botReply] = sent.data.messages;
  assert.equal(user.role, "user");
  assert.equal(botReply.role, "assistant");
  assert.equal(botReply.meta.searchMode, "meaning");
  assert.ok(botReply.meta.passages.length >= 1 && botReply.meta.passages.length <= 2, "topK caps the passages");
  assert.match(botReply.meta.passages[0].text, /Late returns/);
  assert.ok(botReply.meta.costUsd > 0);

  const request = claude.calls[0];
  assert.equal(request.model, "claude-sonnet-5-5");
  assert.match(request.system, /You are the library assistant\./);
  assert.match(request.system, /passages/);
  assert.match(request.messages.at(-1).content, /<passages>[\s\S]*Late returns[\s\S]*<\/passages>\n\nWhat are the late fees\?$/);

  await call("POST", `/api/conversations/${convId}/messages`, { text: "And on Sundays?" });
  const second = claude.calls[1];
  assert.equal(second.messages.length, 3, "history is sent without the old passages");
  assert.equal(second.messages[0].content, "What are the late fees?");

  const full = await call("GET", `/api/conversations/${convId}`);
  assert.equal(full.data.messages.length, 4);
  assert.equal(full.data.conversation.versionNo, 2);
  const list = await call("GET", `/api/projects/${projectId}/conversations`);
  assert.equal(list.data.conversations[0].messageCount, 4);
});

test("a reply that is the no-answer message is flagged", async (t) => {
  const claude = fakeClaude((req) => /Sorry, I don't have information/.exec(req.system) ? "Sorry, I don't have information about that. Could you ask in a different way, or ask about something else?" : "?");
  const { call, projectId } = await projectWithDoc(t, { claude });
  const conv = await call("POST", `/api/projects/${projectId}/conversations`, {});
  const sent = await call("POST", `/api/conversations/${conv.data.conversation.id}/messages`, { text: "Who won the football?" });
  assert.equal(sent.data.messages[1].meta.noAnswer, true);
});

test("errors are reported clearly", async (t) => {
  const { call, projectId } = await projectWithDoc(t);
  assert.equal((await call("GET", "/api/projects/nope")).status, 404);
  const empty = await call("POST", `/api/projects/${projectId}/documents`, {});
  assert.equal(empty.status, 400);
  const badType = await call("POST", `/api/projects/${projectId}/documents`, { filename: "x.exe", contentBase64: Buffer.from("hi").toString("base64") });
  assert.equal(badType.status, 400);
  assert.match(badType.data.error, /not supported/);
  const conv = await call("POST", `/api/projects/${projectId}/conversations`, {});
  const blank = await call("POST", `/api/conversations/${conv.data.conversation.id}/messages`, { text: "   " });
  assert.equal(blank.status, 400);
});

test("documents can be added from a web page", async (t) => {
  const fetchImpl = async () => new Response("<html><head><title>Help page</title></head><body><nav>menu</nav><p>Parking is free after 6pm.</p></body></html>", { headers: { "content-type": "text/html" } });
  const ctx = await makeApp({ fetchImpl });
  t.after(() => ctx.db.close());
  await ctx.login();
  const { data } = await ctx.call("POST", "/api/projects", { name: "Web" });
  const doc = await ctx.call("POST", `/api/projects/${data.project.id}/documents`, { url: "https://example.org/help" });
  assert.equal(doc.data.document.title, "Help page");
  const detail = await ctx.call("GET", `/api/documents/${doc.data.document.id}`);
  assert.match(detail.data.passages[0].text, /Parking is free/);
  assert.doesNotMatch(detail.data.passages[0].text, /menu/);
});
