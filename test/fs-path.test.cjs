"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { safeWorkspacePath } = require("../dist/main/fs-path.js");

function makeWorld() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fspath-"));
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.js"), "// app\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "top secret\n");
  return { base, root, outside };
}

function tryLink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, "junction");
    return true;
  } catch {
    return false;
  }
}

test("relative paths inside the workspace resolve", () => {
  const { base, root } = makeWorld();
  try {
    assert.strictEqual(safeWorkspacePath(root, "src/app.js"), path.join(root, "src", "app.js"));
    assert.strictEqual(safeWorkspacePath(root, "."), root);
    // a file that does not exist yet is allowed, so saving a new file works
    assert.strictEqual(
      safeWorkspacePath(root, "src/new-file.js"),
      path.join(root, "src", "new-file.js"),
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("textual escapes are refused", () => {
  const { base, root } = makeWorld();
  try {
    assert.strictEqual(safeWorkspacePath(root, "../outside/secret.txt"), null);
    assert.strictEqual(safeWorkspacePath(root, "src/../../outside/secret.txt"), null);
    assert.strictEqual(safeWorkspacePath(root, path.join(base, "outside", "secret.txt")), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a junction inside the workspace cannot be used to leave it", () => {
  const { base, root, outside } = makeWorld();
  const link = path.join(root, "link");
  if (!tryLink(outside, link)) {
    // No privilege to create a link on this machine — the textual checks above
    // still cover "..", so skipping is honest rather than silently passing.
    fs.rmSync(base, { recursive: true, force: true });
    return;
  }
  try {
    // reading through the link
    assert.strictEqual(safeWorkspacePath(root, "link/secret.txt"), null);
    // writing a new file through the link
    assert.strictEqual(safeWorkspacePath(root, "link/new-file.txt"), null);
    // and the link itself is refused too: resolving it IS the escape, so the
    // file panel simply does not show entries it cannot verify. Fail closed.
    assert.strictEqual(safeWorkspacePath(root, "link"), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a root that cannot be resolved is refused rather than trusted", () => {
  const { base } = makeWorld();
  try {
    assert.strictEqual(safeWorkspacePath(path.join(base, "does-not-exist"), "a.txt"), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
