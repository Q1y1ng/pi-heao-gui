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
