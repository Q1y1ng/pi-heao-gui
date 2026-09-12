/**
 * Tests for the async, cached session lister (dist/main/sessions.js).
 *
 * The old implementation read every .jsonl in full, synchronously, every 5s
 * (~170 MB per pass on a real profile). These tests pin the behaviours that
 * replaced it: head/tail slicing, name sources, malformed-line tolerance,
 * recursion, pinning and cache hit/invalidation.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSessionLister } = require("../dist/main/sessions.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "heao-sessions-"));
const sessionsDir = path.join(tmp, "sessions");
const cachePath = path.join(tmp, "session-names.json");
fs.mkdirSync(path.join(sessionsDir, "traces"), { recursive: true });

const j = (o) => JSON.stringify(o);
const write = (rel, lines) =>
  fs.writeFileSync(path.join(sessionsDir, rel), `${lines.join("\n")}\n`);

// A: renamed via session_info near the tail (also the pinned one)
write("a.jsonl", [
  j({ type: "session", id: "a-1" }),
  j({ type: "message", message: { role: "user", content: "first message shouldn't win" } }),
  "not json at all",
  j({ type: "session_info", name: "命名会话A" }),
]);

// B: no session_info -> name comes from the first user message, truncated
write("b.jsonl", [
  j({
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "B".repeat(40) }] },
  }),
]);

// C: > 64 KB so the head/tail slices matter
const filler = Array.from({ length: 90 }, (_, i) =>
  j({ type: "message", message: { role: "assistant", content: "x".repeat(1024) + i } }),
);
write("c.jsonl", [
  j({ type: "message", message: { role: "user", content: "头部消息不该生效" } }),
  ...filler,
  j({ type: "session_info", name: "大文件尾部命名" }),
]);

// E: nested under traces/ — the lister recurses
write(path.join("traces", "e.jsonl"), [j({ type: "session", id: "e-1" })]);

const pinnedFile = path.join(sessionsDir, "a.jsonl");
const newLister = () => createSessionLister({ sessionsDir, cachePath, pinned: () => [pinnedFile] });
const byBase = (items) => Object.fromEntries(items.map((i) => [path.basename(i.file), i]));

test("names come from tail session_info, then head first user message, then filename", async () => {
  const items = await newLister().list();
  const m = byBase(items);

  assert.equal(m["a.jsonl"].name, "命名会话A", "tail session_info wins over the first message");
  assert.equal(m["b.jsonl"].name, `${"B".repeat(36)}…`, "first user message is truncated");
  assert.equal(m["c.jsonl"].name, "大文件尾部命名", "found even though the file is > 64 KB");
  assert.equal(m["e.jsonl"].name.length > 0, true, "nested sessions are listed");
  assert.equal(m["a.jsonl"].sessionId, "a-1");
  assert.equal(m["e.jsonl"].sessionId, "e-1");
  assert.ok(items.length >= 4, `expected >= 4 sessions, got ${items.length}`);
  assert.equal(m["b.jsonl"].name.includes("B".repeat(37)), false);
});

test("malformed lines do not abort the scan", async () => {
  const items = await newLister().list();
  assert.equal(byBase(items)["a.jsonl"].name, "命名会话A");
});

test("pinned sessions sort first, then by mtime", async () => {
  const items = await newLister().list();
  assert.equal(items[0].pinned, true);
  assert.equal(path.basename(items[0].file), "a.jsonl");
  const rest = items.slice(1);
  for (let i = 1; i < rest.length; i++) {
    assert.ok(rest[i - 1].mtime >= rest[i].mtime, "descending mtime");
  }
});

test("parsed metadata is cached, and the cache is actually used", async () => {
  await newLister().list();
  await new Promise((r) => setTimeout(r, 100)); // saveCache is fire-and-forget
  assert.ok(fs.existsSync(cachePath), "cache file written");

  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.ok(Object.keys(cache).length >= 4);

  // Poison the cached name: if the lister re-parsed the file, the real name wins.
  cache[pinnedFile].name = "CACHED-NAME";
  fs.writeFileSync(cachePath, JSON.stringify(cache));

  const items = await newLister().list();
  assert.equal(byBase(items)["a.jsonl"].name, "CACHED-NAME", "cache hit (no re-parse)");
});

test("a changed file is re-parsed (mtime/size invalidation)", async () => {
  const before = byBase(await newLister().list())["a.jsonl"].name;
  assert.equal(before, "CACHED-NAME");

  fs.appendFileSync(pinnedFile, `${j({ type: "session_info", name: "改名后的会话" })}\n`);
  const after = byBase(await newLister().list())["a.jsonl"].name;
  assert.equal(after, "改名后的会话");
});

test("deleted sessions drop out of the list", async () => {
  fs.rmSync(path.join(sessionsDir, "b.jsonl"));
  const items = await newLister().list();
  assert.equal(Object.hasOwn(byBase(items), "b.jsonl"), false);
});

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
