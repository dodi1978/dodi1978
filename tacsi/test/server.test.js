import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Force the offline engine so tests never call the API.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
process.env.TACSI_STAFF_PIN = "9999";
const { server } = await import("../server.js");

let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("health reports demo mode without a key", async () => {
  const res = await (await fetch(`${base}/api/health`)).json();
  assert.equal(res.mode, "demo");
});

test("serves the citizen and staff pages", async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/staff`)).status, 200);
  assert.equal((await fetch(`${base}/../server.js`)).status, 404);
});

test("turn, report and case sharing work end to end", async () => {
  const history = [{ role: "user", text: "I owe money on my energy bills" }];
  const turn = await (await post("/api/turn", { history, session: { language: "en", languageName: "English" } })).json();
  assert.equal(turn.engine, "demo");
  history.push({ role: "assistant", text: turn.result.reply });

  const { report } = await (await post("/api/report", { history, demoState: turn.demoState })).json();
  assert.ok(report.staff.headline);

  assert.equal((await post("/api/cases", { report, history })).status, 400, "consent is required");
  const created = await post("/api/cases", { consent: true, report, history, session: { languageName: "English" } });
  assert.equal(created.status, 201);
  const { reference } = await created.json();
  assert.match(reference, /^TAC-\d{4}$/);

  assert.equal((await fetch(`${base}/api/cases`)).status, 401, "staff PIN is required");
  const list = await (await fetch(`${base}/api/cases`, { headers: { "x-staff-pin": "9999" } })).json();
  assert.equal(list.cases[0].reference, reference);
});

test("rejects malformed history", async () => {
  assert.equal((await post("/api/turn", { history: [{ role: "system", text: "x" }] })).status, 400);
});
