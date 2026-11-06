import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, fakeClaude } from "./helpers.js";

async function setup(t) {
  const claude = fakeClaude(() => "**Yes**, you can cancel up to 24 hours before.");
  const ctx = await makeApp({ claude });
  t.after(() => ctx.db.close());
  await ctx.login();
  const { data } = await ctx.call("POST", "/api/projects", { name: "Clinic bot" });
  const projectId = data.project.id;
  await ctx.call("POST", `/api/projects/${projectId}/documents`, { title: "Guide", text: "You can cancel up to 24 hours before." });
  return { ...ctx, claude, projectId };
}

// Calls the public chat as a participant would: no cookie.
const visitor = (call) => (method, path, body) => call(method, path, body, { auth: false });

test("a shared link lets real users chat, and their chats are collected", async (t) => {
  const { call, projectId, claude } = await setup(t);
  const pub = visitor(call);

  const off = await call("GET", `/api/projects/${projectId}/share`);
  assert.equal(off.data.share, null, "not set up until saved");

  const saved = await call("PUT", `/api/projects/${projectId}/share`, { share: { enabled: true, title: "Clinic helper", maxMessages: 2 } });
  const token = saved.data.share.token;
  assert.match(token, /^[A-Za-z0-9_-]{20,}$/);

  const config = await pub("GET", `/api/public/${token}`);
  assert.equal(config.status, 200);
  assert.equal(config.data.title, "Clinic helper");
  assert.equal(config.data.requireConsent, true);
  assert.equal(config.data.token, undefined);
  assert.equal(config.data.botVersionId, undefined, "no bot internals are shown");

  assert.equal((await pub("POST", `/api/public/${token}/start`, {})).status, 400, "consent is required");
  const started = await pub("POST", `/api/public/${token}/start`, { consent: true });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const { conversationId, key } = started.data;

  const wrongKey = await pub("POST", `/api/public/${token}/chat/${conversationId}/messages`, { key: "guess", text: "Hi" });
  assert.equal(wrongKey.status, 403, "only the participant can continue their chat");

  const reply = await pub("POST", `/api/public/${token}/chat/${conversationId}/messages`, { key, text: "Can I cancel?" });
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.equal(reply.data.reply, "**Yes**, you can cancel up to 24 hours before.");
  assert.equal(reply.data.passages, undefined, "participants never see the passages");
  assert.equal(reply.data.remaining, 1);
  assert.match(claude.calls.at(-1).messages.at(-1).content, /<passages>/, "the bot answers from the documents as usual");
  await pub("POST", `/api/public/${token}/chat/${conversationId}/messages`, { key, text: "Thanks" });
  const tooMany = await pub("POST", `/api/public/${token}/chat/${conversationId}/messages`, { key, text: "One more" });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.error, /maximum length/);

  await pub("POST", `/api/public/${token}/chat/${conversationId}/end`, { key, reason: "human" });
  await pub("POST", `/api/public/${token}/chat/${conversationId}/end`, { key, reason: "human", rating: 2, comment: "Wanted a person." });
  const afterEnd = await pub("POST", `/api/public/${token}/chat/${conversationId}/messages`, { key, text: "Hello?" });
  assert.equal(afterEnd.status, 400);

  const list = await call("GET", `/api/projects/${projectId}/conversations?source=real`);
  assert.equal(list.data.conversations.length, 1);
  const conv = list.data.conversations[0];
  assert.equal(conv.title, "Participant 1");
  assert.equal(conv.meta.kind, "real");
  assert.equal(conv.meta.outcome, "asked_for_human");
  assert.equal(conv.meta.escalated, true);
  assert.deepEqual(conv.meta.rating, { score: 2, comment: "Wanted a person." });
  assert.ok(conv.meta.consentAt);
  assert.equal(conv.meta.keyHash, undefined, "the participant's secret is not shown in the workbench");
  assert.equal(conv.messageCount, 4);

  await call("POST", `/api/projects/${projectId}/conversations`, {});
  const byType = async (kind) => (await call("GET", `/api/projects/${projectId}/conversations?kind=${kind}`)).data.conversations.length;
  assert.deepEqual([await byType("real"), await byType("live"), await byType("simulated")], [1, 1, 0], "interactions can be filtered by type");
  const live = await call("GET", `/api/projects/${projectId}/conversations?kind=live`);
  assert.equal(live.data.conversations.length, 1, "real-user chats are not mixed into Test chat");
  const overview = await call("GET", `/api/projects/${projectId}`);
  assert.ok(overview.data.usage.rows.some((r) => r.kind === "chat (real users)"));
});

test("the link can be switched off, replaced and limited per day", async (t) => {
  const { call, projectId } = await setup(t);
  const pub = visitor(call);
  const first = (await call("PUT", `/api/projects/${projectId}/share`, { share: { enabled: true, requireConsent: false, dailyLimit: 1 } })).data.share.token;
  assert.equal((await pub("POST", `/api/public/${first}/start`, {})).status, 200, "no consent screen when switched off");
  const limited = await pub("POST", `/api/public/${first}/start`, {});
  assert.equal(limited.status, 429);
  assert.match(limited.data.error, /limit for today/);

  const renewed = (await call("POST", `/api/projects/${projectId}/share/new-link`)).data.share.token;
  assert.notEqual(renewed, first);
  assert.equal((await pub("GET", `/api/public/${first}`)).status, 404, "the old link stops working");
  assert.equal((await pub("GET", `/api/public/${renewed}`)).status, 200);

  await call("PUT", `/api/projects/${projectId}/share`, { share: { enabled: false } });
  const closed = await pub("GET", `/api/public/${renewed}`);
  assert.equal(closed.status, 404);
  assert.match(closed.data.error, /not available/);
  assert.equal((await pub("GET", "/api/public/nonsense")).status, 404);
  assert.equal((await pub("GET", `/api/projects/${projectId}`)).status, 401, "the rest of the workbench still needs the passphrase");
});
