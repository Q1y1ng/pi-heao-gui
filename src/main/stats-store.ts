/**
 * Persistence for per-session telemetry (turns, first-token latency history,
 * per-day spend). One JSON file in userData, written lazily and bounded, so a
 * long-lived profile cannot grow it without limit.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { log, errText } from "./log";
import type { DayUsage, TurnStats } from "./stats";

/** Exactly the shape StatsCollector.toJSON() produces. */
export interface StoredSessionStats {
  turns: TurnStats[];
  byDay: Record<string, DayUsage>;
  turnCounter: number;
}

interface StoreFile {
  version: 1;
  sessions: Record<string, StoredSessionStats>;
}

export interface StatsStore {
  /** Read the file once at startup; later `load` calls are synchronous. */
  prime(): Promise<void>;
  /** Stored telemetry for a session file, or undefined when never recorded. */
  load(sessionFile: string): StoredSessionStats | undefined;
  /** Remember telemetry for a session file (debounced write). */
  save(sessionFile: string | undefined, data: StoredSessionStats): void;
  /** Drop a deleted session's telemetry. */
  forget(sessionFile: string): void;
  /** Force the pending write to disk (used before quitting). */
  flush(): Promise<void>;
}

const MAX_SESSIONS = 60;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Boundary validation: the file is user-writable, so nothing is trusted. */
function parseStored(value: unknown): StoredSessionStats | undefined {
  if (!isRecord(value)) return undefined;
  const turns = Array.isArray(value.turns) ? (value.turns as TurnStats[]) : [];
  const byDay: Record<string, DayUsage> = {};
  if (isRecord(value.byDay)) {
    for (const [key, day] of Object.entries(value.byDay)) {
      if (!isRecord(day)) continue;
      byDay[key] = {
        cost: typeof day.cost === "number" ? day.cost : 0,
        outputTokens: typeof day.outputTokens === "number" ? day.outputTokens : 0,
        totalTokens: typeof day.totalTokens === "number" ? day.totalTokens : 0,
        turns: typeof day.turns === "number" ? day.turns : 0,
      };
    }
  }
  return {
    turns,
    byDay,
    turnCounter: typeof value.turnCounter === "number" ? value.turnCounter : turns.length,
  };
}

export function createStatsStore(path: string): StatsStore {
  const sessions: Record<string, StoredSessionStats> = {};
  let order: string[] = [];
  let primed = false;
  let dirty = false;
  let timer: NodeJS.Timeout | null = null;

  async function persist(): Promise<void> {
    if (!dirty) return;
    dirty = false;
    const payload: StoreFile = { version: 1, sessions };
    try {
      // Write to a sibling temp file and rename over the target: a crash or a
      // kill mid-write then leaves the previous stats intact instead of a
      // truncated file. rename() replaces the destination on Windows too.
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(payload), "utf8");
      await rename(tmp, path);
    } catch (e) {
      log.warn("stats store save:", errText(e));
    }
  }

  function schedule(): void {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void persist();
    }, 1500);
    timer.unref?.();
  }

  function evict(): void {
    while (order.length > MAX_SESSIONS) {
      const oldest = order.shift();
      if (oldest) delete sessions[oldest];
    }
  }

  return {
    async prime(): Promise<void> {
      if (primed) return;
      primed = true;
      try {
        const raw = await readFile(path, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed) && isRecord(parsed.sessions)) {
          for (const [key, value] of Object.entries(parsed.sessions)) {
            const stats = parseStored(value);
            if (stats) sessions[key] = stats;
          }
          order = Object.keys(sessions);
        }
      } catch {
        // first run, or the file was removed — nothing to restore
      }
    },
    load(sessionFile: string): StoredSessionStats | undefined {
      return sessions[sessionFile];
    },
    save(sessionFile: string | undefined, data: StoredSessionStats): void {
      if (!sessionFile) return;
      if (sessionFile in sessions) order = [...order.filter((f) => f !== sessionFile), sessionFile];
      else order.push(sessionFile);
      sessions[sessionFile] = data;
      evict();
      schedule();
    },
    forget(sessionFile: string): void {
      delete sessions[sessionFile];
      order = order.filter((f) => f !== sessionFile);
      schedule();
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await persist();
    },
  };
}
