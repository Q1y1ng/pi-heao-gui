/**
 * Every script we inject into a page is built inside a TypeScript template
 * literal. That hides a whole class of bug from the type checker: a `\n` written
 * inside the template becomes a REAL newline, so a string literal in the emitted
 * JavaScript is left unterminated. The renderer then refuses to parse the whole
 * script — every control on that page silently stops responding, and the main
 * process logs nothing at all.
 *
 * This shipped once: `SKILL_TEMPLATE.join('\n')` in the settings window made
 * every settings control inert. This test parses every script we hand to a
 * renderer, so the next one fails here instead of in the user's hands.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const DIST = path.join(__dirname, "..", "dist", "main");
const REPO_ROOT = path.join(__dirname, "..");

/** Precise line/column for a parse failure: vm gives none, `node --check` does. */
function firstBadLine(code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-parse-"));
  const file = path.join(dir, "script.js");
  fs.writeFileSync(file, code, "utf8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return "(node --check reported no error)";
  } catch (e) {
    const text = `${e.stderr || ""}${e.stdout || ""}`;
    const m = /script\.js:(\d+)\n([\s\S]{0,200})/.exec(text);
    if (!m) return text.split("\n").slice(0, 3).join(" | ");
    const lineNo = Number(m[1]);
    const source = code.split("\n")[lineNo - 1] || "";
    return `line ${lineNo}: ${source.trim().slice(0, 90)}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertParses(code, label) {
  assert.ok(code && code.trim().length > 0, `${label}: script is empty`);
  try {
    new vm.Script(code, { filename: label });
  } catch (e) {
    assert.fail(`${label}: injected script does not parse — ${e.message} (${firstBadLine(code)})`);
  }
}

/**
 * Inline classic-script bodies of an HTML fragment. Module scripts and
 * external/data scripts belong to the vendored upstream bundle, not to us, and
 * `import.meta` cannot be parsed as a classic script.
 */
function scriptsIn(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m = re.exec(html);
  while (m !== null) {
    const attrs = m[1] || "";
    const skip =
      /type\s*=\s*["']?module/i.test(attrs) ||
      /type\s*=\s*["']?application\/json/i.test(attrs) ||
      /\ssrc\s*=/i.test(attrs);
    if (!skip) out.push(m[2]);
    m = re.exec(html);
  }
  return out;
}

/**
 * Our injectables come in two shapes:
 *   - markup with no script at all (the HTML shells);
 *   - an HTML fragment carrying a <script> block, sometimes followed by <style>
 *     (they are spliced in as lines just before </body>).
 * In both cases the thing to parse is the script body — never the whole string.
 */
function checkInjectable(code, label) {
  assert.ok(code && code.trim().length > 0, `${label}: empty`);
  if (!/<script[\s>]/i.test(code)) return; // pure markup: nothing to parse
  const bodies = scriptsIn(code);
  assert.ok(bodies.length >= 1, `${label}: has a <script tag but no complete script body`);
  bodies.forEach((body, i) => {
    assertParses(body, `${label}#${i + 1}`);
    assert.ok(
      !/<\/script/i.test(body),
      `${label}#${i + 1}: contains a literal </script, which closes the block early`,
    );
  });
}

test("settings window: both languages emit a script that parses", () => {
  const { buildSettingsHtml } = require(path.join(DIST, "settings-window.js"));
  for (const lang of ["zh-cn", "en"]) {
    const html = buildSettingsHtml(lang);
    assert.ok(html.includes("<title>"), `${lang}: not an HTML document`);
    const bodies = scriptsIn(html);
    assert.ok(bodies.length >= 1, `${lang}: no script found`);
    bodies.forEach((b, i) => {
      assertParses(b, `settings[${lang}]#${i + 1}`);
    });
  }
});

test("settings window script wires up the controls it advertises", () => {
  const { buildSettingsHtml } = require(path.join(DIST, "settings-window.js"));
  const html = buildSettingsHtml("zh-cn");
  const code = scriptsIn(html).join("\n");
  // The failure mode is "nothing is clickable", so assert the wiring exists.
  assert.match(code, /querySelectorAll\('\.tab'\)/, "tab click handlers are missing");
  assert.match(code, /window\.pi/, "the preload bridge is never used");
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tabs.length >= 5, `expected several tabs, found ${tabs.length}`);
  for (const id of tabs) {
    assert.ok(html.includes(`id="panel-${id}"`), `tab ${id} has no panel-${id} element`);
  }
});

