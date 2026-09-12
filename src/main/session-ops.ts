/**
 * Mutating operations on pi session files: rename, delete, archive, restore.
 *
 * Session storage facts (verified against the pi CLI, not assumed):
 *   - sessions live in `~/.pi/agent/sessions/<cwd-slug>/<id>.jsonl`;
 *   - a display name is a `session_info` entry appended to the file, and the
 *     newest one wins (`SessionEntryBase` = type/id/parentId/timestamp);
 *   - pi lists sessions one directory deep, so moving a file into
 *     `sessions/_archived/<cwd-slug>/` hides it from the CLI as well.
 */
import { appendFile, mkdir, readFile, rename, stat, unlink, readdir, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { log, errText } from "./log";

export const ARCHIVE_DIR = "_archived";

/** True when `p` is an absolute .jsonl path inside `sessionsDir`. */
export function isSessionFile(p: string, sessionsDir: string): boolean {
  if (!p || !isAbsolute(p) || p.startsWith("\\\\") || p.startsWith("//")) return false;
  if (!p.toLowerCase().endsWith(".jsonl")) return false;
  const rel = relative(sessionsDir, p);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** True when the path points into the archive tree (hidden from the list). */
export function isArchivedPath(p: string, sessionsDir: string): boolean {
  const rel = relative(sessionsDir, p);
  return rel.split(sep)[0] === ARCHIVE_DIR;
}

/** Last non-empty line of a file, without loading multi-MB sessions. */
async function lastLine(path: string): Promise<string> {
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch {
    return "";
  }
  const chunk = Math.min(size, 256 * 1024);
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(chunk);
    const { bytesRead } = await handle.read(buf, 0, chunk, Math.max(0, size - chunk));
    const text = buf.subarray(0, bytesRead).toString("utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    return lines.length ? lines[lines.length - 1] : "";
  } finally {
    await handle.close().catch(() => undefined);
  }
}

interface EntryId {
  id: string | null;
}

async function lastEntryId(path: string): Promise<string | null> {
  const line = await lastLine(path);
  if (!line) return null;
  try {
    const obj: EntryId = JSON.parse(line) as EntryId;
    return typeof obj.id === "string" ? obj.id : null;
  } catch {
    return null;
  }
}

/**
 * Rename a session by appending a `session_info` entry — the same thing the
 * `/name` command does, so pi and the CLI pick the new name up too.
 */
export async function renameSession(
  file: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const clean = name
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120);
  if (!clean) return { ok: false, error: "名称不能为空" };
  try {
    const parentId = await lastEntryId(file);
    const entry = {
      type: "session_info",
      id: randomUUID(),
      parentId,
      timestamp: new Date().toISOString(),
      name: clean,
    };
    const raw = await readFile(file, "utf8").catch(() => "");
    // A file that does not end in a newline would glue the entry onto the last one.
    const prefix = raw.length > 0 && !raw.endsWith("\n") ? "\n" : "";
    await appendFile(file, `${prefix}${JSON.stringify(entry)}\n`, "utf8");
    return { ok: true };
  } catch (e) {
    log.warn("renameSession:", errText(e));
    return { ok: false, error: errText(e) };
  }
}

export async function deleteSession(file: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await unlink(file);
    return { ok: true };
  } catch (e) {
    log.warn("deleteSession:", errText(e));
    // A raw "ENOENT: ... unlink 'C:\\...'" tells the user nothing: the common
    // cause is a stale path (the session was archived, restored or removed
    // elsewhere), so say that instead.
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { ok: false, error: "会话文件不存在，可能已被移动或删除" };
    if (code === "EBUSY" || code === "EPERM")
      return { ok: false, error: "会话文件被占用，请先切换到其它会话再删除" };
    return { ok: false, error: errText(e) };
  }
}

/**
 * Move a session (plus nothing else — messages live in the same file) into the
 * archive tree, mirroring its cwd directory so names stay unique.
 */
export async function archiveSession(
  file: string,
  sessionsDir: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const rel = relative(sessionsDir, file);
    const dest = join(sessionsDir, ARCHIVE_DIR, rel);
    await mkdir(dirname(dest), { recursive: true });
    await rename(file, dest);
    return { ok: true, path: dest };
  } catch (e) {
    log.warn("archiveSession:", errText(e));
    return { ok: false, error: errText(e) };
  }
}

/** Move an archived session back next to its siblings (reverse of archive). */
export async function restoreSession(
  file: string,
  sessionsDir: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const rel = relative(join(sessionsDir, ARCHIVE_DIR), file);
    if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, error: "不在归档目录中" };
    const dest = join(sessionsDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await rename(file, dest);
    return { ok: true, path: dest };
  } catch (e) {
    log.warn("restoreSession:", errText(e));
    return { ok: false, error: errText(e) };
  }
}

/** Archived session files, newest first (bounded walk). */
export async function listArchived(sessionsDir: string, limit = 200): Promise<string[]> {
  const root = join(sessionsDir, ARCHIVE_DIR);
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4 || out.length >= limit) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, depth + 1);
      else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(full);
    }
  }
  await walk(root, 0);
  return out;
}

export function sessionTitleFromPath(file: string): string {
  return basename(file).replace(/\.jsonl$/, "");
}
