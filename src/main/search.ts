/**
 * Full-text search across pi session files.
 *
 * Sessions are newline-delimited JSON, one file per session, and can be several
 * MB — so this streams line by line instead of reading files whole, stops as
 * soon as the hit limit is reached, and reports progress to the caller so the
 * UI can show something while a large history is being scanned.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { log, errText } from "./log";

export interface SearchHit {
  file: string;
  /** Name of the session, resolved by the caller from its own cache. */
  sessionName: string;
  role: "user" | "assistant" | "thinking" | "tool";
  /** Text around the match, whitespace collapsed. */
  snippet: string;
  /** Offset of the match inside `snippet`. */
  matchStart: number;
  matchLength: number;
  /** 1-based line number inside the session file. */
  lineNo: number;
  /** Entry timestamp when the session recorded one. */
  at: number | null;
}

export interface SearchProgress {
  scanned: number;
  total: number;
  hits: number;
}

interface TextBlock {
  type?: string;
  text?: string;
}

/** Pull searchable text + a role label out of one session entry. */
function textOf(entry: unknown): { role: SearchHit["role"]; text: string } | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { type?: string; message?: { role?: string; content?: unknown } };
  if (e.type !== "message" || !e.message) return null;
  const role = e.message.role === "user" ? "user" : "assistant";
  const content = e.message.content;
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as TextBlock;
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (b.type === "thinking" && typeof b.text === "string") parts.push(b.text);
      else if (b.type === "tool_result") {
        const inner = (block as { content?: unknown }).content;
        if (typeof inner === "string") parts.push(inner);
      }
    }
    text = parts.join("\n");
  }
  if (!text.trim()) return null;
  return { role, text };
}

function snippetAround(
  text: string,
  index: number,
  len: number,
  width = 70,
): { snippet: string; matchStart: number } {
  const start = Math.max(0, index - width);
  const end = Math.min(text.length, index + len + width);
  const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
  // recompute the match offset inside the collapsed snippet
  const before = text.slice(start, index).replace(/\s+/g, " ").trimStart();
  return { snippet: raw, matchStart: Math.max(0, before.length) };
}

async function searchFile(
  file: string,
  sessionName: string,
  needle: string,
  perFile: number,
): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNo = 0;
  try {
    for await (const line of rl) {
      lineNo++;
      if (hits.length >= perFile) break;
      if (line.length < needle.length || !line.toLowerCase().includes(needle)) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const parsed = textOf(entry);
      if (!parsed) continue;
      const hay = parsed.text.toLowerCase();
      const idx = hay.indexOf(needle);
      if (idx < 0) continue;
      const { snippet, matchStart } = snippetAround(parsed.text, idx, needle.length);
      const timestamp = (entry as { timestamp?: unknown }).timestamp;
      hits.push({
        file,
        sessionName,
        role: parsed.role,
        snippet,
        matchStart,
        matchLength: needle.length,
        lineNo,
        at: typeof timestamp === "string" ? Date.parse(timestamp) || null : null,
      });
    }
  } catch (e) {
    log.warn(`search ${file}:`, errText(e));
  } finally {
    rl.close();
    stream.destroy();
  }
  return hits;
}

export interface SearchOptions {
  /** Session files, already ordered newest-first by the caller. */
  files: string[];
  /** Resolves a file to its display name (from the caller's session cache). */
  nameOf: (file: string) => string;
  query: string;
  /** Total hits to return across all files. */
  limit?: number;
  /** Hits per session file. */
  perFile?: number;
  /** Called after every file so the UI can show progress. */
  onProgress?: (p: SearchProgress) => void;
  /** Stops the walk (newer query typed). */
  shouldStop?: () => boolean;
}

export async function searchSessions(opts: SearchOptions): Promise<SearchHit[]> {
  const needle = opts.query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const limit = opts.limit ?? 80;
  const perFile = opts.perFile ?? 4;
  const hits: SearchHit[] = [];
  let scanned = 0;

  for (const file of opts.files) {
    if (hits.length >= limit) break;
    if (opts.shouldStop?.()) break;
    const name = opts.nameOf(file);
    const found = await searchFile(file, name, needle, perFile);
    hits.push(...found);
    scanned++;
    opts.onProgress?.({ scanned, total: opts.files.length, hits: hits.length });
  }

  return hits.slice(0, limit).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** Session files ordered by modification time, newest first. */
export async function orderByRecency(files: string[]): Promise<string[]> {
  const withTime: Array<{ file: string; mtime: number }> = [];
  for (const file of files) {
    try {
      const st = await stat(file);
      withTime.push({ file, mtime: st.mtimeMs });
    } catch {
      // deleted meanwhile — skip
    }
  }
  return withTime.sort((a, b) => b.mtime - a.mtime).map((w) => w.file);
}
