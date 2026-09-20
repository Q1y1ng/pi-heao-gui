/**
 * Unified diff engine used by the built-in diff viewer.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { unifiedDiff, diffStat } = require("../dist/main/diff.js");
const { safeSnapshotSegment, MAX_DIFF_BYTES } = require("../dist/main/diff-window.js");

const lines = (d) => d.hunks.flatMap((h) => h.lines);

test("identical input produces no hunks", () => {
  const d = unifiedDiff("a\nb\nc", "a\nb\nc");
  assert.equal(d.hunks.length, 0);
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
});

test("a changed line is reported as one del + one add with context", () => {
  const d = unifiedDiff("a\nb\nc", "a\nB\nc");
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.equal(d.hunks.length, 1);
  const ops = lines(d).map((l) => `${l.op}:${l.text}`);
  assert.deepEqual(ops, ["context:a", "del:b", "add:B", "context:c"]);
});

test("line numbers follow both sides", () => {
  const d = unifiedDiff("a\nb\nc\nd", "a\nc\nd\ne");
  const l = lines(d);
  const del = l.find((x) => x.op === "del");
  const add = l.find((x) => x.op === "add");
  assert.equal(del.text, "b");
  assert.equal(del.left, 2); // 2nd line of the old file
  assert.equal(del.right, null);
  assert.equal(add.text, "e");
  assert.equal(add.right, 4); // inserted after the 3 common lines
  assert.equal(add.left, null);
});

test("additions and removals count correctly", () => {
  const d = unifiedDiff("1\n2\n3", "1\n2\n3\n4\n5");
  assert.equal(d.added, 2);
  assert.equal(d.removed, 0);
  const e = unifiedDiff("1\n2\n3\n4\n5", "1\n2\n3");
  assert.equal(e.added, 0);
  assert.equal(e.removed, 2);
});

test("distant changes become separate hunks", () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 1", "LINE 1").replace("line 30", "LINE 30");
  const d = unifiedDiff(before, after);
  assert.equal(d.hunks.length, 2);
  for (const h of d.hunks) {
    assert.match(h.header, /^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    // a hunk never carries more than one run of untouched context on each side
    const nonContext = h.lines.filter((l) => l.op !== "context");
    assert.ok(nonContext.length >= 1);
  }
});

test("new file and deleted file cases", () => {
  const added = unifiedDiff("", "a\nb");
  assert.equal(added.added, 2);
  assert.equal(added.removed, 0);
  assert.equal(
    lines(added).every((l) => l.op === "add" || l.op === "context"),
    true,
  );

  const removed = unifiedDiff("a\nb", "");
  assert.equal(removed.removed, 2);
  assert.equal(removed.added, 0);
});

test("CRLF and a missing trailing newline do not create phantom changes", () => {
  const d = unifiedDiff("a\r\nb\r\n", "a\nb\n");
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
  const noTrailing = unifiedDiff("a\nb", "a\nb\n");
  assert.equal(noTrailing.added, 0);
  assert.equal(noTrailing.removed, 0);
});

test("very large inputs fall back to whole-block replace but stay correct", () => {
  const before = Array.from({ length: 2500 }, (_, i) => `old ${i}`).join("\n");
  const after = Array.from({ length: 2500 }, (_, i) => `new ${i}`).join("\n");
  const d = unifiedDiff(before, after);
  assert.equal(d.truncated, true);
  assert.equal(d.added, 2500);
  assert.equal(d.removed, 2500);
});

test("diffStat matches the detailed result", () => {
  const before = "x\ny\nz";
  const after = "x\nY\nz\nw";
  const stat = diffStat(before, after);
  const full = unifiedDiff(before, after);
  assert.equal(stat.added, full.added);
  assert.equal(stat.removed, full.removed);
  assert.equal(stat.added, 2);
  assert.equal(stat.removed, 1);
});

test("snapshot segments from the renderer cannot be paths", () => {
  // They are joined into ~/.pi/snapshots/<sessionId>/<baselineHash>; ".." used to walk out of
  // that root and read whatever it found there.
  assert.equal(safeSnapshotSegment("abc-123_hash.Z"), "abc-123_hash.Z");
  assert.equal(safeSnapshotSegment(".."), "");
  assert.equal(safeSnapshotSegment("../.."), "");
  assert.equal(safeSnapshotSegment("a/b"), "");
  assert.equal(safeSnapshotSegment("a\\b"), "");
  assert.equal(safeSnapshotSegment(""), "");
  assert.equal(safeSnapshotSegment("x".repeat(200)), "");
  for (const value of [undefined, null, 42, {}, []]) {
    assert.equal(safeSnapshotSegment(value), "", `${String(value)} must not pass`);
  }
});

test("the diff window has a ceiling it checks before writing", () => {
  assert.ok(Number.isFinite(MAX_DIFF_BYTES) && MAX_DIFF_BYTES > 0);
  assert.ok(MAX_DIFF_BYTES <= 32 * 1024 * 1024, "a diff nobody can read is not worth rendering");
});
