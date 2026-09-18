/**
 * The worktree switcher lists `git worktree list --porcelain`, then switches the workspace to the
 * entry that was picked. Everything before that switch is parsing, so that is what is tested here,
 * including the shapes that are easy to get wrong: a detached HEAD, a bare repository, and locked
 * or prunable worktrees whose reasons contain spaces.
 */
const test = require("node:test");
const assert = require("node:assert");
const { parseWorktrees } = require("../dist/main/git.js");

const SAMPLE = [
  "worktree E:/repo",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree E:/repo-wt/feature",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/feature/nested-name",
  "",
  "worktree E:/repo-wt/detached",
  "HEAD 3333333333333333333333333333333333333333",
  "detached",
  "locked someone is mid-rebase",
  "",
  "worktree E:/repo-wt/bare",
  "bare",
  "",
  "worktree E:/repo-wt/stale",
  "HEAD 4444444444444444444444444444444444444444",
  "branch refs/heads/stale",
  "prunable gitdir file points to non-existent location",
  "",
].join("\n");

test("worktrees: one entry per record, in the order git printed them", () => {
  const list = parseWorktrees(SAMPLE);
  assert.equal(list.length, 5);
  assert.deepEqual(
    list.map((w) => w.path),
    ["E:/repo", "E:/repo-wt/feature", "E:/repo-wt/detached", "E:/repo-wt/bare", "E:/repo-wt/stale"],
  );
});

test("worktrees: the main worktree comes first and keeps its path", () => {
  const first = parseWorktrees(SAMPLE)[0];
  assert.equal(first.path, "E:/repo");
  assert.equal(first.branch, "main");
  assert.equal(first.head, "1".repeat(40));
  assert.equal(first.detached, false);
  assert.equal(first.bare, false);
});

test("worktrees: refs/heads/ is stripped from branch names", () => {
  const feature = parseWorktrees(SAMPLE)[1];
  assert.equal(feature.branch, "feature/nested-name");
  assert.equal(feature.head, "2".repeat(40));
});

test("worktrees: a detached worktree is flagged and has no branch", () => {
  const detached = parseWorktrees(SAMPLE)[2];
  assert.equal(detached.detached, true);
  assert.equal(detached.branch, undefined);
  assert.equal(detached.path, "E:/repo-wt/detached");
});

test("worktrees: locked and prunable reasons survive their spaces", () => {
  const list = parseWorktrees(SAMPLE);
  assert.equal(list[2].locked, "someone is mid-rebase");
  assert.equal(list[4].prunable, "gitdir file points to non-existent location");
  assert.equal(list[0].locked, undefined);
});

test("worktrees: a bare worktree is flagged and carries no HEAD or branch", () => {
  const bare = parseWorktrees(SAMPLE)[3];
  assert.equal(bare.bare, true);
  assert.equal(bare.branch, undefined);
  assert.equal(bare.head, undefined);
});

test("worktrees: empty output parses to nothing", () => {
  assert.deepEqual(parseWorktrees(""), []);
  assert.deepEqual(parseWorktrees("\n\n\n"), []);
});

test("worktrees: a trailing blank line does not add a phantom entry", () => {
  const withExtraTail = parseWorktrees(SAMPLE + "\n");
  assert.equal(withExtraTail.length, 5);
  assert.equal(withExtraTail[4].path, "E:/repo-wt/stale");
});

test("worktrees: an unknown key is ignored rather than breaking the record", () => {
  const list = parseWorktrees(
    ["worktree E:/repo", "HEAD abc", "branch refs/heads/main", "future-key ignored here", ""].join(
      "\n",
    ),
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].branch, "main");
});
