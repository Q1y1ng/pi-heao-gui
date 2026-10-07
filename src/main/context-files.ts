/**
 * Context (memory) file discovery — pi's own rule, mirrored exactly.
 *
 * pi loads "context files" silently at startup and stitches them into the system prompt
 * (global `~/.pi/agent/AGENTS.md` + the first present candidate in every directory from
 * the cwd up to the filesystem root). RPC does not report which files were loaded, so the
 * panel has to walk the tree itself — and it must walk it with pi's exact rule, or it
 * would show a file pi does not actually load (or hide one it does).
 *
 * The rule comes from pi-coding-agent's `resource-loader.js` (verified against the bundle,
 * 2026-10-07):
 *
 *   - `loadContextFileFromDir(dir)`: candidates in order
 *     `AGENTS.override.md → AGENTS.md → AGENTS.MD → CLAUDE.md → CLAUDE.MD`,
 *     first one that exists *and is a file* wins — at most ONE file per directory.
 *   - `loadProjectContextFiles({cwd, agentDir})`: global file from `agentDir` first,
 *     then the same per-directory pick from `cwd` upward, ordered root-first.
 *   - `findShadowedContextFile(cwd)`: when the cwd is inside a linked git worktree, the
 *     worktree root's context file shadows the same-named file in the main repo root —
 *     the main-root file is excluded from the result.
 *
 * The fs operations are injectable so the whole rule set is unit-testable without touching
 * disk (same spirit as `file-kind.ts`: pure logic, no hidden I/O in tests).
 */
import { basename, dirname, join, resolve as resolvePath, sep } from "node:path";
import { existsSync, statSync } from "node:fs";

/** pi's candidate list, in priority order — the first existing *file* per directory wins. */
export const CONTEXT_CANDIDATES = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
] as const;

export interface ContextFile {
  /** Absolute path of the file pi would load. */
  path: string;
  /** Basename as loaded (`AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`, …). */
  name: string;
  /** `global` = from the agent dir (`~/.pi/agent`), `project` = from the cwd chain. */
  level: "global" | "project";
  /** Directory containing the file (display helper for the panel). */
  dir: string;
}

/** The two fs predicates discovery needs, injectable for tests. */
export interface FsLike {
  exists(p: string): boolean;
  isFile(p: string): boolean;
}

export const realFs: FsLike = {
  exists: (p) => existsSync(p),
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
};

/**
 * pi compares paths through `canonicalizePath` (dedupe and shadow checks both go through
 * it). Case-folding on Windows matches what the FS itself does; everything else is a plain
 * resolve so `.`/`..`/different separators don't produce phantom duplicates.
 */
export function canonicalPath(p: string): string {
  const r = resolvePath(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/** The per-directory pick: first existing *file* among the candidates, or null. */
export function pickContextFile(dir: string, fs: FsLike = realFs): string | null {
  for (const name of CONTEXT_CANDIDATES) {
    const p = join(dir, name);
    if (fs.exists(p) && fs.isFile(p)) return p;
  }
  return null;
}

/** Where the git plumbing numbers come from (`git rev-parse` in main.ts). */
export interface GitShape {
  /** `git rev-parse --show-toplevel` of the cwd. */
  repoDir: string;
  /** `git rev-parse --git-common-dir`, resolved to an absolute path. */
  commonGitDir: string;
}

/**
 * pi's `findShadowedContextFile`: when cwd sits inside a linked git worktree, the file the
 * worktree root contributes shadows the same-named file in the main repo root — pi skips
 * the main-root copy, so the panel must too. Returns the canonical path of the shadowed
 * main-root file, or null when cwd is not in such a worktree (the ordinary single-repo
 * case falls out of the same arithmetic: `repoDir === mainRepoRoot` fails the prefix test).
 *
 * `pick` is the per-directory pick, passed in so the check can run on the same fake fs as
 * the tests.
 */
export function shadowedContextPath(
  cwd: string,
  gitInfo: GitShape | null,
  pick: (dir: string) => string | null,
): string | null {
  if (!gitInfo) return null;
  const commonGitDir = canonicalPath(gitInfo.commonGitDir);
  const worktreeRoot = canonicalPath(gitInfo.repoDir);
  const mainRepoRoot = dirname(commonGitDir);
  if (!worktreeRoot.startsWith(mainRepoRoot + sep.toLowerCase())) return null;
  if (canonicalPath(join(mainRepoRoot, ".git")) !== commonGitDir) return null;
  const worktreeContextFile = pick(gitInfo.repoDir);
  return worktreeContextFile
    ? canonicalPath(join(mainRepoRoot, basename(worktreeContextFile)))
    : null;
}

/**
 * The full discovery: `[global, root-first…cwd-last]`, exactly pi's order, exactly pi's
 * per-directory rule, minus nothing (the shadowed main-root file is excluded, never shown).
 * A path already contributed by the agent dir is not repeated if the cwd chain reaches it
 * (agent dir inside the workspace is a real edge case with `--agent-dir` overrides).
 */
export function discoverContextFiles(opts: {
  cwd: string;
  agentDir: string;
  fs?: FsLike;
  gitInfo?: GitShape | null;
}): ContextFile[] {
  const fs = opts.fs ?? realFs;
  const pick = (dir: string) => pickContextFile(dir, fs);
  const files: ContextFile[] = [];
  const seen = new Set<string>();

  const globalPath = pick(resolvePath(opts.agentDir));
  if (globalPath) {
    files.push({ path: globalPath, name: basename(globalPath), level: "global", dir: dirname(globalPath) });
    seen.add(canonicalPath(globalPath));
  }

  const shadowed = shadowedContextPath(opts.cwd, opts.gitInfo ?? null, pick);
  const chain: string[] = [];
  let dir = resolvePath(opts.cwd);
  for (;;) {
    const f = pick(dir);
    const canon = f ? canonicalPath(f) : "";
    if (f && canon !== shadowed && !seen.has(canon)) {
      chain.unshift(f);
      seen.add(canon);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const p of chain) {
    files.push({ path: p, name: basename(p), level: "project", dir: dirname(p) });
  }
  return files;
}
