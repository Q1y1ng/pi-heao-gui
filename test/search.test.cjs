/**
 * Full-text session search.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { searchSessions, orderByRecency } = require("../dist/main/search.js");

function sessionFile(name, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-search-"));
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return file;
}

const userMsg = (text, ts) => ({
  type: "message",
  id: `u-${ts}`,
  parentId: null,
  timestamp: ts,
  message: { role: "user", content: text },
});
const asstMsg = (blocks, ts) => ({
  type: "message",
  id: `a-${ts}`,
  parentId: null,
  timestamp: ts,
  message: { role: "assistant", content: blocks },
});

test("finds matches in user text and assistant text blocks", async () => {
  const file = sessionFile("a", [
    userMsg("please refactor the parser", "2026-01-01T10:00:00.000Z"),
    asstMsg([{ type: "text", text: "I will refactor the parser now" }], "2026-01-01T10:00:05.000Z"),
  ]);
  const hits = await searchSessions({ files: [file], nameOf: () => "会话 A", query: "refactor" });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].role, "assistant"); // newest first
  assert.equal(hits[0].sessionName, "会话 A");
  assert.equal(hits[1].role, "user");
  assert.equal(hits[0].snippet.includes("refactor"), true);
  assert.equal(hits[0].matchLength, "refactor".length);
  assert.ok(hits[0].at > 0);
});

test("case-insensitive, and returns the match offsets inside the snippet", async () => {
  const file = sessionFile("b", [userMsg("Deploy to STAGING please", "2026-01-02T10:00:00.000Z")]);
  const hits = await searchSessions({ files: [file], nameOf: () => "b", query: "staging" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].snippet.slice(hits[0].matchStart, hits[0].matchStart + 7).toLowerCase(), "staging");
});

test("queries shorter than two characters return nothing", async () => {
  const file = sessionFile("c", [userMsg("a", "2026-01-03T10:00:00.000Z")]);
  assert.deepEqual(await searchSessions({ files: [file], nameOf: () => "c", query: "a" }), []);
  assert.deepEqual(await searchSessions({ files: [file], nameOf: () => "c", query: "  " }), []);
});

test("limits hits per file and in total, newest sessions first", async () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    userMsg(`needle ${i}`, `2026-02-0${(i % 9) + 1}T10:00:00.000Z`),
  );
  const file = sessionFile("d", many);
  const hits = await searchSessions({ files: [file], nameOf: () => "d", query: "needle", perFile: 3 });
  assert.equal(hits.length, 3);
  // newest first
  assert.ok(hits[0].at >= hits[1].at);
  assert.ok(hits[1].at >= hits[2].at);

  const capped = await searchSessions({ files: [file, file], nameOf: () => "d", query: "needle", limit: 4, perFile: 3 });
  assert.equal(capped.length, 4);
});

test("ignores non-message entries and malformed lines", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-search-"));
  const file = path.join(dir, "e.jsonl");
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ type: "session", id: "s", needle: "not a message" }),
      "this is not json at all but mentions needle",
      JSON.stringify(userMsg("real needle here", "2026-01-04T10:00:00.000Z")),
    ].join("\n") + "\n",
    "utf8",
  );
  const hits = await searchSessions({ files: [file], nameOf: () => "e", query: "needle" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].lineNo, 3);
});

test("reports progress for every file it scans", async () => {
  const f1 = sessionFile("f1", [userMsg("alpha", "2026-01-05T10:00:00.000Z")]);
  const f2 = sessionFile("f2", [userMsg("beta", "2026-01-06T10:00:00.000Z")]);
  const seen = [];
  await searchSessions({
    files: [f1, f2],
    nameOf: (f) => path.basename(f),
    query: "alpha",
    onProgress: (p) => seen.push(p),
  });
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((p) => p.scanned),
    [1, 2],
  );
  assert.equal(seen[1].total, 2);
});

test("shouldStop aborts the walk early", async () => {
  const f1 = sessionFile("g1", [userMsg("gamma", "2026-01-07T10:00:00.000Z")]);
  const f2 = sessionFile("g2", [userMsg("gamma again", "2026-01-08T10:00:00.000Z")]);
  let calls = 0;
  const hits = await searchSessions({
    files: [f1, f2],
    nameOf: () => "g",
    query: "gamma",
    shouldStop: () => calls++ > 0, // stop after the first file
  });
  assert.equal(hits.length, 1);
});

test("orderByRecency puts the most recently touched file first and skips missing ones", async () => {
  const old = sessionFile("old", [userMsg("x", "2026-01-01T00:00:00.000Z")]);
  const fresh = sessionFile("fresh", [userMsg("y", "2026-01-01T00:00:00.000Z")]);
  const past = new Date(Date.now() - 86_400_000);
  fs.utimesSync(old, past, past);
  const ordered = await orderByRecency([old, fresh, path.join(os.tmpdir(), "does-not-exist.jsonl")]);
  assert.deepEqual(ordered, [fresh, old]);
});
