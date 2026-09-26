// Builds the shareable static demo into dist/demo/:
//   index.html  citizen screen (page body only; the host adds the document skeleton)
//   staff.html  staff view (full document)
// Run: npm run build:demo
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "demo");
await mkdir(out, { recursive: true });

async function bundle(entry) {
  const result = await build({
    stdin: { contents: `import "./demo/api-shim.js";\nimport "./public/${entry}";`, resolveDir: root, loader: "js" },
    bundle: true,
    format: "iife",
    minify: true,
    write: false,
    target: "es2022",
  });
  // Keep a literal "</script>" inside the bundle from closing the inline tag.
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

const css = await readFile(path.join(root, "public", "styles.css"), "utf8");
const inline = (html, js) =>
  html
    // Function replacements, so "$&" inside the code is not read as a pattern.
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
    .replace(/<script type="module" src="[^"]+"><\/script>/, () => `<script>${js}</script>`);

// Citizen page: keep only <title> and the body content.
const index = inline(await readFile(path.join(root, "public", "index.html"), "utf8"), await bundle("app.js"));
const title = index.match(/<title>[\s\S]*?<\/title>/)[0].replace(/<title>.*<\/title>/, "<title>TACSI</title>");
const style = index.match(/<style>[\s\S]*?<\/style>/)[0];
const body = index.match(/<body>([\s\S]*)<\/body>/)[1];
await writeFile(path.join(out, "index.html"), `${title}\n${style}\n${body}`);

const staff = inline(await readFile(path.join(root, "public", "staff.html"), "utf8"), await bundle("staff.js"))
  .replace("Cases are held in memory only and are deleted when the server restarts.", () => "Demo: shared cases are kept only in this browser.");
await writeFile(path.join(out, "staff.html"), staff);

console.log(`Built ${path.relative(root, out)}/index.html and staff.html`);
