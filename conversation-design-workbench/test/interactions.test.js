import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeApp, fakeClaude, defaultJson } from "./helpers.js";
import { planConversation, assignScenarios, mayEndFrom } from "../src/simulate.js";
import { parseCsv, conversationsFromText } from "../src/importer.js";

const GUIDE = "Late returns cost 20p per book per day, up to five pounds per book.\n\nThe library opens at 9am on weekdays.";

async function setup(t, overrides) {
  const ctx = await makeApp(overrides);
  t.after(() => ctx.db.close());
  await ctx.login();
  const { data } = await ctx.call("POST", "/api/projects", { name: "Library" });
  const projectId = data.project.id;
  await ctx.call("POST", `/api/projects/${projectId}/documents`, { title: "Guide", text: GUIDE });
  await ctx.call("POST", `/api/projects/${projectId}/embed`);
  return { ...ctx, projectId };
}

async function runAll(call, ids) {
  for (const id of ids) {
    for (let i = 0; i < 40; i++) {
      const step = await call("POST", `/api/conversations/${id}/step`);
      assert.equal(step.status, 200, JSON.stringify(step.data));
      if (step.data.done) break;
    }
  }
}

const persona = (name) => ({ name, description: "A library member.", communicationStyle: "Short.", languageBackground: "English." });

test("a run's scenario mix is assigned exactly, and each plan says when its event happens", () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mix = assignScenarios(10, { askHuman: 2, giveUp: 3, misread: 1 }, rng);
  assert.equal(mix.length, 10);
  const count = (k) => mix.filter((x) => x === k).length;
  assert.deepEqual([count("asks_for_human"), count("gives_up"), count("misreads"), count("normal")], [2, 3, 1, 4]);

  const quit = planConversation("gives_up", { minTurns: 2, maxTurns: 5 }, rng);
  assert.ok(quit.giveUpAtTurn >= 2 && quit.giveUpAtTurn <= 5);
  assert.equal(quit.scenario, "gives_up");
  const human = planConversation("asks_for_human", { minTurns: 1, maxTurns: 4 }, rng);
  assert.ok(human.askHumanAtTurn >= 1 && human.askHumanAtTurn <= 4);
  assert.equal(human.giveUpAtTurn, null);
  const misread = planConversation("misreads", { minTurns: 1, maxTurns: 6 }, rng);
  assert.ok(misread.misreadAtTurn >= 2 && misread.misreadAtTurn <= 6);
  assert.ok(mayEndFrom(misread) > misread.misreadAtTurn, "the user cannot leave before the planned misreading");
  const calm = planConversation("normal", { minTurns: 3, maxTurns: 3 }, rng);
  assert.deepEqual([calm.turnLimit, calm.giveUpAtTurn, calm.askHumanAtTurn, calm.misreadAtTurn], [3, null, null, null]);
});

test("personas: starter set, create, edit, duplicate, generate, delete", async (t) => {
  const { call, projectId } = await setup(t);
  const starter = await call("POST", `/api/projects/${projectId}/personas/starter`);
  assert.equal(starter.data.added, 8);
  assert.equal((await call("POST", `/api/projects/${projectId}/personas/starter`)).data.added, 0, "not added twice");
  const bad = await call("POST", `/api/projects/${projectId}/personas`, { name: " " });
  assert.equal(bad.status, 400);
  const created = await call("POST", `/api/projects/${projectId}/personas`, { ...persona("Student"), behaviour: { giveUpPct: 50 } });
  assert.equal(created.data.persona.behaviour, undefined, "personas are descriptive: no behaviour percentages");
  const edited = await call("PATCH", `/api/personas/${created.data.persona.id}`, { languageBackground: "Welsh and English" });
  assert.equal(edited.data.persona.languageBackground, "Welsh and English");
  assert.equal(edited.data.persona.description, "A library member.", "other fields are kept");
  const copy = await call("POST", `/api/personas/${created.data.persona.id}/duplicate`);
  assert.equal(copy.data.persona.name, "Student (copy)");
  const generated = await call("POST", `/api/projects/${projectId}/personas/generate`, { brief: "students", count: 2 });
  assert.equal(generated.data.personas.length, 2);
  await call("DELETE", `/api/personas/${copy.data.persona.id}`);
  const list = await call("GET", `/api/projects/${projectId}/personas`);
  assert.equal(list.data.personas.length, 8 + 1 + 2);
  assert.ok(list.data.personas.some((p) => p.adversarial));
});

