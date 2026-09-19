/**
 * Session list for the sidebar.
 *
 * Reading every session .jsonl in full on a timer is what made the old version
 * freeze the main process: on a real profile that is ~170 MB of synchronous
 * reads every 5 seconds. This module instead:
 *   - stats files asynchronously (bounded concurrency),
 *   - parses only the head/tail 64 KB slices that can contain a name,
 *   - caches the parsed result per (path, mtime, size) and persists it,
 * so a refresh is just N stats once the cache is warm.
 */
import { open, readdir, stat, writeFile } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { join } from "node:path";
import { log, errText } from "./log";

export interface SessionListItem {
  file: string;
  name: string;
  mtime: number;
  sessionId: string;
  /** Where pi ran. Used by the sidebar to group sessions under their project. */
  cwd: string;
  pinned: boolean;
}

interface CachedMeta {
  mtime: number;
  size: number;
  name: string;
  sessionId: string;
  cwd: string;
}

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 64 * 1024;
const MAX_DEPTH = 8;
const CONCURRENCY = 12;
const NOT_SESSION_EXT = ".jsonl";

let warned = 0;
function warn(what: string, e: unknown): void {
  if (warned++ < 5) log.warn(`sessions ${what}:`, errText(e));
}

/** Read at most `length` bytes at `start`; returns "" when the read fails. */
async function readChunk(path: string, start: number, length: number): Promise<string> {
  if (length <= 0) return "";
  try {
    const handle = await open(path, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, start);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close().catch((e: unknown) => warn(`close ${path}`, e));
    }
  } catch (e) {
    warn(`read ${path}`, e);
    return "";
  }
}

/** Split into whole lines: the chunk boundary can cut one, so drop it. */
function wholeLines(chunk: string, dropFirst: boolean, dropLast: boolean): string[] {
  const lines = chunk.split("\n");
  if (dropFirst && lines.length) lines.shift();
  if (dropLast && lines.length) lines.pop();
  return lines.filter((l) => l.length > 0);
}

interface ParsedMeta {
  name: string;
  sessionId: string;
  /** The directory pi was started in (the session header's `cwd`). */
  cwd: string;
  malformed: number;
  sawSessionInfo: boolean;
}

function parseLines(lines: string[], fromTail: boolean, acc: ParsedMeta): void {
  const indices = fromTail ? [...lines.keys()].reverse() : [...lines.keys()];
  for (const i of indices) {
    let obj: {
      type?: string;
      name?: unknown;
      id?: unknown;
      cwd?: unknown;
      message?: { role?: string; content?: unknown };
    };
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      acc.malformed++;
      continue;
    }
    if (obj.type === "session_info" && obj.name) {
      // Newest wins: the tail pass stops at the first hit scanning backwards,
      // and the head pass (sessionId backfill) must never clobber that name —
      // otherwise renaming a session appears to have no effect.
      if (!acc.name) {
        acc.name = String(obj.name);
        acc.sawSessionInfo = true;
      }
      if (obj.id && !acc.sessionId) acc.sessionId = String(obj.id);
      if (fromTail) return;
      continue;
    }
    if (obj.type === "session" && obj.id && !acc.sessionId) acc.sessionId = String(obj.id);
  }
}

/**
 * The directory pi ran in, read from the session header.
 *
 * This is the first line of the file and it is read here, not inside `parseLines`, because that pass
 * is skipped whenever the tail already supplied a session id — which is every session that has ever
 * been named. A session whose tail carries `session_info` therefore never reported a directory at
 * all, and the sidebar filed it under "other" instead of under its project.
 */
function readHeaderCwd(lines: string[]): string {
  const first = lines[0];
  if (!first) return "";
  try {
    const header: { type?: string; cwd?: unknown } = JSON.parse(first);
    if (header?.type === "session" && typeof header.cwd === "string") return header.cwd;
  } catch {
    // A malformed header means no directory for this row, not a failed list.
  }
  return "";
}

/** First user message makes a decent fallback title. */
function firstUserText(lines: string[]): string {
  for (const line of lines) {
    let obj: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj?.type !== "message" || obj.message?.role !== "user") continue;
    const content = obj.message.content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
          const t = (block as { text?: unknown }).text;
          if (typeof t === "string") {
            text = t;
            break;
          }
        }
      }
    }
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat) return flat.length > 36 ? `${flat.slice(0, 36)}…` : flat;
  }
  return "";
}

function fallbackName(fileName: string): string {
  const stamp = fileName.replace(/\.jsonl$/, "").split("_")[0];
  return (
    stamp
      .replace(/T/, " ")
      .replace(/-\d+Z$/, "")
      .slice(0, 16) || "未命名会话"
  );
}

