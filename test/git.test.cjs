/**
 * Git helpers used by the dock's "变更" tab. `truncateDiffByFile` and the prompt
 * builders are ports of upstream `src/gitCommit/*`, so the expectations here
 * mirror upstream behaviour (per-file truncation, conventional-commit prompt,
 * commit-language instruction).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  truncateDiffByFile,
  buildCommitPrompt,
  cleanCommitMessage,
  DEFAULT_COMMIT_SYSTEM_PROMPT,
  FILE_TRUNCATED_MARK,
} = require("../dist/main/git.js");

const fileDiff = (name, lines) =>
  `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${"+".repeat(lines)}\n`;

test("short diffs pass through untouched", () => {
  const diff = fileDiff("a.ts", 5);
  assert.equal(truncateDiffByFile(diff, 64 * 1024), diff);
});

test("every file survives a truncation, not just the first", () => {
  const big = fileDiff("big.ts", 5000) + fileDiff("small.ts", 10) + fileDiff("last.ts", 20);
  const out = truncateDiffByFile(big, 4000);
  assert.ok(out.length <= big.length);
  for (const name of ["big.ts", "small.ts", "last.ts"]) {
    assert.ok(out.includes(`diff --git a/${name}`), `${name} must still be represented`);
  }
  assert.ok(out.includes(FILE_TRUNCATED_MARK), "a truncated file carries the marker");
});

test("preamble before the first diff header is preserved", () => {
  const diff = `'git diff --cached' Output:\n${fileDiff("x.ts", 4000)}${fileDiff("y.ts", 4000)}`;
  const out = truncateDiffByFile(diff, 2000);
  assert.ok(out.startsWith("'git diff --cached' Output:"));
});

test("unrecognised input falls back to a plain head cut", () => {
  const junk = "no diff headers here ".repeat(500);
  const out = truncateDiffByFile(junk, 100);
  assert.equal(out.length, 100);
});

test("commit prompt mirrors upstream: optional notes plus diff", () => {
  const diff = fileDiff("a.ts", 3);
  const { system, user } = buildCommitPrompt({ diff });
  assert.equal(system, `${DEFAULT_COMMIT_SYSTEM_PROMPT}\n\nGenerate commit message in English.`);
  assert.equal(user, diff);
});

test("developer notes are only included when supplied", () => {
  const diff = fileDiff("a.ts", 3);
  const withNotes = buildCommitPrompt({
    diff,
    currentInput: "  fix the parser  ",
    language: "简体中文",
  });
  assert.match(withNotes.user, /Notes from developer \(ignore if not relevant\): fix the parser/);
  assert.ok(withNotes.user.endsWith(diff));
  assert.match(withNotes.system, /生成|Generate commit message in 简体中文/);
});

test("a custom system prompt replaces the default", () => {
  const { system } = buildCommitPrompt({ diff: "x", systemPrompt: "my own rules" });
  assert.ok(system.startsWith("my own rules"));
  assert.equal(system.includes(DEFAULT_COMMIT_SYSTEM_PROMPT), false);
});

test("model output is cleaned of fences and quotes", () => {
  assert.equal(cleanCommitMessage("```\nfeat: add thing\n```"), "feat: add thing");
  assert.equal(cleanCommitMessage('"fix: quote"'), "fix: quote");
  assert.equal(cleanCommitMessage("  \n feat: x \n "), "feat: x");
  assert.equal(cleanCommitMessage(""), "");
});

// ─── "new working copy": the names git will be handed ─────────────────────────

test("a branch name git would accept is accepted", () => {
  const { isSafeBranchName } = require("../dist/main/git.js");
  for (const name of ["feature/login", "wt-20260919", "fix/npm-race", "a", "release/1.2.x"]) {
    assert.equal(isSafeBranchName(name), true, name);
  }
});

test("a branch name that would become a flag or a path is refused", () => {
  const { isSafeBranchName } = require("../dist/main/git.js");
  const bad = [
    "",
    "   ",
    "-b",
    "--force",
    "has space",
    "two words",
    "a..b",
    "a@{b}",
    "a//b",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b]",
    "a\b",
    ".hidden",
    "trailing.",
    "trailing/",
    "/leading",
    "nested/.hidden",
    "branch.lock",
    "tab\there",
    "x".repeat(81),
  ];
  for (const name of bad) assert.equal(isSafeBranchName(name), false, JSON.stringify(name));
});

test("a branch becomes a directory name", () => {
  const { worktreeSlug } = require("../dist/main/git.js");
  assert.equal(worktreeSlug("feature/login"), "feature-login");
  assert.equal(worktreeSlug("Fix/Ünicode Name"), "fix-nicode-name");
  assert.equal(worktreeSlug("///"), "worktree", "never an empty directory name");
  assert.equal(worktreeSlug("x".repeat(200)).length <= 60, true);
});

test("a new working copy goes beside the repository, named after both", () => {
  const { worktreePathFor } = require("../dist/main/git.js");
  const path = require("node:path");
  assert.equal(
    worktreePathFor(path.join("C:", "repos", "app"), "feature/login"),
    path.join("C:", "repos", "app-feature-login"),
  );
  // A sibling, never a subdirectory: a worktree inside the repository would be untracked content
  // inside its own tree, and every `git status` would mention it.
  assert.equal(
    worktreePathFor(path.join("C:", "repos", "app"), "wt").startsWith(
      path.join("C:", "repos", "app") + path.sep,
    ),
    false,
  );
});
