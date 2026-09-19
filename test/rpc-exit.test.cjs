/**
 * What the app says when pi exits by itself.
 *
 * `code 1` is what this banner used to carry, and on Windows that is also exactly what this app's own
 * `taskkill /T /F` produces when a window closes — so the code alone says nothing. The reason pi
 * printed (a failed `npm install` of an agent package, an unreadable config) is the part that lets a
 * person act, and it used to go only to a rotating file in %TEMP%.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { formatExitReason, STDERR_TAIL_LINES } = require(
  path.join(__dirname, "..", "dist", "main", "rpc-client.js"),
);

const HEAD = "Pi process exited (code 1). Click reload or send a message to restart.";

test("exit reason: the code alone when pi printed nothing", () => {
  assert.equal(formatExitReason(1, null), HEAD);
});

test("exit reason: no code and no signal still reads as a sentence", () => {
  assert.equal(
    formatExitReason(null, null),
    "Pi process exited. Click reload or send a message to restart.",
  );
});

test("exit reason: a signal is named when there is no code", () => {
  assert.equal(
    formatExitReason(null, "SIGTERM"),
    "Pi process exited (killed by SIGTERM). Click reload or send a message to restart.",
  );
});

test("exit reason: the last three stderr lines ride along", () => {
  const text = formatExitReason(1, null, ["npm error code ENOTEMPTY", "stack frame", "more stack"]);
  assert.equal(text, `${HEAD}\n\nnpm error code ENOTEMPTY\nstack frame\nmore stack`);
});

test("exit reason: earlier lines are dropped, order is kept", () => {
  const text = formatExitReason(1, null, ["one", "two", "three", "four", "five"]);
  assert.equal(text, `${HEAD}\n\nthree\nfour\nfive`);
});

test("exit reason: blank lines are not part of the reason", () => {
  const text = formatExitReason(1, null, ["   ", "", "the actual reason", "\t"]);
  assert.equal(text, `${HEAD}\n\nthe actual reason`);
});

test("exit reason: a long line is clipped rather than pasted whole", () => {
  const long = "x".repeat(500);
  const text = formatExitReason(1, null, [long]);
  const shown = text.split("\n\n")[1];
  assert.equal(shown.length, 301); // 300 characters plus the ellipsis
  assert.ok(shown.endsWith("…"));
});

test("exit reason: the default tail is empty, not undefined-safe-only", () => {
  assert.equal(formatExitReason(1, null, undefined), HEAD);
  assert.equal(formatExitReason(1, null, []), HEAD);
});

test("exit reason: the tail the client keeps holds its documented number of lines", () => {
  assert.equal(STDERR_TAIL_LINES, 6);
});