export interface SessionLister {
  list(): Promise<SessionListItem[]>;
}

export function createSessionLister(opts: {
  sessionsDir: string;
  cachePath: string;
  pinned: () => string[];
}): SessionLister {
  const cache = new Map<string, CachedMeta>();
  let cacheLoaded = false;
  let cacheDirty = false;

  async function loadCache(): Promise<void> {
    if (cacheLoaded) return;
    cacheLoaded = true;
    const raw = await readChunk(opts.cachePath, 0, 8 * 1024 * 1024);
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [file, meta] of Object.entries(parsed as Record<string, CachedMeta>)) {
          if (meta && typeof meta.mtime === "number" && typeof meta.name === "string")
            cache.set(file, meta);
        }
      }
    } catch (e) {
      warn("session cache parse", e);
    }
  }

  async function saveCache(): Promise<void> {
    if (!cacheDirty) return;
    cacheDirty = false;
    try {
      await writeFile(opts.cachePath, JSON.stringify(Object.fromEntries(cache)), "utf8");
    } catch (e) {
      warn("session cache save", e);
    }
  }

  async function collectFiles(): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > MAX_DEPTH) return;
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (e) {
        warn(`readdir ${dir}`, e);
        return;
      }
      for (const ent of entries) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) await walk(full, depth + 1);
        else if (ent.isFile() && ent.name.endsWith(NOT_SESSION_EXT)) out.push(full);
      }
    }
    await walk(opts.sessionsDir, 0);
    return out;
  }

  async function metaFor(file: string): Promise<SessionListItem | null> {
    let st: Stats;
    try {
      st = await stat(file);
    } catch {
      return null; // raced with a delete — just skip
    }
    const cached = cache.get(file);
    if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) {
      return {
        file,
        name: cached.name,
        mtime: st.mtimeMs,
        sessionId: cached.sessionId,
        cwd: cached.cwd,
        pinned: false,
      };
    }

    const size = st.size;
    const headText = await readChunk(file, 0, Math.min(HEAD_BYTES, size));
    const tailStart = Math.max(0, size - TAIL_BYTES);
    const tailText = tailStart > 0 ? await readChunk(file, tailStart, TAIL_BYTES) : headText;

    const acc: ParsedMeta = {
      name: "",
      sessionId: "",
      cwd: "",
      malformed: 0,
      sawSessionInfo: false,
    };
    const headLines = wholeLines(headText, false, size > HEAD_BYTES);
    const tailLines = wholeLines(tailText, tailStart > 0, false);
    acc.cwd = readHeaderCwd(headLines);
    parseLines(tailLines, true, acc);
    if (!acc.sessionId) parseLines(headLines, false, acc);

    let name = acc.name;
    if (!name && !acc.sawSessionInfo) name = firstUserText(headLines);
    if (!name) name = fallbackName(file.split(/[\\/]/).pop() || file);

    cache.set(file, {
      mtime: st.mtimeMs,
      size,
      name,
      sessionId: acc.sessionId,
      cwd: acc.cwd,
    });
    cacheDirty = true;
    return {
      file,
      name,
      mtime: st.mtimeMs,
      sessionId: acc.sessionId,
      cwd: acc.cwd,
      pinned: false,
    };
  }

  return {
    async list(): Promise<SessionListItem[]> {
      await loadCache();
      const files = await collectFiles();
      const pinnedSet = new Set(opts.pinned());
      const items: SessionListItem[] = [];

      let cursor = 0;
      async function worker(): Promise<void> {
        for (;;) {
          const file = files.at(cursor);
          if (file === undefined) return; // queue drained
          cursor += 1;
          const item = await metaFor(file);
          if (item) items.push(item);
        }
      }
      const workerCount = Math.min(CONCURRENCY, files.length);
      const workers: Array<Promise<void>> = [];
      for (let i = 0; i < workerCount; i++) workers.push(worker());
      await Promise.all(workers);

      // drop cache entries for files that disappeared
      if (cache.size > files.length) {
        const fileSet = new Set(files);
        const staleKeys: string[] = [];
        for (const key of cache.keys()) {
          if (!fileSet.has(key)) staleKeys.push(key);
        }
        for (const key of staleKeys) {
          cache.delete(key);
          cacheDirty = true;
        }
      }
      void saveCache();

      for (const item of items) item.pinned = pinnedSet.has(item.file);
      items.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.mtime - a.mtime;
      });
      return items;
    },
  };
}
