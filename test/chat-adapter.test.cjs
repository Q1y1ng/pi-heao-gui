/**
 * Tests for the generated chat document (dist/main/chat-adapter.js).
 *
 * The chat window renders untrusted agent/tool output, so the parts worth
 * pinning are the ones that keep that renderer boxed in: the CSP declaration,
 * the config-injection escaping and the build-time signature.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildChatHtml } = require("../dist/main/chat-adapter.js");
const { DEFAULT_CONFIG } = require("../dist/shared/types.js");

const ROOT = path.join(__dirname, "..");
const UI_BUNDLE = path.join(ROOT, "studio", "pi-chat", "dist", "index.html");
const hasUi = fs.existsSync(UI_BUNDLE);
const build = (overrides = {}) => buildChatHtml(ROOT, { ...DEFAULT_CONFIG, ...overrides });

test("buildChatHtml returns null when the UI bundle is missing", () => {
  const html = buildChatHtml(path.join(ROOT, "does-not-exist"), DEFAULT_CONFIG);
  assert.equal(html, null);
});

test("CSP is the first element inside <head>", { skip: !hasUi }, () => {
  const html = build();
  const lines = html.split("\n");
  const headIdx = lines.findIndex((l) => /^<head(\s|>|$)/i.test(l.trim()));
  assert.ok(headIdx >= 0, "<head> present");
  assert.match(lines[headIdx + 1], /^<meta http-equiv="Content-Security-Policy"/);
  assert.match(lines[headIdx + 1], /default-src 'none'/);
  assert.match(lines[headIdx + 1], /script-src 'self' 'unsafe-inline'/);
  assert.equal(/unsafe-eval/.test(lines[headIdx + 1]), false, "no unsafe-eval");
});

test("no config value is injected into the document", { skip: !hasUi }, () => {
  const html = build({
    args: ["--secret-arg"],
    env: { SECRET_TOKEN: "sk-should-not-appear" },
    workspaceRoot: "C:\\secret-root",
  });
  // the whole config used to be injected (including `env`) although nothing in
  // the UI read it — the renderer only needs __PI_HOME__
  assert.equal(html.includes("SECRET_TOKEN"), false);
  assert.equal(html.includes("sk-should-not-appear"), false);
  assert.equal(html.includes("--secret-arg"), false);
  assert.equal(html.includes("__PI_HEAO_CONFIG__"), false);
  assert.match(html, /window\.__PI_HOME__/);
});

test("hostile config strings cannot break out of the document", { skip: !hasUi }, () => {
  const payload = "</script><img src=x onerror=alert(1)>";
  const countScripts = (s) => (s.match(/<\/script>/g) || []).length;

  const hostile = build({
    args: [payload],
    workspaceRoot: `C:\\w${payload}`,
    env: { EVIL: payload },
  });

  assert.equal(countScripts(hostile), countScripts(build()), "no extra </script> was produced");
  // the payload may survive as text inside a JS string, but only in escaped form
  assert.equal(hostile.includes("</script><img"), false);
  assert.equal(hostile.includes("\\u003c/script>"), true, "`<` must be escaped as \\u003c");
});

test("no unreplaced placeholders are left behind", { skip: !hasUi }, () => {
  const html = build();
  assert.equal(/PI_[A-Z_]+_PLACEHOLDER/.test(html), false);
  assert.match(html, /window\.__PI_HOME__ = "/);
});

test("build signature and author watermark are present", { skip: !hasUi }, () => {
  const html = build();
  // Version-agnostic on purpose: the watermark must be present and attributed,
  // and a version bump should not be able to fail this test.
  assert.match(html, /^<!-- Pi Heao GUI V\d+\.\d+(?:\.\d+)? · made by HEAOZIE -->/);
  assert.match(html, /made by HEAOZIE/);
  const brand = html.match(/<span class="pi-tb-brand"[^>]*>([^<]*)<\/span>/);
  assert.ok(brand, "titlebar brand span exists");
  assert.match(brand[1], /HEAOZIE/);
  assert.match(html, /<span class="pi-tb-app">Pi Heao GUI<\/span>/);
});

test("background image is inlined only for known image types", { skip: !hasUi }, () => {
  /** The bundle turns the placeholder into a quoted string assignment. */
  const bgOf = (html) => (html.match(/window\.__PI_BG_IMAGE__ = "([^"]*)"/) || [])[1];

  const png = path.join(ROOT, "build", "icon.png");
  assert.ok(fs.existsSync(png), "fixture icon present");
  assert.match(bgOf(build({ chatBackgroundImage: png })), /^data:image\/png;base64,/);

  const txt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "heao-bg-")), "note.txt");
  fs.writeFileSync(txt, "not an image");
  assert.equal(bgOf(build({ chatBackgroundImage: txt })), "");

  // a relative path is never resolved against some ambient cwd
  assert.equal(bgOf(build({ chatBackgroundImage: "icon.png" })), "");
});