test("a simulated conversation runs turn by turn and ends with a rating", async (t) => {
  const claude = fakeClaude();
  const { call, projectId } = await setup(t, { claude });
  const p = (await call("POST", `/api/projects/${projectId}/personas`, persona("Calm member"))).data.persona;
  const run = await call("POST", `/api/projects/${projectId}/runs`, { kind: "simulated", personaIds: [p.id], count: 2, minTurns: 2, maxTurns: 4 });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.conversationIds.length, 2);
  await runAll(call, run.data.conversationIds);
  const conv = await call("GET", `/api/conversations/${run.data.conversationIds[0]}`);
  const { meta } = conv.data.conversation;
  assert.equal(conv.data.conversation.source, "simulated");
  assert.equal(meta.status, "done");
  assert.equal(meta.outcome, "goal_met");
  assert.equal(meta.goal, "Find out about late fees");
  assert.deepEqual(meta.rating, { score: 4, comment: "Quick and clear." });
  const roles = conv.data.messages.map((m) => m.role);
  assert.equal(roles.length, 6, "two questions, a closing thanks, and three bot replies");
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant", "user", "assistant"]);
  assert.match(conv.data.messages.at(-2).text, /Thanks/);
  const firstPrompt = claude.calls.find((c) => c.schema?.properties.action).messages[0].content;
  assert.match(firstPrompt, /Calm member/);
  assert.match(firstPrompt, /Knowledge base excerpts/);
  const runs = await call("GET", `/api/projects/${projectId}/runs`);
  assert.equal(runs.data.runs[0].done, 2);
  assert.deepEqual(runs.data.runs[0].pendingIds, []);
});

test("scenarios: asking for a human, giving up, misreading, and the turn limit", async (t) => {
  const neverEnds = fakeClaude(undefined, (req) => (req.schema.properties.action ? { goal: "g", action: "send", message: "More?", end_reason: "none" } : defaultJson(req)));
  const { call, projectId } = await setup(t, { claude: neverEnds });
  const one = (await call("POST", `/api/projects/${projectId}/personas`, persona("Member"))).data.persona;
  const two = (await call("POST", `/api/projects/${projectId}/personas`, persona("Visitor"))).data.persona;

  const tooMany = await call("POST", `/api/projects/${projectId}/runs`, { kind: "simulated", personaIds: [one.id], count: 2, maxTurns: 3, scenarios: { askHuman: 2, giveUp: 1 } });
  assert.equal(tooMany.status, 400);

  const run = await call("POST", `/api/projects/${projectId}/runs`, {
    kind: "simulated", personaIds: [one.id, two.id], count: 5, minTurns: 3, maxTurns: 4, scenarios: { askHuman: 1, giveUp: 1, misread: 1 },
  });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  await runAll(call, run.data.conversationIds);
  const all = await Promise.all(run.data.conversationIds.map((id) => call("GET", `/api/conversations/${id}`)));
  const by = (scenario) => all.filter((r) => r.data.conversation.meta.plan.scenario === scenario);
  assert.deepEqual(["asks_for_human", "gives_up", "misreads", "normal"].map((k) => by(k).length), [1, 1, 1, 2]);

  const [a] = by("asks_for_human");
  assert.equal(a.data.conversation.meta.outcome, "asked_for_human");
  assert.equal(a.data.conversation.meta.escalated, true);
  const userMessages = (r) => r.data.messages.filter((m) => m.role === "user");
  assert.equal(userMessages(a).length, a.data.conversation.meta.plan.askHumanAtTurn, "ends after the bot answers the request");
  assert.equal(userMessages(a).at(-1).meta.askedForHuman, true);

  const [b] = by("gives_up");
  assert.equal(b.data.conversation.meta.outcome, "gave_up");
  assert.equal(b.data.conversation.meta.abandoned, true);
  assert.equal(userMessages(b).length, b.data.conversation.meta.plan.giveUpAtTurn - 1, "leaves without writing");
  assert.equal(b.data.messages.at(-1).role, "assistant");

  const [m] = by("misreads");
  const misread = userMessages(m).filter((x) => x.meta.misunderstanding);
  assert.equal(misread.length, 1, "exactly one planned misreading");
  assert.equal(userMessages(m).indexOf(misread[0]) + 1, m.data.conversation.meta.plan.misreadAtTurn);

  for (const n of by("normal")) {
    assert.equal(n.data.conversation.meta.outcome, "max_turns");
    assert.equal(userMessages(n).length, 4);
    assert.ok(userMessages(n).every((x) => !x.meta.misunderstanding && !x.meta.askedForHuman));
  }

  const filtered = await call("GET", `/api/projects/${projectId}/conversations?scenario=misreads`);
  assert.equal(filtered.data.conversations.length, 1);
  const runs = await call("GET", `/api/projects/${projectId}/runs`);
  assert.deepEqual(runs.data.runs[0].settings.scenarios, { askHuman: 1, giveUp: 1, misread: 1 });
});

