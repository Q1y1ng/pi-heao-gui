/**
 * Git support, ported from upstream `src/gitCommit/*`:
 *   - `truncateDiffByFile` is a direct port (a plain head-cut used to drop every
 *     file after the first large one);
 *   - the commit-message prompts are upstream's defaults verbatim, including the
 *     commit-language instruction;
 *   - generation runs pi as a separate one-shot process, exactly like upstream
 *     used a resource-loader-isolated session, so the chat session is untouched.
 */
import { runPiCli } from "./pi-cli";
import { log, errText } from "./log";
import { basename, dirname, join } from "node:path";

/** Upstream's default system prompt (conventional commits). */
export const DEFAULT_COMMIT_SYSTEM_PROMPT =
  "You are a helpful assistant that generates informative git commit messages based on git diffs output. Skip preamble and remove all backticks surrounding the commit message. Based on the provided git diff, generate a conventional format commit message.\n\n```\n<type>[optional scope]: <description>\n\n[optional body list]\n```";

export const DEFAULT_COMMIT_USER_PROMPT =
  "Notes from developer (ignore if not relevant): {{USER_CURRENT_INPUT}}";

const TRUNCATED_DIFF_SIZE = 64 * 1024;
export const FILE_TRUNCATED_MARK = "\n[... file diff truncated ...]";

/**
 * Split a diff by `diff --git` headers and truncate each file's chunk so the
 * total stays within `maxSize`, keeping every file represented.
 */
export function truncateDiffByFile(diff: string, maxSize: number): string {
  if (diff.length <= maxSize) return diff;

  const firstHeader = diff.indexOf("diff --git ");
  const preamble = firstHeader > 0 ? diff.slice(0, firstHeader) : "";
  const body = firstHeader >= 0 ? diff.slice(firstHeader) : diff;

  const indices: number[] = [];
  const headerRegex = /^diff --git .*$/gm;
  let m: RegExpExecArray | null = headerRegex.exec(body);
  while (m !== null) {
    indices.push(m.index);
    m = headerRegex.exec(body);
  }
  if (indices.length === 0) return diff.slice(0, maxSize);

  const chunks: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : body.length;
    chunks.push(body.slice(start, end));
  }

  const budget = Math.max(1000, maxSize - preamble.length);
  const perFile = Math.max(500, Math.floor(budget / chunks.length));
  const kept = chunks.map((chunk) =>
    chunk.length <= perFile
      ? chunk
      : chunk.slice(0, Math.max(0, perFile - FILE_TRUNCATED_MARK.length)) + FILE_TRUNCATED_MARK,
  );
  return preamble + kept.join("");
}

export interface CommitPromptInput {
  diff: string;
  /** Whatever the user already typed in the commit box. */
  currentInput?: string;
  language?: string;
  systemPrompt?: string;
}

/** Build the system + user prompt exactly as upstream does. */
export function buildCommitPrompt(input: CommitPromptInput): { system: string; user: string } {
  const system = input.systemPrompt?.trim() || DEFAULT_COMMIT_SYSTEM_PROMPT;
  const language = (input.language || "English").trim() || "English";
  const parts: string[] = [];
  const notes = (input.currentInput || "").trim();
  if (notes) parts.push(DEFAULT_COMMIT_USER_PROMPT.replace("{{USER_CURRENT_INPUT}}", notes));
  parts.push(truncateDiffByFile(input.diff, TRUNCATED_DIFF_SIZE));
  return {
    system: `${system}\n\nGenerate commit message in ${language}.`,
    user: parts.join("\n\n"),
  };
}

/** Strip code fences / stray backticks the model sometimes adds. */
export function cleanCommitMessage(text: string): string {
  let out = text.trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(out);
  if (fenced) out = fenced[1].trim();
  out = out.replace(/^["'`]+|["'`]+$/g, "").trim();
  return out;
}

export interface CommitMessageResult {
  ok: boolean;
  message?: string;
  error?: string;
  /** True when the diff had to be truncated before sending. */
  truncated?: boolean;
}

/**
 * Ask pi (one-shot, no session, no tools) for a commit message for `diff`.
 */
export async function generateCommitMessage(opts: {
  piPath: string;
  cwd: string;
  diff: string;
  currentInput?: string;
  language?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}): Promise<CommitMessageResult> {
  const prompt = buildCommitPrompt({
    diff: opts.diff,
    currentInput: opts.currentInput,
    language: opts.language,
    systemPrompt: opts.systemPrompt,
  });
  const args = ["-p", prompt.user, "--system-prompt", prompt.system, "--no-session", "--no-tools"];
  const res = await runPiCli(opts.piPath, args, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 180_000,
  });
  if (!res.ok) {
    log.warn("commit message generation failed:", res.error || res.stderr.slice(0, 200));
    return { ok: false, error: res.error || res.stderr.trim().slice(0, 400) || "生成失败" };
  }
  const message = cleanCommitMessage(res.stdout);
  if (!message) return { ok: false, error: "模型没有返回内容" };
  return { ok: true, message, truncated: opts.diff.length > TRUNCATED_DIFF_SIZE };
}

/** `git` runner used by the status/diff IPC handlers. */
export async function git(
  args: string[],
  cwd: string,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const res = await runPiCli("git", args, { cwd, timeoutMs });
    return { ok: res.ok, stdout: res.stdout, stderr: res.stderr };
  } catch (e) {
    return { ok: false, stdout: "", stderr: errText(e) };
  }
}

