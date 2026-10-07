// Context-file discovery — unit tests for pi's loading rule, mirrored in src/main/context-files.ts.
// Runs against a fake fs (an object of path → "file" | "dir"), so the rules are exercised without
// touching disk; the real fs wiring is a two-liner in main.ts.
//
// All fixture paths are built from the platform root (`path.resolve(path.sep)`) so the same test
// runs on Windows (C:\…) and POSIX (/…) — the discovery code joins/resolves like the real thing,
// and on Windows a hand-written "/w" would not match its own joined form.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const {
  CONTEXT_CANDIDATES,
  pickContextFile,
  discoverContextFiles,
  shadowedContextPath,
  canonicalPath,
} = require("../dist/main/context-files.js");

const ROOT = path.resolve(path.sep);
const W = path.join(ROOT, "w");
const SUB = path.join(W, "sub");
const AGENT = path.join(ROOT, "home", ".pi", "agent");
const MAIN = path.join(ROOT, "main");
const WT = path.join(MAIN, ".wt");

/** Fake fs: keys are absolute paths, values "file" or "dir". */
function fakeFs(entries) {
  const exists = (p) => Object.prototype.hasOwnProperty.call(entries, p);
  return {
    exists,
    isFile: (p) => exists(p) && entries[p] === "file",
  };
}

const canon = (p) => canonicalPath(p);

test("candidate priority order matches pi (override > AGENTS.md > AGENTS.MD > CLAUDE.md > CLAUDE.MD)", () => {
  assert.deepStrictEqual([...CONTEXT_CANDIDATES], [
    "AGENTS.override.md",
    "AGENTS.md",
    "AGENTS.MD",
    "CLAUDE.md",
    "CLAUDE.MD",
  ]);
});

test("pickContextFile: first existing candidate wins, one file per directory", () => {
  const fs = fakeFs({
    [path.join(W, "AGENTS.override.md")]: "file",
    [path.join(W, "AGENTS.md")]: "file",
    [path.join(W, "CLAUDE.md")]: "file",
  });
  assert.strictEqual(pickContextFile(W, fs), path.join(W, "AGENTS.override.md"));

  const noOverride = fakeFs({
    [path.join(W, "AGENTS.md")]: "file",
    [path.join(W, "CLAUDE.md")]: "file",
  });
  assert.strictEqual(pickContextFile(W, noOverride), path.join(W, "AGENTS.md"));

  const claudeOnly = fakeFs({ [path.join(W, "CLAUDE.md")]: "file" });
  assert.strictEqual(pickContextFile(W, claudeOnly), path.join(W, "CLAUDE.md"));
});

test("pickContextFile: a directory named like a candidate is skipped", () => {
  const fs = fakeFs({
    [path.join(W, "AGENTS.md")]: "dir",
    [path.join(W, "CLAUDE.md")]: "file",
  });
  assert.strictEqual(pickContextFile(W, fs), path.join(W, "CLAUDE.md"));
});

test("pickContextFile: nothing present → null", () => {
  assert.strictEqual(pickContextFile(W, fakeFs({})), null);
});

test("discover: global only, when the cwd chain has nothing", () => {
  const fs = fakeFs({ [path.join(AGENT, "AGENTS.md")]: "file" });
  const files = discoverContextFiles({ cwd: W, agentDir: AGENT, fs });
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].level, "global");
  assert.strictEqual(canon(files[0].path), canon(path.join(AGENT, "AGENTS.md")));
});

test("discover: global first, then the chain root-first → cwd-last", () => {
  const fs = fakeFs({
    [path.join(AGENT, "AGENTS.md")]: "file",
    [path.join(W, "AGENTS.md")]: "file",
    [path.join(SUB, "AGENTS.md")]: "file",
  });
  const files = discoverContextFiles({ cwd: SUB, agentDir: AGENT, fs });
  assert.strictEqual(files.length, 3);
  assert.strictEqual(files[0].level, "global");
  assert.strictEqual(canon(files[1].path), canon(path.join(W, "AGENTS.md")));
  assert.strictEqual(canon(files[2].path), canon(path.join(SUB, "AGENTS.md")));
  assert.strictEqual(files[2].level, "project");
});

test("discover: override at a level replaces that level's file", () => {
  const fs = fakeFs({
    [path.join(AGENT, "AGENTS.md")]: "file",
    [path.join(W, "AGENTS.override.md")]: "file",
    [path.join(W, "AGENTS.md")]: "file",
  });
  const files = discoverContextFiles({ cwd: W, agentDir: AGENT, fs });
  const names = files.filter((f) => f.level === "project").map((f) => f.name);
  assert.deepStrictEqual(names, ["AGENTS.override.md"]);
});

test("discover: no double-count when the agent dir sits on the cwd chain", () => {
  const fs = fakeFs({ [path.join(AGENT, "AGENTS.md")]: "file" });
  const files = discoverContextFiles({ cwd: AGENT, agentDir: AGENT, fs });
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].level, "global");
});

test("discover: empty everywhere → empty list (pi starts with no memory)", () => {
  const files = discoverContextFiles({ cwd: W, agentDir: AGENT, fs: fakeFs({}) });
  assert.deepStrictEqual(files, []);
});

test("shadow: linked worktree — the worktree's file wins, the main-root copy is excluded", () => {
  const fs = fakeFs({
    [path.join(AGENT, "AGENTS.md")]: "file",
    [path.join(MAIN, "AGENTS.md")]: "file",
    [path.join(WT, "AGENTS.md")]: "file",
  });
  const gitInfo = { repoDir: WT, commonGitDir: path.join(MAIN, ".git") };
  const files = discoverContextFiles({
    cwd: path.join(WT, "src"),
    agentDir: AGENT,
    fs,
    gitInfo,
  });
  const projectPaths = files.filter((f) => f.level === "project").map((f) => canon(f.path));
  assert.ok(projectPaths.includes(canon(path.join(WT, "AGENTS.md"))), "worktree file listed");
  assert.ok(!projectPaths.includes(canon(path.join(MAIN, "AGENTS.md"))), "main-root file shadowed out");
});

test("shadow: plain checkout — nothing is excluded (prefix test fails for the main repo itself)", () => {
  const fs = fakeFs({ [path.join(MAIN, "AGENTS.md")]: "file" });
  const gitInfo = { repoDir: MAIN, commonGitDir: path.join(MAIN, ".git") };
  const files = discoverContextFiles({ cwd: MAIN, agentDir: AGENT, fs, gitInfo });
  assert.strictEqual(files.filter((f) => f.level === "project").length, 1);
});

test("shadow: same-named file only — a differently named main-root file still loads", () => {
  const fs = fakeFs({
    [path.join(MAIN, "CLAUDE.md")]: "file",
    [path.join(WT, "AGENTS.md")]: "file",
  });
  const gitInfo = { repoDir: WT, commonGitDir: path.join(MAIN, ".git") };
  const files = discoverContextFiles({ cwd: WT, agentDir: AGENT, fs, gitInfo });
  const names = files.filter((f) => f.level === "project").map((f) => f.name);
  assert.ok(names.includes("CLAUDE.md"), "different name in main root is not shadowed");
  assert.ok(names.includes("AGENTS.md"), "worktree's own file listed");
});

test("shadow helper: no git info → null; cwd outside the main repo → null", () => {
  const pick = () => null;
  assert.strictEqual(shadowedContextPath(W, null, pick), null);
  const elsewhere = path.join(ROOT, "elsewhere");
  assert.strictEqual(
    shadowedContextPath(elsewhere, { repoDir: elsewhere, commonGitDir: path.join(MAIN, ".git") }, pick),
    null,
  );
});
