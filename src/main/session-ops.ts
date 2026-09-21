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
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  readdir,
  open,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
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

// ─── Importing a session from somewhere else ──────────────────────────────
//
// pi's session files are self-contained JSONL, so importing one is a copy plus two questions: is it
// really a session file (the sidebar must not end up listing junk), and does the working directory it
// was recorded in exist on this machine (a file from another computer names a directory this one does
// not have — and pi resumes a session in its header's `cwd`).

export interface SessionFileCheck {
  ok: boolean;
  /** Why it is not a session file, when it is not. */
  reason?: string;
  /** The working directory the session was recorded in, when it carries one. */
  cwd?: string;
  sessionId?: string;
}

/**
 * Is this the text of a pi session file?
 *
 * The first line is pi's header — `{"type":"session","version":3,"id":"…","timestamp":"…","cwd":"…"}`
 * — so that is what is checked, and the rest of the file is left alone (it is the conversation, and
 * nothing here needs to understand it).
 */
export function checkSessionFile(text: string): SessionFileCheck {
  const first = text.split("\n").find((line) => line.trim() !== "") ?? "";
  if (!first.trim()) return { ok: false, reason: "文件是空的" };
  let header: unknown;
  try {
    header = JSON.parse(first);
  } catch {
    return { ok: false, reason: "第一行不是 JSON —— 看起来不是 pi 的会话文件" };
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    return { ok: false, reason: "第一行不是会话头（是个数组或值）" };
  }
  const h = header as Record<string, unknown>;
  const id = typeof h.id === "string" ? h.id : "";
  const cwd = typeof h.cwd === "string" ? h.cwd : "";
  const stamped =
    typeof h.timestamp === "string" || typeof h.timestamp === "number" ? h.timestamp : "";
  if (!id && !stamped) {
    return { ok: false, reason: "会话头里既没有 id 也没有时间戳" };
  }
  return { ok: true, cwd, sessionId: id };
}

/**
 * pi's own directory name for a working directory (`E:\AI\repo` → `--E--AI-repo--`): every separator
 * becomes a dash and the whole thing is wrapped in two more. Verified against a real profile's
 * directory, not assumed — but it only decides where the file sits: the app lists sessions by walking
 * the tree, and pi resumes by the full path it is handed.
 */
export function sessionSlug(cwd: string): string {
  return `--${cwd.replace(/[:\u005c/]/g, "-")}--`;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  /** Where the imported session landed. */
  file?: string;
  /** The working directory it will resume in here. */
  cwd?: string;
  /** True when the recorded directory did not exist and the current workspace was used instead. */
  cwdRewritten?: boolean;
}

/** How much of a session file this will read; a session is text, and a real one is a few MB. */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** Copy a session file into this profile's session store. */
export async function importSession(opts: {
  from: string;
  sessionsDir: string;
  /** Where to point a session whose own working directory does not exist on this machine. */
  fallbackCwd: string;
  /** Overridable so a test does not have to write 64 MB to prove the ceiling exists. */
  maxBytes?: number;
}): Promise<ImportResult> {
  const maxBytes = opts.maxBytes ?? MAX_IMPORT_BYTES;
  // The path arrives from the renderer (`pi:import-session` takes it without a dialog, so the e2e
  // can drive the same code), and the read below used to be unbounded: any file on the machine
  // was read whole into the main process. The size is checked before the read, not after.
  let text: string;
  try {
    const info = await stat(opts.from);
    if (!info.isFile()) return { ok: false, error: "不是一个文件" };
    if (info.size > maxBytes) {
      return { ok: false, error: `文件太大（上限 ${Math.round(maxBytes / 1024 / 1024)} MB）` };
    }
    text = await readFile(opts.from, "utf8");
  } catch (e) {
    return { ok: false, error: `读不了这个文件：${errText(e)}` };
  }
  const check = checkSessionFile(text);
  if (!check.ok) return { ok: false, error: check.reason || "不是 pi 的会话文件" };

  const recorded = check.cwd || "";
  let cwd = recorded;
  let cwdRewritten = false;
  if (!cwd || !existsSync(cwd)) {
    cwd = opts.fallbackCwd;
    cwdRewritten = true;
  }
  const lines = text.split("\n");
  if (cwdRewritten) {
    // Only the header is touched: everything after it is the conversation, verbatim.
    try {
      const header = JSON.parse(lines[0]) as Record<string, unknown>;
      header.cwd = cwd;
      lines[0] = JSON.stringify(header);
    } catch {
      /* checkSessionFile already proved this line parses */
    }
  }

  const dir = join(opts.sessionsDir, sessionSlug(cwd));
  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    return { ok: false, error: `建不了会话目录：${errText(e)}` };
  }
  // Never overwrite what is already here: the same session exported from another profile has the
  // same file name, and overwriting would destroy this machine's copy of it.
  const base = basename(opts.from);
  let target = join(dir, base);
  for (let n = 2; existsSync(target) && n < 100; n++) {
    target = join(dir, base.replace(/\.jsonl$/i, `-${n}.jsonl`));
  }
  if (existsSync(target)) return { ok: false, error: "同名文件太多了，换个名字再导入" };
  try {
    await writeFile(target, lines.join("\n"), "utf8");
  } catch (e) {
    return { ok: false, error: `写不了会话文件：${errText(e)}` };
  }
  log.info(`imported session ${opts.from} -> ${target}${cwdRewritten ? " (cwd rewritten)" : ""}`);
  return { ok: true, file: target, cwd, cwdRewritten };
}
