/**
 * What every window is doing, for the board that shows it.
 *
 * The app already knows all of this, in pieces that are each only visible from one place: the tray
 * lists windows and unread counts, the title bar shows the current window's streaming state, the
 * pending-decision list knows who is waiting. What was missing is one read-only answer to "what is
 * everything doing right now", which is the question a person has when several windows are open —
 * and the reason the tray menu is not it is that a menu is not something you glance at.
 *
 * Nothing here decides anything: it is a registry of what the app observed (streaming started,
 * stopped, a decision was raised, a window went quiet), kept in the main process because no single
 * renderer can see the other windows.
 */

export type WindowState = "running" | "waiting" | "idle" | "closed";

export interface WindowStatus {
  /** Electron's window id. */
  windowId: number;
  /** What the window is about: its session's name, or its title when it has no session yet. */
  label: string;
  /** The session file this window drives, when it has one. */
  sessionFile?: string;
  /** True while a turn is streaming in that window. */
  running: boolean;
  /** How many decisions that window is waiting for an answer to. */
  waiting: number;
  /** Unread turns finished while nobody was looking at that window. */
  unread: number;
  /** The last time anything happened there (epoch ms), for ordering and "how long". */
  touchedAt: number;
}

export interface WindowStatusBoard {
  /** Record a window (creating its entry) and patch what is known about it. */
  update(windowId: number, patch: Partial<Omit<WindowStatus, "windowId">>): void;
  /** The window is gone. */
  remove(windowId: number): void;
  list(): WindowStatus[];
  /** Called after every change. Returns the unsubscribe. */
  onChange(listener: () => void): () => void;
}

export interface WindowStatusOptions {
  now?: () => number;
}

/** The state a row is shown in: waiting beats running beats idle. */
export function stateOf(status: WindowStatus): WindowState {
  if (status.waiting > 0) return "waiting";
  if (status.running) return "running";
  return "idle";
}

export function createWindowStatusBoard(options: WindowStatusOptions = {}): WindowStatusBoard {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<number, WindowStatus>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    update(windowId: number, patch: Partial<Omit<WindowStatus, "windowId">>): void {
      const current = windows.get(windowId) ?? {
        windowId,
        label: `窗口 #${windowId}`,
        running: false,
        waiting: 0,
        unread: 0,
        touchedAt: now(),
      };
      const next: WindowStatus = { ...current, ...patch, windowId };
      // A patch that changes nothing is not news: the streaming message arrives per turn, and the
      // board re-broadcasts to every window.
      const changed = (Object.keys(next) as Array<keyof WindowStatus>).some(
        (key) => next[key] !== current[key],
      );
      windows.set(windowId, next);
      if (changed) notify();
    },

    remove(windowId: number): void {
      if (windows.delete(windowId)) notify();
    },

    list(): WindowStatus[] {
      // Waiting first, then running, then the rest — and the most recently touched first inside each
      // group. The board is read top-down, so the row that needs a person is the row on top.
      const rank = (s: WindowStatus): number => (s.waiting > 0 ? 0 : s.running ? 1 : 2);
      return [...windows.values()].sort(
        (a, b) => rank(a) - rank(b) || b.touchedAt - a.touchedAt || a.windowId - b.windowId,
      );
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
