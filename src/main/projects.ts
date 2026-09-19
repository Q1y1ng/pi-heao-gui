/**
 * Saved projects: a directory, plus the name to call it.
 *
 * A project is deliberately *not* a container. A window still has exactly one working directory, and
 * everything that follows it — the session, the terminal, the git pane, the file tree — keeps
 * following it. What was missing was the short list: which directories are worth keeping, what to
 * call them, and in what order. That is this module, and nothing else reads or writes it.
 *
 * Two decisions are worth stating because they are the ones a person will notice:
 *
 *   - **Comparison is by normalised path, never by string equality.** Windows hands out the same
 *     directory as `E:\AI\repo`, `e:/ai/repo` and `E:\AI\repo\`; all three are one project. Storage
 *     keeps the user's spelling; `projectKey` is only for comparing.
 *   - **A session that ran in a subdirectory belongs to the project.** The session header records the
 *     directory pi was started in, which is often a package folder inside the repository. Matching
 *     longest-prefix first (exact match wins) means those sessions group under the project instead of
 *     under "other", and a nested project still wins over its parent.
 */
import { basename, isAbsolute, normalize, sep } from "node:path";
import type { Project } from "../shared/types";

/**
 * The comparison key: normalised, no trailing separator, case-folded on Windows.
 *
 * Kept separate from `Project.path` on purpose — the display and the directory opener both want the
 * spelling the user chose, and only comparisons want the folded one.
 */
export function projectKey(path: string): string {
  let p = String(path || "").trim();
  if (!p) return "";
  p = normalize(p);
  while (p.length > 1 && (p.endsWith(sep) || p.endsWith("/"))) p = p.slice(0, -1);
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/** What to call a project that has not been renamed: its directory name. */
export function projectNameFor(path: string): string {
  const trimmed = String(path || "").trim();
  if (!trimmed) return "";
  const base = basename(normalize(trimmed));
  // A drive root has no basename ("E:\" → ""), and an empty label is worse than the raw path.
  return base || normalize(trimmed);
}

export interface ProjectStore {
  list(): Project[];
  /** The saved project for a directory, or null. Exact match first, then the longest prefix. */
  forPath(cwd: string): Project | null;
  /**
   * Save a directory. An already-saved path is updated in place (name kept unless given) rather than
   * appended — the whole point of the store is that "add twice" is not two rows.
   */
  add(path: string, name?: string): { project: Project; added: boolean };
  remove(path: string): boolean;
  rename(path: string, name: string): Project | null;
  /** Record that this project was switched to (recency, for the switcher's order). */
  touch(path: string): void;
  onChange(fn: () => void): () => void;
}

export function createProjectStore(opts: {
  load: () => Project[];
  save: (list: Project[]) => void;
  now?: () => number;
}): ProjectStore {
  const now = opts.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  let cache: Project[] | null = null;

  const read = (): Project[] => {
    if (!cache) cache = opts.load();
    return cache;
  };
  const write = (list: Project[]): void => {
    cache = list;
    opts.save(list);
    for (const fn of listeners) fn();
  };

  const indexOf = (path: string): number => {
    const key = projectKey(path);
    return read().findIndex((p) => projectKey(p.path) === key);
  };

  return {
    list: () => read().slice(),

    forPath(cwd) {
      const key = projectKey(cwd);
      if (!key) return null;
      let best: Project | null = null;
      let bestLength = -1;
      for (const project of read()) {
        const pk = projectKey(project.path);
        if (!pk) continue;
        const exact = pk === key;
        const inside = key.startsWith(pk.endsWith(sep) ? pk : pk + sep);
        if (!exact && !inside) continue;
        if (pk.length > bestLength) {
          best = project;
          bestLength = pk.length;
        }
      }
      return best;
    },

    add(path, name) {
      const trimmed = String(path || "").trim();
      if (!trimmed || !isAbsolute(trimmed)) {
        throw new Error("项目路径必须是绝对路径");
      }
      const at = indexOf(trimmed);
      const stamp = now();
      if (at >= 0) {
        const existing = read()[at];
        const next = { ...existing, name: name?.trim() || existing.name, lastUsedAt: stamp };
        const list = read().slice();
        list[at] = next;
        write(list);
        return { project: next, added: false };
      }
      const project: Project = {
        path: normalize(trimmed),
        name: name?.trim() || projectNameFor(trimmed),
        addedAt: stamp,
        lastUsedAt: stamp,
      };
      write([...read(), project]);
      return { project, added: true };
    },

    remove(path) {
      const at = indexOf(path);
      if (at < 0) return false;
      const list = read().slice();
      list.splice(at, 1);
      write(list);
      return true;
    },

    rename(path, name) {
      const at = indexOf(path);
      if (at < 0) return null;
      const trimmed = String(name || "").trim();
      const next: Project = { ...read()[at], name: trimmed || projectNameFor(path) };
      const list = read().slice();
      list[at] = next;
      write(list);
      return next;
    },

    touch(path) {
      const at = indexOf(path);
      if (at < 0) return;
      const list = read().slice();
      list[at] = { ...list[at], lastUsedAt: now() };
      write(list);
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
