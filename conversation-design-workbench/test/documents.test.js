import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, extractFromFile, htmlToText } from "../src/documents.js";

test("short text stays in one passage", () => {
  assert.deepEqual(chunkText("Hello there.\n\nSecond paragraph."), ["Hello there.\n\nSecond paragraph."]);
});

test("long text is split into passages of a sensible size that overlap", () => {
  const paragraph = "This sentence is about conversation design and evaluation methods. ".repeat(12).trim();
  const text = Array.from({ length: 8 }, (_, i) => `Section ${i}. ${paragraph}`).join("\n\n");
  const chunks = chunkText(text);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 2000), "no passage is far over the target size");
  const joined = chunks.join(" ");
  for (let i = 0; i < 8; i++) assert.ok(joined.includes(`Section ${i}.`));
});

test("one huge paragraph without full stops is still split", () => {
  const chunks = chunkText("word ".repeat(2000));
  assert.ok(chunks.length >= 5);
});

test("empty text gives no passages", () => {
  assert.deepEqual(chunkText("  \n\n "), []);
});

test("HTML is reduced to readable text", () => {
  const text = htmlToText("<script>x()</script><h1>Title</h1><p>One &amp; two</p><ul><li>A</li></ul>");
  assert.doesNotMatch(text, /x\(\)/);
  assert.match(text, /One & two/);
  assert.match(text, /- A/);
});

test("text files are read and named after the file", async () => {
  const result = await extractFromFile("notes.txt", Buffer.from("Some notes"));
  assert.deepEqual(result, { title: "notes", text: "Some notes", sourceType: "txt" });
});

test("old .doc files get a helpful message", async () => {
  await assert.rejects(() => extractFromFile("old.doc", Buffer.from("x")), /Save it as .docx/);
});