export interface WorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked?: string;
  prunable?: string;
}

/**
 * Parse `git worktree list --porcelain`: one blank-line-separated record per worktree, each a set
 * of `key [value]` lines — `worktree <path>`, then `HEAD`, `branch` or `detached`, plus `bare`,
 * `locked [reason]` and `prunable [reason]` when they apply. Order is kept as git prints it, which
 * puts the main worktree first; that is the one people expect to see at the top of the list.
 */
export function parseWorktrees(raw: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  for (const block of raw.split("\n\n")) {
    let entry: WorktreeEntry | null = null;
    for (const line of block.split("\n")) {
      const text = line.trim();
      if (!text) continue;
      const space = text.indexOf(" ");
      const key = space === -1 ? text : text.slice(0, space);
      const value = space === -1 ? "" : text.slice(space + 1);
      if (key === "worktree") {
        entry = { path: value, bare: false, detached: false };
        out.push(entry);
        continue;
      }
      if (!entry) continue;
      if (key === "HEAD") entry.head = value;
      else if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "detached") entry.detached = true;
      else if (key === "bare") entry.bare = true;
      else if (key === "locked") entry.locked = value || "locked";
      else if (key === "prunable") entry.prunable = value || "prunable";
    }
  }
  return out;
}

/** Every worktree of the repository that contains `cwd` (empty when it is not a repository). */
export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const res = await git(["worktree", "list", "--porcelain"], cwd);
  return res.ok ? parseWorktrees(res.stdout) : [];
}

/** Characters git refuses in a ref name, plus the ones that would make it a flag or a path. */
const FORBIDDEN_IN_REF = ["~", "^", ":", "?", "*", "[", "\\"];

/**
 * Whether a branch name is safe to hand to `git worktree add -b`.
 *
 * Checked rather than escaped: the name comes from a text field, git is spawned without a shell
 * (so there is no shell injection to worry about), but a name that git *interprets* — one starting
 * with `-` — would turn into a flag, and a name git rejects would leave a half-made worktree. The
 * rules are git's own (`git check-ref-format`): no spaces or control characters, none of
 * `~ ^ : ? * [ \`, no `..`, no `@{`, no leading or trailing `/` or `.`, no `//`, and no `.lock`
 * suffix. The length cap is ours: the name becomes a directory name.
 */
export function isSafeBranchName(name: string): boolean {
  const n = name.trim();
  if (!n || n.length > 80) return false;
  if (n.startsWith("-") || n.startsWith("/") || n.endsWith("/")) return false;
  if (n.startsWith(".") || n.endsWith(".") || n.endsWith(".lock")) return false;
  // Written as a list plus two small tests rather than one dense character class: the class needed
  // a backslash, a bracket and a control-character escape in the same expression, and every linter
  // reads that differently.
  if ([...n].some((ch) => FORBIDDEN_IN_REF.includes(ch) || /\s|\p{Cc}/u.test(ch))) {
    return false;
  }
  if (n.includes("..") || n.includes("@{") || n.includes("//")) return false;
  return n.split("/").every((part) => part.length > 0 && !part.startsWith("."));
}

/** The directory part of a branch name, as a file name: `feature/login` → `feature-login`. */
export function worktreeSlug(branch: string): string {
  return (
    branch
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "worktree"
  );
}

/**
 * Where a new working copy of `repoRoot` for `branch` goes: a sibling directory named after the
 * repository and the branch. A sibling rather than a subdirectory on purpose — a worktree inside the
 * repository is untracked content inside its own tree, and every `git status` would mention it.
 */
export function worktreePathFor(repoRoot: string, branch: string): string {
  return join(dirname(repoRoot), `${basename(repoRoot)}-${worktreeSlug(branch)}`);
}
