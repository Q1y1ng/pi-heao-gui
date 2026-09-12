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
const UI_BUNDLE = path.join(ROOT, "vendor", "upstream", "pi-chat", "dist", "index.html");
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

test("config values cannot break out of the injected script block", { skip: !hasUi }, () => {
  const html = build({
    args: ["</script><img src=x onerror=alert(1)>"],
    workspaceRoot: "C:\\w</script>",
    env: { EVIL: "</script>" },
  });

  const injected = html.match(/<script>window\.__PI_HEAO_CONFIG__[\s\S]*?<\/script>/);
  assert.ok(injected, "config script injected");
  assert.equal(injected[0].includes("</script><img"), false, "no premature </script>");
  assert.equal(injected[0].includes("<img"), false);
  assert.match(injected[0], /\\u003c\/script>/);
  assert.equal(html.includes("onerror=alert(1)></script>"), false);
});

test("no unreplaced placeholders are left behind", { skip: !hasUi }, () => {
  const html = build();
  assert.equal(/PI_[A-Z_]+_PLACEHOLDER/.test(html), false);
  assert.match(html, /PI_HEAO/);
});

test("build signature and author watermark are present", { skip: !hasUi }, () => {
  const html = build();
  assert.match(html, /<!-- Pi Heao GUI V0\.1 · made by HEAOZIE -->/);
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
