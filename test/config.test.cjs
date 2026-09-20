/**
 * Unit tests for the config / secret / path-guard helpers (dist/main/config.js).
 * These are the pure pieces behind the P0 fixes: config coercion, API-key
 * masking round-trips and the shell.openPath guard.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  sanitizeConfig,
  maskSecret,
  authToPublic,
  restoreMaskedSecrets,
  parseJsonObject,
  checkOpenPath,
  MASK,
} = require("../dist/main/config.js");
const { DEFAULT_CONFIG } = require("../dist/shared/types.js");

test("sanitizeConfig: coerces a hostile shape", () => {
  const c = sanitizeConfig({
    args: "not-an-array", // used to be spread into single characters
    chatFontSize: 999,
    chatBackgroundOpacity: -3,
    mcpIdleTimeout: "abc",
    language: "klingon",
    permissionMode: "root",
    env: { GOOD: "1", BAD: 2, ALSO_BAD: null },
    pinnedSessions: ["/a.jsonl", 42, null],
    unknownKey: "ignored",
  });

  assert.deepEqual(c.args, []);
  assert.equal(c.chatFontSize, 32, "clamped to max");
  assert.equal(c.chatBackgroundOpacity, 0, "clamped to min");
  assert.equal(c.mcpIdleTimeout, DEFAULT_CONFIG.mcpIdleTimeout, "NaN -> default");
  assert.equal(c.language, "auto");
  assert.equal(c.permissionMode, "AskForApproval");
  assert.deepEqual(c.env, { GOOD: "1" });
  assert.deepEqual(c.pinnedSessions, ["/a.jsonl"]);
  assert.equal(Object.hasOwn(c, "unknownKey"), false);
});

test("sanitizeConfig: garbage input falls back to defaults", () => {
  assert.deepEqual(sanitizeConfig(null), { ...DEFAULT_CONFIG });
  assert.deepEqual(sanitizeConfig("string"), { ...DEFAULT_CONFIG });
  assert.deepEqual(sanitizeConfig([1, 2, 3]), { ...DEFAULT_CONFIG });
  assert.equal(sanitizeConfig({ chatSendShortcut: "ctrlEnter" }).chatSendShortcut, "ctrlEnter");
  assert.equal(sanitizeConfig({ chatSendShortcut: "nope" }).chatSendShortcut, "enter");
});

test("maskSecret / authToPublic: no plaintext key leaves the main process", () => {
  assert.equal(maskSecret("sk-1234567890abcdef"), `sk-1${MASK}cdef`);
  assert.equal(maskSecret("short"), MASK);
  assert.equal(maskSecret(""), "");
  assert.equal(maskSecret(undefined), "");

  const auth = JSON.stringify({
    openai: "sk-1234567890abcdef",
    anthropic: { apiKey: "sk-ant-1234567890", note: "keep me" },
    tiny: "abc",
  });
  const masked = authToPublic(auth);
  assert.equal(masked.includes("sk-1234567890abcdef"), false);
  assert.equal(masked.includes("sk-ant-1234567890"), false);
  const parsed = JSON.parse(masked);
  assert.equal(parsed.anthropic.note, "keep me", "non-secret fields survive");
  assert.equal(parsed.tiny, MASK);
});

test("restoreMaskedSecrets: unchanged masks keep the real secret", () => {
  const onDisk = { openai: { apiKey: "sk-real-key-123456" }, other: "secret-value-9876" };
  const asRendered = JSON.parse(authToPublic(JSON.stringify(onDisk)));

  // user edits nothing and saves
  assert.deepEqual(restoreMaskedSecrets(asRendered, onDisk), onDisk);

  // user replaces one key
  const edited = { ...asRendered, openai: { apiKey: "sk-brand-new-key-0001" } };
  const merged = restoreMaskedSecrets(edited, onDisk);
  assert.equal(merged.openai.apiKey, "sk-brand-new-key-0001");
  assert.equal(merged.other, "secret-value-9876", "untouched provider restored");
});

test("parseJsonObject: only real objects survive the boundary", () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject("[1,2]"), {});
  assert.deepEqual(parseJsonObject("not json"), {});
  assert.deepEqual(parseJsonObject(""), {});
});

test("checkOpenPath: refuses executable types and UNC/device paths", () => {
  for (const bad of [
    "C:\\Windows\\System32\\calc.exe",
    "C:\\tmp\\evil.bat",
    "C:\\tmp\\evil.cmd",
    "C:\\tmp\\evil.ps1",
    "C:\\tmp\\evil.vbs",
    "C:\\tmp\\evil.lnk",
    "C:\\tmp\\evil.url",
    "C:\\tmp\\evil.js",
    "C:\\tmp\\evil.msi",
    "C:\\tmp\\evil.scr",
    "\\\\server\\share\\file.txt",
    "//server/share/file.txt",
    "\\\\.\\PhysicalDrive0",
    "",
  ]) {
    assert.equal(checkOpenPath(bad, "").ok, false, `${bad} must be refused`);
  }
});

test("checkOpenPath: allows documents and resolves relative paths", () => {
  const abs = checkOpenPath("C:\\work\\notes.md", "C:\\work");
  assert.equal(abs.ok, true);
  assert.equal(abs.path, "C:\\work\\notes.md");

  const rel = checkOpenPath("src\\index.ts", "C:\\work");
  assert.equal(rel.ok, true);
  assert.equal(rel.path, path.resolve("C:\\work", "src\\index.ts"));

  // relative without a workspace root stays relative (no crash)
  assert.equal(checkOpenPath("notes.txt", "").ok, true);
});

test("sanitizeProjects: keeps usable rows and drops the rest", () => {
  const { sanitizeProjects } = require("../dist/main/config.js");
  // Paths are built with path.resolve rather than written out: a literal Windows path in a test file
  // has to survive one more layer of escaping than it is worth, and this stays honest on any platform.
  const repo = path.resolve("repo");
  const other = path.resolve("other");
  const rows = sanitizeProjects([
    { path: repo, name: "repo", addedAt: 5, lastUsedAt: 9 },
    { path: `${repo}${path.sep}`, name: "duplicate spelling" }, // same directory, dropped
    { path: `relative${path.sep}dir` }, // not absolute, dropped
    { path: "" }, // empty, dropped
    "not an object",
    null,
    { path: other }, // no name: the directory name is used
  ]);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["repo", "other"],
  );
  assert.equal(rows[0].addedAt, 5);
  assert.equal(rows[1].lastUsedAt, 0, "missing timestamps become 0, not NaN");
});

test("sanitizeConfig: projects and the grouping axis survive a hand-edited file", () => {
  const repo = path.resolve("repo");
  const cfg = sanitizeConfig({ projects: [{ path: repo }], sidebarGroupBy: "project" });
  assert.equal(cfg.projects.length, 1);
  assert.equal(cfg.projects[0].name, "repo");
  assert.equal(cfg.sidebarGroupBy, "project");

  const fallback = sanitizeConfig({ projects: "nope", sidebarGroupBy: "nonsense" });
  assert.deepEqual(fallback.projects, []);
  assert.equal(fallback.sidebarGroupBy, "time", "an unknown axis falls back to time");
});

test("sanitizeConfig: dangerous patterns fall back to the shipped rules, not to nothing", () => {
  const { DEFAULT_DANGEROUS_PATTERNS } = require("../dist/shared/types.js");

  // A config written before the defaults existed has no key at all. Reading that as
  // [] is what made "危险命令需确认" a screen that said one thing and a gate that did
  // another — every command ran, and nothing on screen disagreed.
  const old = sanitizeConfig({ permissionMode: "AskForApproval" });
  assert.deepEqual(old.dangerousPatterns, [...DEFAULT_DANGEROUS_PATTERNS]);
  assert.ok(old.dangerousPatterns.length > 20, "the shipped list is a real one");

  // An explicit empty list is a decision, and it is kept as written.
  assert.deepEqual(sanitizeConfig({ dangerousPatterns: [] }).dangerousPatterns, []);

  // Every shipped pattern compiles: the gate drops what does not, silently.
  for (const p of DEFAULT_DANGEROUS_PATTERNS) new RegExp(p, "i");

  const messy = sanitizeConfig({
    dangerousPatterns: ["  \bfoo\b  ", "", "   ", 42, null, "x".repeat(400)],
  });
  assert.deepEqual(messy.dangerousPatterns, ["\bfoo\b"], "trimmed, non-strings and blobs dropped");
  assert.ok(
    sanitizeConfig({ dangerousPatterns: Array.from({ length: 500 }, () => "a") }).dangerousPatterns
      .length <= 200,
    "bounded: every pattern is compiled on every pi start-up",
  );
});

test("the shipped dangerous-command list is upstream's, byte for byte", () => {
  const { DEFAULT_DANGEROUS_PATTERNS } = require("../dist/shared/types.js");
  const upstream =
    require("../studio/package.json").contributes.configuration.properties[
      "pi-agent-studio.permission.dangerousPatterns"
    ].default;
  // Copied rather than imported (studio/ is vendored), so the copy is pinned here:
  // a real command has to be caught by the standalone gate too.
  assert.deepEqual([...DEFAULT_DANGEROUS_PATTERNS], upstream);
  const rm = DEFAULT_DANGEROUS_PATTERNS.map((p) => new RegExp(p, "i"));
  assert.ok(rm.some((r) => r.test("rm -rf /tmp/x")), "rm -rf is in the list");
  assert.ok(rm.some((r) => r.test("git push --force origin main")), "force push is in the list");
  assert.ok(!rm.some((r) => r.test("npm run build")), "and a build is not");
});

test("checkOpenPath: protected locations are refused, whatever the workspace is", () => {
  const home = path.resolve("C:/Users/me");
  const protectedPaths = [path.join(home, ".ssh"), path.join(home, ".pi")];

  // The workspace IS the home directory in the default install, so "inside the workspace"
  // cannot be the only rule: handing a key file to the OS default application is a way
  // around the file panel's guard, not through it.
  for (const raw of [
    path.join(home, ".ssh", "id_rsa"),
    path.join(home, ".pi", "agent", "auth.json"),
    path.join(home, ".pi"),
  ]) {
    const check = checkOpenPath(raw, home, protectedPaths);
    assert.equal(check.ok, false, `${raw} must be refused`);
    assert.match(check.error, /protected location/);
  }

  // A normal file in the same workspace still opens, and an unprotected dot-directory too.
  assert.equal(checkOpenPath(path.join(home, "notes.md"), home, protectedPaths).ok, true);
  assert.equal(checkOpenPath(path.join(home, ".config", "x.json"), home, []).ok, true);
  // Without the list (the old call shape) nothing about it changes.
  assert.equal(checkOpenPath(path.join(home, ".ssh", "id_rsa"), home).ok, true);
  // A sibling whose name merely starts with the protected one is not inside it.
  assert.equal(checkOpenPath(path.join(home, ".ssh-backup", "x.txt"), home, protectedPaths).ok, true);
});
