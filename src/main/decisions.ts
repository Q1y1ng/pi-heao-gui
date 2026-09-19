/**
 * The decisions that are waiting for a person.
 *
 * A `dialog` — a permission, an elevation, a confirmation — is the one signal in this app that means
 * "this turn cannot continue until someone answers" (`main.ts` already chimes for it, and repeats the
 * chime while its window stays in the background). What was missing is the list: which windows are
 * waiting, for what, and a way to get to them.
 *
 * The list lives in the main process rather than in a renderer because the windows that wait are not
 * the window that asks: a decision can be raised in a child window, in a session that is not on
 * screen, or in the window the person is not looking at. Every window's panel shows the same list.
 *
 * Nothing here answers anything. A dialog is answered in the window that raised it — that is where
 * pi's request and its options are — so this only tracks that the request is still open, and where to
 * go to deal with it.
 */

/** How much of a request's `message` is kept: the panel is a list, not a transcript. */
export const DECISION_MESSAGE_CHARS = 400;

/** Beyond this many pending decisions the oldest are dropped: a runaway loop is not a queue. */
export const MAX_PENDING_DECISIONS = 50;

export interface PendingDecision {
  /** The extension UI request id — what an answer carries back to pi. */
  id: string;
  /** The window whose session is blocked on it. */
  windowId: number;
  /** What kind of request this is (`select` / `confirm` / `input` / `editor`). */
  method: string;
  /** One line a person can act on: the request's own title, or a fallback for its method. */
  title: string;
  /** The longer text, clipped (see `DECISION_MESSAGE_CHARS`). */
  message?: string;
  /** Which window is waiting, as its title bar says it. */
  windowLabel?: string;
  /** When it was raised (epoch ms), for ordering and for "how long has this been sitting here". */
  askedAt: number;
}

export interface DecisionQueue {
  /** A window asked something. A repeat of the same id replaces the entry (and keeps the newer text). */
  add(decision: PendingDecision): void;
  /** That request is no longer waiting: it was answered, or the session that raised it is gone. */
  resolve(windowId: number, id: string): void;
  /** Everything one window was waiting on — it closed, or moved to another session. */
  dropWindow(windowId: number): void;
  list(): PendingDecision[];
  /** Called after every change. Returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Bounded view for the diagnostics bundle. */
  stats(): { pending: number; windows: number };
}

export interface DecisionQueueOptions {
  max?: number;
  log?: (message: string) => void;
}

const FALLBACK_TITLES: Record<string, string> = {
  confirm: "需要确认",
  select: "需要选择",
  input: "需要输入",
  editor: "需要输入",
};

/**
 * What to show for one extension UI request.
 *
 * Pure and defensive on purpose: the request comes off pi's wire (or from an extension), so any
 * field can be missing or of the wrong type, and a panel that throws while rendering one malformed
 * request would take the whole window's chrome down with it.
 */
export function describeRequest(request: unknown): {
  method: string;
  title: string;
  message?: string;
} {
  const req = (request && typeof request === "object" ? request : {}) as {
    method?: unknown;
    title?: unknown;
    message?: unknown;
    prompt?: unknown;
  };
  const method = typeof req.method === "string" ? req.method : "";
  const rawTitle = typeof req.title === "string" ? req.title.trim() : "";
  const rawMessage = typeof req.message === "string" ? req.message.trim() : "";
  const fallback = FALLBACK_TITLES[method] ?? "需要处理";
  // A request may carry only a message (`prompt` in some shapes): that is then the title, so the list
  // still says what is being asked instead of only which method asked it.
  const title = rawTitle || rawMessage.slice(0, 120) || fallback;
  const message = rawTitle && rawMessage ? rawMessage.slice(0, DECISION_MESSAGE_CHARS) : undefined;
  return { method, title, message };
}

export function createDecisionQueue(options: DecisionQueueOptions = {}): DecisionQueue {
  const max = options.max ?? MAX_PENDING_DECISIONS;
  const log = options.log ?? (() => {});
  /** Keyed by window + request id: the same request id from two windows is two decisions. */
  const items = new Map<string, PendingDecision>();
  const listeners = new Set<() => void>();

  const key = (windowId: number, id: string): string => `${windowId}\u0000${id}`;
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    add(decision: PendingDecision): void {
      if (!decision.id) return;
      const k = key(decision.windowId, decision.id);
      const known = items.has(k);
      // Re-adding moves the entry to the end: Map iteration order is insertion order, and the panel
      // shows the oldest first.
      items.delete(k);
      items.set(k, decision);
      while (items.size > max) {
        const oldest = items.keys().next().value;
        if (oldest === undefined) break;
        items.delete(oldest);
      }
      if (!known) {
        log(
          `decision pending [win#${decision.windowId}]: ${decision.method} — ${decision.title.slice(0, 80)}`,
        );
      }
      notify();
    },

    resolve(windowId: number, id: string): void {
      if (items.delete(key(windowId, id))) {
        log(`decision answered [win#${windowId}]: ${id}`);
        notify();
      }
    },

    dropWindow(windowId: number): void {
      let dropped = 0;
      for (const [k, item] of [...items]) {
        if (item.windowId !== windowId) continue;
        items.delete(k);
        dropped++;
      }
      if (dropped) {
        log(`decision dropped [win#${windowId}]: ${dropped} no longer answerable`);
        notify();
      }
    },

    list(): PendingDecision[] {
      return [...items.values()];
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    stats(): { pending: number; windows: number } {
      return { pending: items.size, windows: new Set([...items.values()].map((i) => i.windowId)).size };
    },
  };
}
