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

// ─── Importing a session from elsewhere ───────────────────────────────────────

const { checkSessionFile, sessionSlug, importSession } = require("../dist/main/session-ops.js");

const header = (cwd, id = "abc-123") =>
  JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-09-19T00:00:00.000Z", cwd });

test("a pi session file is recognised by its header", () => {
  const check = checkSessionFile(`${header("C:\repo")}\n{"type":"message"}\n`);
  assert.equal(check.ok, true);
  assert.equal(check.cwd, "C:\repo");
  assert.equal(check.sessionId, "abc-123");
});

test("a file that is not a session is refused, with a reason", () => {
  for (const [text, why] of [
    ["", "空"],
    ["\n\n", "空"],
    ["not json at all\n", "不是 JSON"],
    ['["a","b"]\n', "数组"],
    ['{"hello":"world"}\n', "没有 id 也没有时间戳"],
  ]) {
    const check = checkSessionFile(text);
    assert.equal(check.ok, false, JSON.stringify(text));
    assert.ok(check.reason, `no reason for ${JSON.stringify(text)}: ${why}`);
  }
});

test("a session directory name is pi's own shape", () => {
  // Verified against a real profile: `~/.pi/agent/sessions/--E--AI-pi-standalone-gui--/`.
  const windowsPath = ["E:", "AI", "pi-standalone-gui"].join(String.fromCharCode(92));
  assert.equal(sessionSlug(windowsPath), "--E--AI-pi-standalone-gui--");
  assert.equal(sessionSlug("/home/a/repo"), "---home-a-repo--");
});

test("an import lands in the session store, keeping the conversation verbatim", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-import-"));
  const from = path.join(dir, "elsewhere.jsonl");
  const body = `${header(dir)}\n{"type":"message","id":"m1"}\n{"type":"message","id":"m2"}\n`;
  fs.writeFileSync(from, body, "utf8");
  const sessionsDir = path.join(dir, "sessions");
  const result = await importSession({ from, sessionsDir, fallbackCwd: dir });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.cwdRewritten, false, "the recorded directory exists here");
  assert.equal(fs.readFileSync(result.file, "utf8"), body, "the file is copied, not rewritten");
  assert.equal(path.dirname(result.file), path.join(sessionsDir, sessionSlug(dir)));
});

test("a session from a machine whose directory does not exist here is re-pointed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-import-"));
  const from = path.join(dir, "other-machine.jsonl");
  fs.writeFileSync(from, `${header(["D:", "gone", "project"].join(String.fromCharCode(92)))}\n{"type":"message"}\n`, "utf8");
  const sessionsDir = path.join(dir, "sessions");
  const result = await importSession({ from, sessionsDir, fallbackCwd: dir });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.cwdRewritten, true);
  assert.equal(result.cwd, dir);
  const first = fs.readFileSync(result.file, "utf8").split("\n")[0];
  assert.equal(JSON.parse(first).cwd, dir, "pi resumes in a directory that exists");
  assert.equal(
    fs.readFileSync(result.file, "utf8").split("\n")[1],
    '{"type":"message"}',
    "and nothing else moved",
  );
});

test("importing the same file twice does not overwrite the first copy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-import-"));
  const from = path.join(dir, "twice.jsonl");
  fs.writeFileSync(from, `${header(dir)}\n{"type":"message"}\n`, "utf8");
  const sessionsDir = path.join(dir, "sessions");
  const first = await importSession({ from, sessionsDir, fallbackCwd: dir });
  const second = await importSession({ from, sessionsDir, fallbackCwd: dir });
  assert.equal(first.ok && second.ok, true);
  assert.notEqual(first.file, second.file);
  assert.ok(second.file.endsWith("-2.jsonl"), second.file);
  assert.equal(fs.existsSync(first.file), true, "the first import is still there");
});

test("junk is refused and nothing is written", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-import-"));
  const from = path.join(dir, "junk.jsonl");
  fs.writeFileSync(from, "hello, this is not a session\n", "utf8");
  const sessionsDir = path.join(dir, "sessions");
  const result = await importSession({ from, sessionsDir, fallbackCwd: dir });
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(fs.existsSync(sessionsDir), false, "no directory is created for a file that is not one");
});
