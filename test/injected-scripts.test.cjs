/**
 * The injected UI scripts are JavaScript *source inside template literals*, so a
 * stray backtick, an unescaped `\n`/`\r` or an interpolated `${` breaks the built
 * page at runtime — and the failure looks like "the panel never appeared".
 * This test parses every block the app injects and fails on any syntax error.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/** Pull every `<script>…</script>` body out of a string. */
function scriptBodies(source) {
  const bodies = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m = re.exec(source);
  while (m !== null) {
    bodies.push(m[1]);
    m = re.exec(source);
  }
  return bodies;
}

/** Throws a SyntaxError when the code cannot be parsed. */
function assertParses(code, label) {
  assert.ok(code.trim().length > 0, `${label}: empty script block`);
  try {
    // Compiling (not running) catches exactly the class of bug we care about.
    new vm.Script(code, { filename: label });
  } catch (e) {
    assert.fail(`${label} does not parse: ${e.message}`);
  }
}

const EXPORTS = [
  ["dock", "../dist/main/dock.js", ["DOCK_SCRIPT"]],
  ["sidebar", "../dist/main/sidebar.js", ["SIDEBAR_SCRIPT"]],
  ["palette", "../dist/main/palette.js", ["PALETTE_SCRIPT"]],
  ["stats-panel", "../dist/main/stats-panel.js", ["STATS_SCRIPT"]],
];

for (const [name, mod, keys] of EXPORTS) {
  test(`${name}: injected script parses`, () => {
    const loaded = require(mod);
    for (const key of keys) {
      const value = loaded[key];
      assert.equal(typeof value, "string", `${name}.${key} must be a string`);
      const bodies = scriptBodies(value);
      assert.ok(bodies.length >= 1, `${name}.${key} has no <script> block`);
      for (const [i, body] of bodies.entries()) {
        assertParses(body, `${name}.${key}[${i}]`);
      }
    }
  });
}

test("dock: the login command keeps an escaped carriage return", () => {
  const { DOCK_SCRIPT } = require("../dist/main/dock.js");
  // A raw CR here means the template literal swallowed the escape sequence and
  // the emitted script has an unterminated string literal.
  assert.ok(DOCK_SCRIPT.includes("/login ' + provider + '\\r'"), "expected '\\r' in the source");
  assert.equal(/\r/.test(DOCK_SCRIPT), false, "no raw carriage return may reach the page");
});

test("generated chat page: every inline script parses", () => {
  const bundle = path.join(ROOT, "vendor", "upstream", "pi-chat", "dist", "index.html");
  if (!fs.existsSync(bundle)) {
    // The UI bundle is gitignored; a fresh clone has to build it first.
    return;
  }
  const { buildChatHtml } = require("../dist/main/chat-adapter.js");
  const { DEFAULT_CONFIG } = require("../dist/shared/types.js");
  const html = buildChatHtml(ROOT, { ...DEFAULT_CONFIG, workspaceRoot: ROOT });
  assert.ok(html && html.length > 1000, "chat html should be generated");

  const bodies = scriptBodies(html);
  assert.ok(bodies.length >= 5, `expected several injected scripts, got ${bodies.length}`);
  // The upstream bundle is a single module script and enormous; parsing it is
  // slow but it also proves our injections did not break the document structure.
  for (const [i, body] of bodies.entries()) {
    if (body.length > 2_000_000) continue; // the vendored module, verified by its own build
    assertParses(body, `chat-html script[${i}]`);
  }
});

test("generated chat page: CSS is wrapped in <style>, never bare text", () => {
  const bundle = path.join(ROOT, "vendor", "upstream", "pi-chat", "dist", "index.html");
  if (!fs.existsSync(bundle)) return;
  const { buildChatHtml } = require("../dist/main/chat-adapter.js");
  const { DEFAULT_CONFIG } = require("../dist/shared/types.js");
  const html = buildChatHtml(ROOT, { ...DEFAULT_CONFIG, workspaceRoot: ROOT });

  // Every injected stylesheet must carry its own <style> element. A bare text
  // node in <head> is invalid: the parser closes </head> early and the CSS ends
  // up rendered as body text (this shipped once and looked like a wall of CSS).
  for (const id of ["pi-stats", "pi-palette", "pi-dock-css"]) {
    assert.ok(html.includes(`<style id="${id}">`), `missing <style id="${id}">`);
  }

  const head = html.slice(html.indexOf("<head"), html.indexOf("</head>"));
  assert.ok(head.length > 0, "head not found");
  const withoutStyles = head
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  assert.equal(/[.#][\w-]+\s*\{/.test(withoutStyles), false, "bare CSS rule leaked into <head>");
});

test("generated chat page: no template literal leaked into the markup", () => {
  const bundle = path.join(ROOT, "vendor", "upstream", "pi-chat", "dist", "index.html");
  if (!fs.existsSync(bundle)) return;
  const { buildChatHtml } = require("../dist/main/chat-adapter.js");
  const { DEFAULT_CONFIG } = require("../dist/shared/types.js");
  const html = buildChatHtml(ROOT, { ...DEFAULT_CONFIG, workspaceRoot: ROOT });
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.equal(/\$\{[a-zA-Z_]/.test(markup), false, "uninterpolated template expression in markup");
  assert.equal(/<head[^>]*>\s*<meta http-equiv="Content-Security-Policy"/.test(html), true);
});
