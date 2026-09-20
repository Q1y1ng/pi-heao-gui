import { dirname, isAbsolute, relative, resolve } from "node:path";
import { realpathSync } from "node:fs";

/**
 * Workspace confinement for the file panel.
 *
 * Extracted from main.ts so it can be tested without Electron: the escape it
 * guards against (a symlink or junction inside the workspace pointing out of it)
 * only shows up against a real filesystem, and on Windows a junction needs no
 * privileges to create.
 */

/** Real path of an existing file or directory, or null when it cannot be resolved. */
export function realPathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The nearest existing ancestor's real path, with the missing tail appended. */
function realPathOfNearest(target: string): string | null {
  let probe = target;
  for (;;) {
    const real = realPathOrNull(probe);
    if (real) {
      return probe === target ? real : resolve(real, relative(probe, target));
    }
    const parent = dirname(probe);
    if (parent === probe) return null; // walked past the drive root
    probe = parent;
  }
}

/**
 * Whether `target` is `root` or inside it — the *protected-path* question, asked of the
 * real location as well as the spelled one.
 *
 * Deliberately the opposite logic to `safeWorkspacePath`: that one ANDs its two checks
 * (the path must be inside the workspace textually **and** after links are followed), while
 * this one ORs them. The workspace guard is asking "may this path be touched at all?" and
 * must refuse the link that leaves; this one is asking "is this path one of the ones that
 * must never be touched?", and refusing only when both spellings agree would let a junction
 * inside the workspace deliver `~/.pi/agent/auth.json` — textually "inside the workspace",
 * which is exactly the escape this exists to stop.
 *
 * Over-blocking is the accepted cost: a path that *reads* as protected and resolves
 * elsewhere is still refused.
 */
export function isWithin(root: string, target: string): boolean {
  if (!root || !target) return false;
  const contains = (base: string, full: string): boolean => {
    const rel = relative(base, full);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  const textRoot = resolve(root);
  const textFull = resolve(target);
  if (contains(textRoot, textFull)) return true;
  const realRoot = realPathOrNull(textRoot) ?? realPathOfNearest(textRoot);
  const realFull = realPathOfNearest(textFull);
  if (!realRoot || !realFull) return false;
  return contains(realRoot, realFull);
}

/**
 * Resolve a workspace-relative path, or return null if it escapes the workspace.
 *
 * Two checks, because the first one alone is not enough:
 * 1. textual — the resolved path must stay under the root (blocks ".." and
 *    absolute paths);
 * 2. real — the resolved path, with links followed, must also stay under the
 *    real root. A file that does not exist yet is checked against its nearest
 *    existing parent directory.
 */
export function safeWorkspacePath(root: string, relPath: string): string | null {
  const raw = String(relPath || ".");
  if (isAbsolute(raw)) return null; // the panel works in relative paths only
  const full = resolve(root, raw);
  const within = relative(root, full);
  if (within.startsWith("..") || isAbsolute(within)) return null;

  const realRoot = realPathOrNull(root);
  if (!realRoot) return null; // cannot verify the root → refuse rather than guess
  let probe = full;
  for (;;) {
    const real = realPathOrNull(probe);
    if (real) {
      const rel = relative(realRoot, real);
      if (rel.startsWith("..") || isAbsolute(rel)) return null;
      break;
    }
    const parent = dirname(probe);
    if (parent === probe) return null; // walked past the drive root
    probe = parent;
  }
  return full;
}
