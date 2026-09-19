/**
 * One pi start-up at a time, per profile.
 *
 * pi installs the agent packages named in `~/.pi/agent/settings.json` every time it starts
 * (`npm install … --prefix <agentDir>/npm --legacy-peer-deps`). This app starts pi in more than one
 * place — a chat session, the dock's pi terminal, a second window — and two of those installs
 * running at once into one prefix lose the race on Windows:
 *
 *   npm warn tar TAR_ENTRY_ERROR ENOENT: … lstat '…\node_modules\ajv\dist'
 *   npm error code ENOTEMPTY: … rmdir '…\node_modules\zod\src\v4\locales'
 *
 * npm then exits non-zero, pi exits 1, and the prefix it was writing can be left half-removed — so
 * every later start fails the same way. That is the shape of "pi keeps exiting with code 1".
 *
 * Nothing about the install is observable from outside, so the queue does not try to detect it. A
 * caller that can tell when its own start-up finished takes a turn: it reports ready when pi answers
 * the first request the app sends it — pi does not read stdin until its start-up work is behind it,
 * which is what makes that answer honest, and it arrives on a profile with nothing to install just
 * as it does on one with eleven packages to fetch (`chat-session.ts`). A caller that cannot tell (the
 * dock's pi terminal: the TUI is interactive from its first paint, so there is no observable "past
 * start-up") only waits for the queue to be free and never holds it — waiting costs a second,
 * holding wrongly would cost everyone else the ceiling.
 *
 * A start-up that never reports ready cannot wedge the queue: `acquire` waits at most `maxHoldMs`
 * before letting the next one through, because a delayed start is a much smaller problem than a pi
 * that never starts.
 */

/**
 * How long a start-up may hold the queue before the next caller is let through anyway.
 *
 * Measured, not guessed. A start-up reports ready when pi answers the app's first request, and the
 * time that takes is the time pi's own start-up install takes: **+70.9 s** with the 11 agent
 * packages of a real profile against an empty prefix and a warm npm cache, **past +170 s** for the
 * same install with a cold cache under load, and **+1.0 s** with nothing to install. An
 * already-installed profile reports in ~3 s, so this ceiling is only ever reached by a start-up that
 * never reports at all — and letting the next one through early would recreate the very race this
 * queue exists to prevent. Waiting is the cheaper mistake.
 */
const DEFAULT_MAX_HOLD_MS = 300_000;

export interface SpawnQueue {
  /**
   * Resolves when this caller may start pi, and takes a turn: the caller must `release` it. Resolves
   * immediately when nobody else is starting one. Never rejects.
   */
  acquire(key: string): Promise<void>;
  /**
   * Resolves when nobody is starting pi right now — without taking a turn. For a caller that cannot
   * observe when its own start-up ends.
   */
  whenIdle(key: string): Promise<void>;
  /**
   * This caller's pi is past its start-up work — or has failed, which counts the same: the queue
   * exists to serialise installs, not to police failures. Extra calls are ignored.
   */
  release(key: string): void;
  /** Bounded view for the diagnostics bundle. */
  stats(): { key: string; waiting: number; watching: number; holding: boolean }[];
}

export interface SpawnQueueOptions {
  /** How long a start-up may hold the queue before the next caller is let through anyway. */
  maxHoldMs?: number;
  now?: () => number;
  /** Injected so tests do not depend on wall-clock time. */
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
  log?: (message: string) => void;
}

interface Waiter {
  resolve: () => void;
  /** Whether this waiter becomes the next holder, or is only watching for the queue to clear. */
  takesTurn: boolean;
}

interface Entry {
  /** Resolves the caller that is currently holding the queue. */
  held?: () => void;
  waiting: Waiter[];
  watching: number;
  /** When the current holder was let through. */
  since?: number;
  /** Cancels the holder's safety timer. */
  cancelTimer?: () => void;
}