test("chat window injected surfaces all parse", () => {
  const { SIDEBAR_HTML, SIDEBAR_SCRIPT } = require(path.join(DIST, "sidebar.js"));
  const { DOCK_HTML, DOCK_SCRIPT } = require(path.join(DIST, "dock.js"));
  const { STATS_HTML, STATS_SCRIPT } = require(path.join(DIST, "stats-panel.js"));
  const { PALETTE_HTML, PALETTE_SCRIPT } = require(path.join(DIST, "palette.js"));

  for (const [label, code] of [
    ["SIDEBAR_HTML", SIDEBAR_HTML],
    ["DOCK_HTML", DOCK_HTML],
    ["STATS_HTML", STATS_HTML],
    ["PALETTE_HTML", PALETTE_HTML],
    ["SIDEBAR_SCRIPT", SIDEBAR_SCRIPT],
    ["DOCK_SCRIPT", DOCK_SCRIPT],
    ["STATS_SCRIPT", STATS_SCRIPT],
    ["PALETTE_SCRIPT", PALETTE_SCRIPT],
  ]) {
    checkInjectable(code, label);
  }
});

test("no injected script carries a raw carriage return", () => {
  // A raw CR means an escape sequence was swallowed somewhere upstream of us.
  // Only our own constants are checked: vendored upstream code may legitimately
  // contain CRLF inside its own string literals.
  const { SIDEBAR_SCRIPT } = require(path.join(DIST, "sidebar.js"));
  const { DOCK_SCRIPT } = require(path.join(DIST, "dock.js"));
  const { STATS_SCRIPT } = require(path.join(DIST, "stats-panel.js"));
  const { PALETTE_SCRIPT } = require(path.join(DIST, "palette.js"));
  const { buildSettingsHtml } = require(path.join(DIST, "settings-window.js"));

  const targets = [
    ["SIDEBAR_SCRIPT", SIDEBAR_SCRIPT],
    ["DOCK_SCRIPT", DOCK_SCRIPT],
    ["STATS_SCRIPT", STATS_SCRIPT],
    ["PALETTE_SCRIPT", PALETTE_SCRIPT],
    ["settings", scriptsIn(buildSettingsHtml("zh-cn")).join("\n")],
  ];
  for (const [label, code] of targets) {
    const bodies = scriptsIn(code);
    const sources =
      bodies.length > 0 ? bodies.map((b, i) => [`${label}#${i + 1}`, b]) : [[label, code]];
    for (const [name, body] of sources) {
      // A lone CR (one that does not start a CRLF pair) is the smell.
      assert.ok(
        !/(^|[^\r])\r(?!\n)/.test(body),
        `${name}: contains a raw carriage return (an escape sequence was swallowed)`,
      );
    }
  }
});

test("generated pages have no duplicate element ids", () => {
  // A duplicate id makes getElementById return the wrong node. That is not
  // theoretical: <style id="pi-palette"> collided with the palette wrapper, so
  // the palette's script held the <style> element and Ctrl+K never opened it.
  const { buildSettingsHtml } = require(path.join(DIST, "settings-window.js"));
  const { buildChatHtml } = require(path.join(DIST, "chat-adapter.js"));

  const pages = [
    ["settings[zh-cn]", buildSettingsHtml("zh-cn")],
    ["settings[en]", buildSettingsHtml("en")],
  ];
  try {
    const chat = buildChatHtml(REPO_ROOT, { theme: "dark", uiLanguage: "zh-cn" });
    if (chat) pages.push(["chat", chat]);
  } catch {
    /* no vendored bundle */
  }

  for (const [label, html] of pages) {
    // Skip script bodies: the vendored bundle builds ids inside JS templates.
    const markupOnly = html.replace(/<script([^>]*)>[\s\S]*?<\/script>/gi, "");
    const ids = [...markupOnly.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const dups = [...counts.entries()].filter(([, c]) => c > 1).map(([id, c]) => `${id} x${c}`);
    assert.deepEqual(dups, [], `${label}: duplicate ids — ${dups.join(", ")}`);
  }
});

test("chat adapter HTML parses (skipped when the vendored bundle is absent)", () => {
  const { buildChatHtml } = require(path.join(DIST, "chat-adapter.js"));
  let html = null;
  try {
    html = buildChatHtml(REPO_ROOT, { theme: "dark", uiLanguage: "zh-cn" });
  } catch {
    html = null;
  }
  if (!html) {
    console.log("  (vendored UI bundle not present — skipped)");
    return;
  }
  const bodies = scriptsIn(html);
  assert.ok(bodies.length >= 1, "chat html has no classic inline script");
  bodies.forEach((b, i) => {
    assertParses(b, `chat#${i + 1}`);
  });
});