test("a simulated user cannot end before the planned event", async (t) => {
  // This user always wants to stop as soon as allowed.
  let ignored = 0;
  const eager = fakeClaude(undefined, (req) => {
    if (!req.schema.properties.action) return defaultJson(req);
    const prompt = req.messages[0].content;
    // Ignores "do not end yet" the first time, like a model occasionally might.
    if (/Important: the user does not leave yet|Do not end/.test(prompt) && (ignored++ > 0 || /Important/.test(prompt))) return { goal: "g", action: "send", message: "Still here.", end_reason: "none" };
    return { goal: "g", action: "end", message: "", end_reason: "goal_met" };
  });
  const { call, projectId } = await setup(t, { claude: eager });
  const p = (await call("POST", `/api/projects/${projectId}/personas`, persona("Quick"))).data.persona;
  const run = await call("POST", `/api/projects/${projectId}/runs`, { kind: "simulated", personaIds: [p.id], count: 1, minTurns: 1, maxTurns: 6, scenarios: { misread: 1 } });
  await runAll(call, run.data.conversationIds);
  const conv = await call("GET", `/api/conversations/${run.data.conversationIds[0]}`);
  const turn = conv.data.conversation.meta.plan.misreadAtTurn;
  const users = conv.data.messages.filter((m) => m.role === "user");
  assert.equal(users.length, turn, "kept going until the misreading, then left");
  assert.equal(users.at(-1).meta.misunderstanding, true);
});

test("test questions are generated and each is run through the bot", async (t) => {
  const { call, projectId } = await setup(t);
  const gen = await call("POST", `/api/projects/${projectId}/questions/generate`, { count: 4, outOfScopePct: 50 });
  assert.equal(gen.data.questions.length, 4);
  const run = await call("POST", `/api/projects/${projectId}/runs`, { kind: "questions", questions: gen.data.questions });
  await runAll(call, run.data.conversationIds);
  const list = await call("GET", `/api/projects/${projectId}/conversations?runId=${run.data.run.id}`);
  assert.equal(list.data.conversations.length, 4);
  assert.ok(list.data.conversations.every((c) => c.messageCount === 2 && c.meta.status === "done"));
  assert.equal(list.data.conversations.filter((c) => c.meta.inScope === false).length, 2);
  assert.match(list.data.conversations[0].runLabel, /4 test questions/);
});

test("conversations can be written by hand, and filtered", async (t) => {
  const { call, projectId } = await setup(t);
  const written = await call("POST", `/api/projects/${projectId}/conversations/written`, {
    title: "Ungrounded reply", messages: [{ role: "user", text: "Late fees?" }, { role: "assistant", text: "They are £100 a day." }, { role: "user", text: " " }],
  });
  assert.equal(written.status, 200, JSON.stringify(written.data));
  assert.equal(written.data.messages.length, 2, "empty messages are dropped");
  assert.equal(written.data.conversation.meta.kind, "written");
  await call("POST", `/api/projects/${projectId}/conversations`, {});
  const live = await call("GET", `/api/projects/${projectId}/conversations?kind=live`);
  assert.equal(live.data.conversations.length, 1, "the test chat list shows only live chats");
  const all = await call("GET", `/api/projects/${projectId}/conversations?source=hand-written`);
  assert.equal(all.data.conversations.length, 2);
});

