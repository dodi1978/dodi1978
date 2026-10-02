// Builds the shareable link version into dist/demo/index.html: the citizen
// screen and the staff view (#staff) in one page, with Claude and the case
// store provided by the claude.ai page (see api-shim.js). The file holds
// the page body only; the host adds the document skeleton.
// Run: npm run build:demo
import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "demo");
await mkdir(out, { recursive: true });
await rm(path.join(out, "staff.html"), { force: true });

const result = await build({
  stdin: {
    contents: `import "./demo/api-shim.js";\nimport "./public/app.js";\nimport "./public/staff.js";`,
    resolveDir: root,
    loader: "js",
  },
  bundle: true,
  format: "iife",
  minify: true,
  write: false,
  target: "es2022",
});
// Keep a literal "</script>" inside the bundle from closing the inline tag.
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = await readFile(path.join(root, "public", "styles.css"), "utf8");

const STAFF_ROOT = `<div class="width-container main" id="staff-root" hidden>
    <p class="notice">Demo staff view. Cases sent from this link can be seen by everyone who can open it. Do not enter real personal information.</p>
    <div id="app"></div>
  </div>

  <footer`;

const html = await readFile(path.join(root, "public", "index.html"), "utf8");
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  // Function replacements, so "$&" inside the code is not read as a pattern.
  .replace(/<script type="module" src="[^"]+"><\/script>/, () => `<script>${js}</script>`)
  .replace('<a href="staff.html">Staff view</a>', () => '<a href="#staff">Staff view</a>')
  .replace("<footer", () => STAFF_ROOT);

await writeFile(path.join(out, "index.html"), `<title>TACSI</title>\n<style>\n${css}</style>\n${body}`);
console.log(`Built ${path.relative(root, out)}/index.html`);
