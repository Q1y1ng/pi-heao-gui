/**
 * Unit tests for the Windows spawn resolver (dist/main/rpc-client.js).
 * This is the code that replaced `cmd.exe /c pi.cmd ...`, where any argument
 * containing `&` was a command injection.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveSpawnTarget, resolveWindowsShim } = require("../dist/main/rpc-client.js");

const isWin = process.platform === "win32";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heao-spawn-"));

/** An npm-style shim for a real node script we control. */
function writeNpmShim(name, scriptPath) {
  const shim = path.join(tmp, name);
  fs.writeFileSync(
    shim,
    [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      "",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ") ELSE (",
      '  SET "_prog=node"',
      "  SET PATHEXT=%PATHEXT:;.JS;=;%",
      ")",
      "",
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "${scriptPath}" %*`,
      "",
    ].join("\r\n"),
  );
  return shim;
}

test("npm shim is resolved to node + cli.js (no cmd.exe)", { skip: !isWin }, () => {
  const script = path.join(tmp, "fake-cli.js");
  fs.writeFileSync(script, "console.log('ok');");
  const shim = writeNpmShim("fake.cmd", script);

  const shimmed = resolveWindowsShim(shim, ["--mode", "rpc"]);
  assert.ok(shimmed, "shim should be parsed");
  assert.equal(shimmed.command, "node");
  assert.deepEqual(shimmed.args, [script, "--mode", "rpc"]);

  const target = resolveSpawnTarget(shim, ["--version"]);
  assert.equal(/cmd\.exe$/i.test(target.command), false, "must not go through cmd.exe");
  assert.deepEqual(target.args, [script, "--version"]);
});

test("shell metacharacters stay data, never a second command", { skip: !isWin }, () => {
  const script = path.join(tmp, "fake-cli2.js");
  fs.writeFileSync(script, "");
  const shim = writeNpmShim("fake2.cmd", script);

  const target = resolveSpawnTarget(shim, ["a&echo PWNED", "b|c", "d>e"]);
  assert.equal(/cmd\.exe$/i.test(target.command), false);
  assert.deepEqual(target.args.slice(1), ["a&echo PWNED", "b|c", "d>e"]);
});

test("unparseable shim: safe args fall back to cmd.exe, unsafe args are refused", {
  skip: !isWin,
}, () => {
  const bogus = path.join(tmp, "bogus.cmd");
  fs.writeFileSync(bogus, "@echo off\r\nREM nothing to resolve here\r\n");

  assert.equal(resolveWindowsShim(bogus, []), null);

  const safe = resolveSpawnTarget(bogus, ["--version"]);
  assert.equal(/cmd\.exe$/i.test(safe.command), true, "plain args may still use cmd.exe");

  assert.throws(
    () => resolveSpawnTarget(bogus, ["a&echo PWNED"]),
    /特殊字符/,
    "metacharacters must raise instead of being handed to cmd.exe",
  );
});

test("non-shim paths pass through untouched", () => {
  const target = resolveSpawnTarget("C:\\tools\\pi.exe", ["--version"]);
  assert.equal(target.command, "C:\\tools\\pi.exe");
  assert.deepEqual(target.args, ["--version"]);
  assert.equal(resolveSpawnTarget("pi", []).command, "pi");
});

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