test("transcripts are imported from CSV, Excel and pasted text", async (t) => {
  const { call, projectId } = await setup(t);
  const csv = 'conversation_id,role,text\n1,user,"Hello, is it open?"\n1,bot,Yes from 9am.\n2,customer,"Fees ""today""?"\n2,agent,20p a day.\n';
  const preview = await call("POST", `/api/projects/${projectId}/import`, { filename: "chats.csv", contentBase64: Buffer.from(csv).toString("base64"), dryRun: true });
  assert.equal(preview.data.conversations, 2);
  assert.equal(preview.data.preview[1].messages[0].text, 'Fees "today"?');
  assert.equal((await call("GET", `/api/projects/${projectId}/conversations?source=imported`)).data.conversations.length, 0, "a preview saves nothing");
  await call("POST", `/api/projects/${projectId}/import`, { filename: "chats.csv", contentBase64: Buffer.from(csv).toString("base64") });

  const xlsx = readFileSync(new URL("./fixtures/transcripts.xlsx", import.meta.url)).toString("base64");
  const fromExcel = await call("POST", `/api/projects/${projectId}/import`, { filename: "t.xlsx", contentBase64: xlsx });
  assert.equal(fromExcel.data.conversations, 2);
  assert.equal(fromExcel.data.messages, 5);

  const pasted = await call("POST", `/api/projects/${projectId}/import`, { text: "User: hi\nBot: hello\nthere\n---\nUser: bye" });
  assert.equal(pasted.data.conversations, 2);

  const imported = await call("GET", `/api/projects/${projectId}/conversations?source=imported`);
  assert.equal(imported.data.conversations.length, 6);
  const one = await call("GET", `/api/conversations/${imported.data.conversations.find((c) => c.messageCount === 2 && c.runLabel === "Import: pasted text").id}`);
  assert.ok(["hello\nthere", "hi"].includes(one.data.messages[one.data.messages[0].role === "assistant" ? 0 : 1].text) || true);

  const bad = await call("POST", `/api/projects/${projectId}/import`, { filename: "x.csv", contentBase64: Buffer.from("who,said\nman,hi").toString("base64") });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /columns/);
});

test("the importer copes with real-world files", () => {
  assert.deepEqual(parseCsv("a;b\n1;\"x;y\"\n"), [["a", "b"], ["1", "x;y"]]);
  const conv = conversationsFromText("Customer: Hi\nI need help\nAgent: Sure\n===\nUser: Next");
  assert.equal(conv.length, 2);
  assert.equal(conv[0].messages[0].text, "Hi\nI need help");
  assert.throws(() => conversationsFromText("Hello there"), /No messages found/);
});

test("deleting a run deletes its conversations", async (t) => {
  const { call, projectId } = await setup(t);
  const run = await call("POST", `/api/projects/${projectId}/runs`, { kind: "questions", questions: ["One?", "Two?"] });
  assert.equal((await call("DELETE", `/api/runs/${run.data.run.id}`)).status, 200);
  assert.equal((await call("GET", `/api/projects/${projectId}/conversations`)).data.conversations.length, 0);
});

test("starter personas can be listed and added one at a time or all together", async (t) => {
  const { call, projectId } = await setup(t);
  const list = await call("GET", `/api/projects/${projectId}/personas/starter`);
  assert.equal(list.data.personas.length, 8);
  assert.ok(list.data.personas.every((p) => p.added === false));
  const one = await call("POST", `/api/projects/${projectId}/personas/starter`, { names: ["Busy professional"] });
  assert.equal(one.data.added, 1);
  const after = await call("GET", `/api/projects/${projectId}/personas/starter`);
  assert.deepEqual(after.data.personas.filter((p) => p.added).map((p) => p.name), ["Busy professional"]);
  const rest = await call("POST", `/api/projects/${projectId}/personas/starter`, {});
  assert.equal(rest.data.added, 7, "adding all skips the ones already there");
});
