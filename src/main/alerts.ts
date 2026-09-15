/**
 * Desktop alerts: when the app is allowed to make a noise, and how the noise is
 * made.
 *
 * The rules live in `decideAlert`, which is pure (no Electron, no clock, no
 * timers) so they can be unit-tested directly — see test/alerts.test.cjs. The
 * playback lives further down and is deliberately dumb.
 *
 * Why the sound is synthesized in a hidden renderer instead of shipped as a file,
 * or left to the OS:
 *   - Electron's main process has no audio API at all;
 *   - `Notification.sound` is documented macOS-only, and a custom Windows toast
 *     sound means hand-writing `toastXml`;
 *   - Windows' Focus Assist silences the toast sound together with the toast.
 * A hidden window with an AudioContext sidesteps all three and costs no binary
 * assets. `backgroundThrottling: false` is what keeps it audible while the app
 * sits in the tray — without it Chromium throttles the hidden window and the
 * audio never starts.
 */
import { BrowserWindow } from "electron";
import type { AlertSettings } from "../shared/types";
import { errText, log } from "./log";

/** "work finished" vs "someone is waiting for an answer". */
export type AlertKind = "turnEnd" | "decision";

export interface AlertState {
  now: number;
  /** 0 = never played. Used for the debounce. */
  lastPlayedAt: number;
  /** Alerts are suppressed before this timestamp. */
  mutedUntil: number;
  /** Focus of the window the event belongs to. */
  windowFocused: boolean;
}

export interface AlertDecision {
  /** False when nothing may be heard at all. */
  audible: boolean;
  /** True = play the synthesized chime; false = let the toast carry the sound. */
  synth: boolean;
  /** True = the accompanying toast must not make its own noise. */
  toastSilent: boolean;
  /** One word explaining the outcome; asserted in tests and logged. */
  reason: string;
}

/**
 * The rule table. Order matters: the first matching rule wins.
 *
 * A *decision* is heard even when its window has focus, because the turn is
 * blocked until someone answers. A *finished turn* is only worth a sound when
 * nobody is looking at that window — otherwise the reply is already on screen.
 */
export function decideAlert(
  kind: AlertKind,
  settings: AlertSettings,
  state: AlertState,
): AlertDecision {
  const off = (reason: string): AlertDecision => ({
    audible: false,
    synth: false,
    toastSilent: true,
    reason,
  });

  if (!settings.enabled) return off("disabled");
  if (settings.sound === "off") return off("sound-off");
  if (kind === "turnEnd" && !settings.onTurnEnd) return off("turn-end-off");
  if (kind === "decision" && !settings.onApproval) return off("approval-off");
  if (state.now < state.mutedUntil) return off("muted");
  if (kind === "turnEnd" && state.windowFocused) return off("focused");
  if (state.lastPlayedAt > 0 && state.now - state.lastPlayedAt < settings.minIntervalMs)
    return off("debounced");

  const chime = settings.sound === "chime";
  return { audible: true, synth: chime, toastSilent: chime, reason: "play" };
}

// ─── Playback: a hidden renderer that owns an AudioContext ────────────