function defaultSetTimer(fn: () => void, ms: number): { cancel: () => void } {
  const timer = setTimeout(fn, ms);
  // Never keep the process alive for this. Same optional call the RPC client uses.
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

export function createSpawnQueue(options: SpawnQueueOptions = {}): SpawnQueue {
  const maxHoldMs = options.maxHoldMs ?? DEFAULT_MAX_HOLD_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? defaultSetTimer;
  const log = options.log ?? (() => {});
  const entries = new Map<string, Entry>();

  const entryFor = (key: string): Entry => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { waiting: [], watching: 0 };
      entries.set(key, entry);
    }
    return entry;
  };

  /** Hand the turn to the next caller that wants one; watchers are released on the way past. */
  const passOn = (key: string, entry: Entry, why: string): void => {
    entry.cancelTimer?.();
    entry.cancelTimer = undefined;
    const held = entry.held;
    entry.held = undefined;
    entry.since = undefined;
    held?.();

    while (entry.waiting.length) {
      const next = entry.waiting.shift() as Waiter;
      if (!next.takesTurn) {
        entry.watching -= 1;
        next.resolve();
        continue;
      }
      log(`spawn queue [${key}]: ${why} — letting the next start-up through`);
      entry.held = next.resolve;
      entry.since = now();
      entry.cancelTimer = setTimer(() => {
        if (entry.held === next.resolve)
          passOn(key, entry, `held for ${maxHoldMs}ms without reporting`);
      }, maxHoldMs).cancel;
      next.resolve();
      return;
    }
    if (!entry.held) entries.delete(key);
  };

  return {
    acquire(key: string): Promise<void> {
      const entry = entryFor(key);
      return new Promise<void>((resolve) => {
        if (!entry.held) {
          log(`spawn queue [${key}]: starting immediately (nobody else is starting pi)`);
          entry.held = resolve;
          entry.since = now();
          entry.cancelTimer = setTimer(() => {
            if (entry.held === resolve)
              passOn(key, entry, `held for ${maxHoldMs}ms without reporting`);
          }, maxHoldMs).cancel;
          resolve();
          return;
        }
        entry.waiting.push({ resolve, takesTurn: true });
        log(`spawn queue [${key}]: waiting behind a start-up (${entry.waiting.length} in line)`);
      });
    },

    whenIdle(key: string): Promise<void> {
      const entry = entries.get(key);
      if (!entry?.held) return Promise.resolve();
      entry.watching += 1;
      return new Promise<void>((resolve) => {
        // A watcher never becomes the holder, so it cannot stall the queue if it is never released.
        entry.waiting.push({ resolve, takesTurn: false });
        log(`spawn queue [${key}]: waiting for the current start-up to finish (not taking a turn)`);
      });
    },

    release(key: string): void {
      const entry = entries.get(key);
      if (!entry?.held) return;
      passOn(key, entry, `start-up reported ready after ${now() - (entry.since ?? now())}ms`);
    },

    stats(): { key: string; waiting: number; watching: number; holding: boolean }[] {
      return [...entries].map(([key, entry]) => ({
        key,
        waiting: entry.waiting.filter((w) => w.takesTurn).length,
        watching: entry.watching,
        holding: Boolean(entry.held),
      }));
    },
  };
}

/**
 * The queue the app actually uses. One per process: the pi children of one app instance share a
 * profile, and a second app instance is kept out by the single-instance lock.
 */
let shared: SpawnQueue | undefined;

export function getSpawnQueue(): SpawnQueue {
  shared ??= createSpawnQueue({
    log: (message) => {
      // Imported lazily so this module stays usable from tests without the app's logger.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require("./log") as { log: { info: (m: string) => void } };
        log.info(message);
      } catch {
        /* the logger is optional */
      }
    },
  });
  return shared;
}

/**
 * Which install prefix a start-up will use. Two start-ups collide when this matches: pi's agent
 * directory comes from the environment the app hands the child, so the key is derived from the same
 * values rather than from the current process's own home.
 */
export function profileKey(env: Record<string, string | undefined>): string {
  const home = env.HOME || env.USERPROFILE || "";
  const agentDir = env.PI_AGENT_DIR || env.PI_CONFIG_DIR || "";
  return agentDir || `${home}${home ? "|" : ""}default`;
}
