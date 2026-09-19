/**
 * Navigation guards: a window may only ever show the page this app put in it.
 *
 * The chat renders what a model writes, and markdown-it turns a bare URL into a real
 * `<a href>`. Nothing stopped a click on one from navigating the window itself — and a
 * navigation is not merely a lost UI. Electron injects a window's preload into **every**
 * navigation it makes, so the foreign origin would have been handed `window.pi`: the same
 * bridge whose allowlist contains `pi:term-input` (raw bytes to a live PTY) and
 * `pi:fs-write`. The app would have been replaced, in place, by a page that can drive the
 * terminal — with nothing in the log and no CSP directive in the way (`default-src` does not
 * govern navigation, and `navigate-to` was never implemented in Chromium).
 *
 * `classifyNavigation` is the whole decision and is pure, so it is unit-tested without a
 * window; `installNavigationGuards` is the two-listener wiring, taking its `WebContents` as a
 * parameter, the way the updater takes its autoUpdater, so a test can drive the events by hand.
 *
 * Deliberate asymmetry between the two ways out:
 *
 *   - `http(s)` and `mailto` are handed to the operating system, because that is what a person
 *     clicking a link expects, and a browser is not this app.
 *   - `file:` is refused outright rather than handed to the shell. `pi:open-file` already
 *     validates paths through `checkOpenPath` — no executables, no escapes from the workspace —
 *     and a raw `file:` navigation would be a way around that check rather than through it.
 */
import type { WebContents } from "electron";
import { log } from "./log";

export type NavigationVerdict =
  | { action: "allow"; reason: string }
  | { action: "deny"; reason: string }
  | { action: "open-external"; url: string; reason: string };

/** Schemes that leave for the OS instead of being rendered in a window of ours. */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** A fragment is the same document: an in-page anchor must not count as navigating away. */
function withoutFragment(url: URL): string {
  const full = url.toString();
  const hash = url.hash;
  return hash && full.endsWith(hash) ? full.slice(0, -hash.length) : full;
}

/**
 * What should happen to a navigation to `rawUrl`, from a window currently at `currentUrl`.
 *
 * Everything that is not the same document, an `about:` page, or an external scheme is denied:
 * the allowlist is what keeps a future link format from becoming a way around this.
 */
export function classifyNavigation(rawUrl: string, currentUrl: string): NavigationVerdict {
  let url: URL;
  try {
    url = new URL(String(rawUrl ?? ""));
  } catch {
    return { action: "deny", reason: "not a URL" };
  }

  // about:blank is how a BrowserWindow starts life, and there is nothing behind it to leak.
  if (url.protocol === "about:") return { action: "allow", reason: "about: document" };

  // A reload, or an anchor inside the page already on screen: the document does not change.
  if (currentUrl) {
    try {
      if (withoutFragment(url) === withoutFragment(new URL(String(currentUrl)))) {
        return { action: "allow", reason: "same document" };
      }
    } catch {
      // A current URL we cannot parse proves nothing; fall through to the scheme rules.
    }
  }

  if (EXTERNAL_SCHEMES.has(url.protocol)) {
    return { action: "open-external", url: url.toString(), reason: "external link" };
  }
  return { action: "deny", reason: `scheme stays out of this window: ${url.protocol}` };
}

export interface NavigationDeps {
  /** Where a link the app refuses to render goes. In the app this is the OS browser. */
  openExternal(url: string): void;
  /** Silence the per-decision lines (the harnesses keep them). */
  logInfo?: (message: string, ...rest: unknown[]) => void;
  logWarn?: (message: string, ...rest: unknown[]) => void;
}

function currentUrlOf(contents: WebContents): string {
  try {
    return contents.getURL();
  } catch {
    return "";
  }
}

/**
 * Refuse navigation in `contents`, and send external links to `deps.openExternal`.
 *
 * Call once per webContents (the app calls it from `web-contents-created`, so every window —
 * chat, settings, diff, a dragged-out session — is covered without being enumerated).
 */
export function installNavigationGuards(contents: WebContents, deps: NavigationDeps): void {
  const info =
    deps.logInfo ?? ((message: string, ...rest: unknown[]) => log.info(message, ...rest));
  const warn =
    deps.logWarn ?? ((message: string, ...rest: unknown[]) => log.warn(message, ...rest));

  const decide = (rawUrl: string, source: string): NavigationVerdict => {
    const verdict = classifyNavigation(rawUrl, currentUrlOf(contents));
    if (verdict.action === "open-external") {
      info(`navigation guard: ${source} — opening externally`, verdict.url);
      try {
        deps.openExternal(verdict.url);
      } catch (e) {
        warn("navigation guard: openExternal failed:", e);
      }
    } else if (verdict.action === "deny") {
      warn(`navigation guard: ${source} blocked (${verdict.reason})`, rawUrl);
    }
    return verdict;
  };

  contents.on("will-navigate", (event, url) => {
    if (decide(url, "in-window navigation").action !== "allow") event.preventDefault();
  });

  // window.open / target="_blank": never a window of ours, whatever the URL was.
  contents.setWindowOpenHandler((details) => {
    decide(details.url, "window.open");
    return { action: "deny" };
  });
}