const NOTIFIER_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function () {
  var ctx = null;
  // A rising three-note arpeggio says "work finished"; a falling pair says
  // "someone is waiting for you". Short on purpose: this fires while you are
  // reading, not while you are away from the machine.
  var NOTES = {
    turnEnd: [[523.25, 0], [659.25, 0.085], [783.99, 0.17]],
    decision: [[659.25, 0], [493.88, 0.16]]
  };
  window.__piChime = function (kind, volume) {
    var notes = NOTES[kind] || NOTES.turnEnd;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    if (!ctx || ctx.state === 'closed') ctx = new Ctor();
    if (ctx.state === 'suspended') { void ctx.resume(); }
    var peak = Math.max(0.02, Math.min(0.6, 0.3 * volume));
    var t0 = ctx.currentTime + 0.02;
    for (var i = 0; i < notes.length; i++) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i][0];
      var t = t0 + notes[i][1];
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.28);
    }
    return true;
  };
})();
</script></body></html>`;

let notifier: BrowserWindow | null = null;
/** Creation failed once — do not keep retrying on every event. */
let notifierUnavailable = false;
/** Destroys the notifier once the chime has finished. */
let closeTimer: NodeJS.Timeout | null = null;
/**
 * How long the notifier outlives the last note. It is destroyed instead of being
 * kept around because a hidden BrowserWindow is still a window: Electron's
 * `window-all-closed` would never fire while it lived, so closing the app's last
 * real window would leave the process running invisibly.
 */
const NOTIFIER_LINGER_MS = 1500;
let lastPlayedAt = 0;
let mutedUntil = 0;

function ensureNotifier(): BrowserWindow | null {
  if (notifierUnavailable) return null;
  if (notifier && !notifier.isDestroyed()) return notifier;
  try {
    const win = new BrowserWindow({
      show: false,
      width: 240,
      height: 160,
      skipTaskbar: true,
      webPreferences: {
        // The whole point: a throttled hidden window never starts its audio.
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.on("closed", () => {
      notifier = null;
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(NOTIFIER_HTML)}`);
    notifier = win;
    return win;
  } catch (e) {
    log.error("alert notifier could not start:", errText(e));
    notifierUnavailable = true;
    return null;
  }
}

function scheduleNotifierClose(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (notifier && !notifier.isDestroyed()) notifier.destroy();
    notifier = null;
  }, NOTIFIER_LINGER_MS);
  // A pending sound is never a reason to keep the process alive.
  closeTimer.unref?.();
}

export function alertState(windowFocused: boolean): AlertState {
  return { now: Date.now(), lastPlayedAt, mutedUntil, windowFocused };
}

/** Silence alerts for `ms` (tray "mute" switch). Returns the new deadline. */
export function muteAlertsFor(ms: number): number {
  mutedUntil = Date.now() + Math.max(0, ms);
  return mutedUntil;
}

export function unmuteAlerts(): void {
  mutedUntil = 0;
}

export function isAlertsMuted(): boolean {
  return Date.now() < mutedUntil;
}

/**
 * Play the chime. False means "no synthesized sound happened" — the caller keeps
 * its toast as the fallback rather than leaving the user with silence.
 */
export async function playChime(kind: AlertKind, volume: number): Promise<boolean> {
  const win = ensureNotifier();
  if (!win) return false;
  const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.6;
  try {
    await win.webContents.executeJavaScript(
      `window.__piChime(${JSON.stringify(kind)}, ${v})`,
      true,
    );
    lastPlayedAt = Date.now();
    scheduleNotifierClose();
    return true;
  } catch (e) {
    log.warn("alert chime failed:", errText(e));
    scheduleNotifierClose();
    return false;
  }
}

/**
 * Decide and, when allowed, start playback. Synchronous on purpose: the renderer
 * message path that raises the alert cannot await, and the debounce has to see the
 * timestamp immediately or two events in the same tick both play. The caller uses
 * the returned decision to shape its notification.
 */
export function fireAlert(
  kind: AlertKind,
  settings: AlertSettings,
  windowFocused: boolean,
): AlertDecision {
  const decision = decideAlert(kind, settings, alertState(windowFocused));
  if (!decision.audible) return decision;
  if (!decision.synth) return decision;
  lastPlayedAt = Date.now();
  void playChime(kind, settings.volume).then((played) => {
    // Synthesizer unavailable (no AudioContext, window gone): the notification
    // keeps its own sound, so the alert is not lost — say so once in the log.
    if (!played) log.warn("alert chime unavailable; the notification carries the sound instead");
  });
  return decision;
}

/** True for the hidden window this module owns, so callers can ignore it. */
export function isAlertNotifierWindow(win: BrowserWindow): boolean {
  return !!notifier && !notifier.isDestroyed() && win.id === notifier.id;
}

/** Every window that belongs to this module must be gone before the app exits. */
export function disposeAlerts(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (notifier && !notifier.isDestroyed()) notifier.destroy();
  notifier = null;
}
