import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { server } from "../server.js";

let base;
before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

// Reads server-sent events into an array until stopped.
function listen(path) {
  const events = [];
  const ctrl = new AbortController();
  const ready = fetch(base + path, { signal: ctrl.signal }).then(async (res) => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = chunk.match(/^event: (.+)$/m)?.[1];
            const data = chunk.match(/^data: (.+)$/m)?.[1];
            if (ev) events.push({ event: ev, data: JSON.parse(data) });
          }
        }
      } catch {}
    })();
    return res.status;
  });
  const waitFor = async (pred, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("timed out waiting for event; got " + JSON.stringify(events.map((e) => e.event)));
  };
  return { events, ready, waitFor, stop: () => ctrl.abort() };
}

async function newRoom() {
  const { status, data } = await call("/api/rooms", { method: "POST", body: { title: "Week 5", teacherName: "Dr D" } });
  assert.equal(status, 201);
  assert.match(data.code, /^[A-Z2-9]{5}$/);
  return data;
}

test("teacher starts a session, student joins and chats, everyone sees it live", async () => {
  const room = await newRoom();
  const T = { "x-teacher-key": room.teacherKey };
  const join = await call(`/api/rooms/${room.code}/join`, { method: "POST", body: { name: "  Sam  " } });
  assert.equal(join.data.name, "Sam");
  const S = { "x-token": join.data.token };

  const teacherFeed = listen(`/api/rooms/${room.code}/stream?key=${room.teacherKey}`);
  assert.equal(await teacherFeed.ready, 200);
  const snap = await teacherFeed.waitFor((e) => e.event === "snapshot");
  assert.equal(snap.data.me.role, "teacher");
  assert.equal(snap.data.state.title, "Week 5");

  const sent = await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "Hello!" }, headers: S });
  assert.equal(sent.status, 201);
  const got = await teacherFeed.waitFor((e) => e.event === "message");
  assert.equal(got.data.text, "Hello!");
  assert.equal(got.data.name, "Sam");

  // Teacher replies, likes and pins.
  const reply = await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "Hi Sam", replyTo: sent.data.id }, headers: T });
  assert.equal(reply.data.replyTo, sent.data.id);
  assert.equal(reply.data.role, "teacher");
  const liked = await call(`/api/rooms/${room.code}/messages/${sent.data.id}/like`, { method: "POST", headers: T });
  assert.equal(liked.data.likes, 1);
  assert.equal(liked.data.likedByMe, true);
  const pinned = await call(`/api/rooms/${room.code}/messages/${sent.data.id}/pin`, { method: "POST", headers: T });
  assert.equal(pinned.data.pinned, true);

  // Students cannot pin or change settings.
  assert.equal((await call(`/api/rooms/${room.code}/messages/${sent.data.id}/pin`, { method: "POST", headers: S })).status, 403);
  assert.equal((await call(`/api/rooms/${room.code}/settings`, { method: "POST", body: { paused: true }, headers: S })).status, 403);
  // Nobody gets in without a pass.
  assert.equal((await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "x" } })).status, 401);
  assert.equal((await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "x" }, headers: { "x-teacher-key": "nope" } })).status, 401);

  // Students can delete only their own messages.
  assert.equal((await call(`/api/rooms/${room.code}/messages/${reply.data.id}/delete`, { method: "POST", headers: S })).status, 403);
  assert.equal((await call(`/api/rooms/${room.code}/messages/${sent.data.id}/delete`, { method: "POST", headers: S })).status, 200);
  await teacherFeed.waitFor((e) => e.event === "delete" && e.data.id === sent.data.id);

  // Ending the session tells everyone and removes it.
  assert.equal((await call(`/api/rooms/${room.code}/end`, { method: "POST", headers: T })).status, 200);
  await teacherFeed.waitFor((e) => e.event === "ended");
  assert.equal((await call(`/api/rooms/${room.code}`)).status, 404);
  teacherFeed.stop();
});

test("pausing stops students posting but not the teacher", async () => {
  const room = await newRoom();
  const T = { "x-teacher-key": room.teacherKey };
  const S = { "x-token": (await call(`/api/rooms/${room.code}/join`, { method: "POST", body: { name: "Ali" } })).data.token };
  await call(`/api/rooms/${room.code}/settings`, { method: "POST", body: { paused: true }, headers: T });
  assert.equal((await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "hi" }, headers: S })).status, 423);
  assert.equal((await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "Quiet please" }, headers: T })).status, 201);
});

test("anonymous mode hides classmates' names from students, not from the teacher", async () => {
  const room = await newRoom();
  const T = { "x-teacher-key": room.teacherKey };
  const a = (await call(`/api/rooms/${room.code}/join`, { method: "POST", body: { name: "Ana" } })).data;
  const b = (await call(`/api/rooms/${room.code}/join`, { method: "POST", body: { name: "Ben" } })).data;
  await call(`/api/rooms/${room.code}/settings`, { method: "POST", body: { anonymous: true }, headers: T });

  const benFeed = listen(`/api/rooms/${room.code}/stream?token=${b.token}`);
  const teacherFeed = listen(`/api/rooms/${room.code}/stream?key=${room.teacherKey}`);
  await benFeed.ready;
  await teacherFeed.ready;
  await benFeed.waitFor((e) => e.event === "snapshot");
  await teacherFeed.waitFor((e) => e.event === "snapshot");

  await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "A shy question" }, headers: { "x-token": a.token } });
  const seenByBen = await benFeed.waitFor((e) => e.event === "message");
  const seenByTeacher = await teacherFeed.waitFor((e) => e.event === "message");
  assert.equal(seenByBen.data.name, "Classmate");
  assert.equal(seenByBen.data.authorId, "anon");
  assert.equal(seenByTeacher.data.name, "Ana");
  benFeed.stop();
  teacherFeed.stop();
});

test("rejects empty messages, cleans names and slows down floods", async () => {
  const room = await newRoom();
  assert.equal((await call(`/api/rooms/${room.code}/join`, { method: "POST", body: { name: "   " } })).status, 400);
  const S = { "x-token": (await call(`/api/rooms/${room.code}/join`, { method: "POST", body: { name: "Kim" } })).data.token };
  assert.equal((await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "  " }, headers: S })).status, 400);
  const long = await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "x".repeat(900) }, headers: S });
  assert.equal(long.data.text.length, 500);
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(`/api/rooms/${room.code}/messages`, { method: "POST", body: { text: "spam " + i }, headers: S })).status);
  assert.ok(statuses.includes(429));
});

test("unknown codes and static pages", async () => {
  assert.equal((await call("/api/rooms/ZZZZZ")).status, 404);
  for (const p of ["/", "/teacher", "/j/ABCDE", "/chat.js", "/styles.css"]) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
  }
  assert.equal((await fetch(base + "/../server.js")).status, 404);
});
