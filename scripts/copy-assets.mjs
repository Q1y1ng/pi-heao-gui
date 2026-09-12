import { cpSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Copy renderer placeholder
const rendererSrc = join(root, "src", "renderer");
const rendererDest = join(root, "dist", "renderer");
if (existsSync(rendererSrc)) {
  mkdirSync(rendererDest, { recursive: true });
  cpSync(rendererSrc, rendererDest, { recursive: true });
  console.log("Copied renderer placeholder");
}

/**
 * Vendored UI libraries for the bottom dock. They are UMD builds so they can be
 * inlined into the generated chat document as plain <script>/<style> — no
 * bundler and no network, which keeps the strict CSP (no remote origins) intact.
 */
const vendorDest = join(rendererDest, "vendor");
const assets = [
  ["node_modules/@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["node_modules/@xterm/xterm/css/xterm.css", "xterm.css"],
  ["node_modules/@xterm/addon-fit/lib/addon-fit.js", "addon-fit.js"],
  ["node_modules/codemirror/lib/codemirror.js", "codemirror.js"],
  ["node_modules/codemirror/lib/codemirror.css", "codemirror.css"],
  // CodeMirror modes used by the file panel's mode map
  ["node_modules/codemirror/mode/javascript/javascript.js", "mode-javascript.js"],
  ["node_modules/codemirror/mode/xml/xml.js", "mode-xml.js"],
  ["node_modules/codemirror/mode/css/css.js", "mode-css.js"],
  ["node_modules/codemirror/mode/markdown/markdown.js", "mode-markdown.js"],
  ["node_modules/codemirror/mode/python/python.js", "mode-python.js"],
  ["node_modules/codemirror/mode/shell/shell.js", "mode-shell.js"],
  ["node_modules/codemirror/mode/yaml/yaml.js", "mode-yaml.js"],
  ["node_modules/codemirror/mode/rust/rust.js", "mode-rust.js"],
  ["node_modules/codemirror/mode/go/go.js", "mode-go.js"],
];

mkdirSync(vendorDest, { recursive: true });
let copied = 0;
const missing = [];
for (const [from, to] of assets) {
  const src = join(root, from);
  if (!existsSync(src)) {
    missing.push(from);
    continue;
  }
  copyFileSync(src, join(vendorDest, to));
  copied++;
}
console.log(`Vendored UI libs: ${copied}/${assets.length} copied to dist/renderer/vendor`);
if (missing.length) console.warn(`  missing (dock degrades gracefully): ${missing.join(", ")}`);

console.log("Assets copied");
