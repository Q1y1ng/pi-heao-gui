/**
 * Session file operations: path guards, rename entry, archive round-trip.
 * Everything runs inside a temp directory — no real session is ever touched.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  isSessionFile,
  isArchivedPath,
  renameSession,
  deleteSession,
  archiveSession,
  restoreSession,
  listArchived,
} = require("../dist/main/session-ops.js");

function tmpSessions() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sessions-"));
  const dir = path.join(root, "--home-user-project--");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "2026-01-01T00-00-00.jsonl");
  fs.writeFileSync(
    file,
    `${[
      JSON.stringify({ type: "session", id: "sess-1", timestamp: "2026-01-01T00:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: "hello" },
      }),
    ].join("\n")}\n`,
    "utf8",
  );
  return { root, dir, file };
}

test("path guard accepts only .jsonl inside the sessions dir", () => {
  const { root, dir, file } = tmpSessions();
  assert.equal(isSessionFile(file, root), true);
  assert.equal(isSessionFile(path.join(dir, "notes.txt"), root), false);
  assert.equal(isSessionFile(path.join(root, "..", "escaped.jsonl"), root), false);
  assert.equal(isSessionFile("relative.jsonl", root), false);
  assert.equal(isSessionFile("", root), false);
  assert.equal(isSessionFile(path.join(root, "_archived", "x", "y.jsonl"), root), true);
  assert.equal(isArchivedPath(path.join(root, "_archived", "x", "y.jsonl"), root), true);
  assert.equal(isArchivedPath(file, root), false);
});

test("rename appends a valid session_info entry chained to the last entry", async () => {
  const { file } = tmpSessions();
  const res = await renameSession(file, "  我的会话  ");
  assert.equal(res.ok, true);

  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);
  assert.equal(entry.type, "session_info");
  assert.equal(entry.name, "我的会话");
  assert.equal(entry.parentId, "e1"); // chained, so the tree stays consistent
  assert.equal(typeof entry.id, "string");
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("rename rejects an empty name and never corrupts a file without a trailing newline", async () => {
  const { file } = tmpSessions();
  const bad = await renameSession(file, "   ");
  assert.equal(bad.ok, false);

  // simulate a file whose last line has no newline
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").trimEnd(), "utf8");
  const ok = await renameSession(file, "second");
  assert.equal(ok.ok, true);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  for (const line of lines) JSON.parse(line); // every line must still be valid JSON
  assert.equal(JSON.parse(lines[lines.length - 1]).name, "second");
});

test("archive moves the file out of the scanned tree and back again", async () => {
  const { root, file } = tmpSessions();
  const a = await archiveSession(file, root);
  assert.equal(a.ok, true);
  assert.equal(fs.existsSync(file), false);
  assert.equal(isArchivedPath(a.path, root), true);
  assert.equal(fs.existsSync(a.path), true);

  const listed = await listArchived(root);
  assert.deepEqual(listed, [a.path]);

  const r = await restoreSession(a.path, root);
  assert.equal(r.ok, true);
  assert.equal(r.path, file);
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(await listArchived(root), []);
});

test("restore refuses paths outside the archive tree", async () => {
  const { root, file } = tmpSessions();
  const res = await restoreSession(file, root);
  assert.equal(res.ok, false);
});

test("delete removes the file and reports a missing one as an error", async () => {
  const { file } = tmpSessions();
  assert.equal((await deleteSession(file)).ok, true);
  assert.equal(fs.existsSync(file), false);
  const again = await deleteSession(file);
  assert.equal(again.ok, false);
});
