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
