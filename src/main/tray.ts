/**
 * System tray + desktop notifications for Pi Heao GUI.
 *
 * The tray is the only way back into a hidden window, so it also exposes the
 * two things a user wants without restoring the app: a new session and the
 * recent sessions. It doubles as the unread indicator, because the window is
 * usually hidden while a long agent turn finishes.
 */
import {
  Tray,
  Menu,
  app,
  dialog,
  Notification,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  nativeImage,
  type NativeImage,
} from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { log, errText } from "./log";
import { t, tParams, type UiLang } from "./i18n";

let tray: Tray | null = null;

/** Language for the menu labels; set by createTray from the saved config. */
let uiLang: UiLang = "zh-cn";

/** `app` has no public "quitting" flag; this is the one place that owns it. */
interface AppWithQuitFlag {
  isQuiting?: boolean;
}

export function markQuitting(): void {
  // SAFETY: Electron keeps this flag on the App object for its own quit flows;
  // it is not in the public typings, so we own it through one accessor here.
  (app as unknown as AppWithQuitFlag).isQuiting = true;
}

export function isQuitting(): boolean {
  // SAFETY: same private flag as markQuitting — single owner, single shape.
  return Boolean((app as unknown as AppWithQuitFlag).isQuiting);
}

/**
 * Inline 16×16 PNG fallback (the black "Pi" mark). A packaged app that cannot
 * find its icon would otherwise create an EMPTY tray icon — and since closing
 * the window hides it to the tray, the user could not get the window back at all.
 * Regenerate with `npm run icon`.
 */
const FALLBACK_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABD0lEQVR4AcxRu22EQBAdNnABIKACejhBcBIZmTtAOsklQBHQgS2dRAV2CxeAnFMGEgU4AM8b7Z6O3QAuO8TbffN5TzOgiB/f90+MzyAIvo8AvYwTS0mBeJ53U0p98P1+BLr3Bi0muLDoDW7PQGsuiklohGVZUlVVd6RpKiXkDJeEPqDFBDokgkFd12SQZZnUiqKgJEmE28fGAMVxHCkM70MhRXmeU9d1wu3DMYiiSFZ4bJymycmZumMQx7GsYBr2bsfArIA12rbd05NjsKuwGl7MAL8KsKakpmmo73s7LbFa13USxgfEANPNi485DMMmhwBafIMrkz8knoHWXNU8z78cnJdl+eL75wh07xnafwAAAP//2Sz8ZQAAAAZJREFUAwBcjI2t+dwAwwAAAABJRU5ErkJggg==";

function iconCandidates(): string[] {
  const out = [
    join(app.getAppPath(), "build", "icon.png"),
    join(app.getAppPath(), "studio", "assets", "icon.png"),
  ];
  if (process.resourcesPath) out.push(join(process.resourcesPath, "build", "icon.png"));
  return out;
}

function loadTrayIcon(): NativeImage {
  for (const p of iconCandidates()) {
    try {
      if (!existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    } catch (e) {
      log.warn("icon load failed:", p, errText(e));
    }
  }
  log.warn("no icon file found — using inline fallback");
  return nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
}

export interface TrayHooks {
  getMainWindow: () => BrowserWindow | null;
  /** Open (or focus) a session in a window. */
  openSession?: (file: string) => void;
  newSession?: () => void;
  openSettings?: () => void;
}

let hooks: TrayHooks | null = null;
let recent: Array<{ label: string; file: string }> = [];
let unread = 0;

const BASE_TOOLTIP = "Pi Heao GUI V1.1.3 — made by HEAOZIE";

function showMain(): void {
  const win = hooks?.getMainWindow();
  if (win) {
    win.show();
    win.focus();
  }
}

function aboutDialog(): void {
  const detail = [
    "Pi Heao GUI V1.1.3",
    "made by HEAOZIE",
    "",
    "Electron shell for `pi --mode rpc` (JSONL over stdio).",
    "Chat UI: based on pi-agent-studio (MIT, JohnnyZ93), maintained in this project.",
  ].join("\n");
  const win = hooks?.getMainWindow();
  const options = {
    type: "info" as const,
    title: t("tray.aboutTitle", uiLang),
    message: "Pi Heao GUI V1.1.3",
    detail,
    buttons: [t("tray.ok", uiLang)],
  };
  if (win) void dialog.showMessageBox(win, options);
  else void dialog.showMessageBox(options);
}

function buildTemplate(): MenuItemConstructorOptions[] {
  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? recent.map((item) => ({
        label: item.label.length > 48 ? `${item.label.slice(0, 48)}…` : item.label,
        toolTip: item.file,
        click: () => {
          hooks?.openSession?.(item.file);
          showMain();
        },
      }))
    : [{ label: t("tray.noSessions", uiLang), enabled: false }];

  return [
    {
      label:
        unread > 0 ? tParams("tray.showUnread", uiLang, { n: unread }) : t("tray.show", uiLang),
      click: showMain,
    },
    { label: t("tray.newSession", uiLang), click: () => hooks?.newSession?.() },
    { type: "separator" },
    { label: t("tray.recent", uiLang), submenu: recentItems },
    { label: t("tray.settings", uiLang), click: () => hooks?.openSettings?.() },
    { type: "separator" },
    { label: t("tray.about", uiLang), click: aboutDialog },
    { type: "separator" },
    {
      label: t("tray.quit", uiLang),
      click: () => {
        markQuitting();
        app.quit();
      },
    },
  ];
}

/** Rebuild the tray menu (recent sessions and the unread counter changed). */
export function refreshTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(buildTemplate()));
    tray.setToolTip(unread > 0 ? `${BASE_TOOLTIP} — ${unread} 条未读` : BASE_TOOLTIP);
  } catch (e) {
    log.warn("tray menu refresh:", errText(e));
  }
}

/** Recent sessions shown in the tray submenu (already newest-first). */
export function setRecentSessions(items: Array<{ label: string; file: string }>): void {
  recent = items.slice(0, 8);
  refreshTrayMenu();
}

/**
 * Unread indicator: the window is often hidden when a turn finishes, and hiding
 * to the tray means there is no taskbar button to flash.
 */
export function setUnreadCount(count: number): void {
  if (count === unread) return;
  unread = Math.max(0, count);
  refreshTrayMenu();
}

export function getUnreadCount(): number {
  return unread;
}

/**
 * @returns true when a usable tray icon exists. The caller must NOT hide the
 * main window on close if this is false (otherwise the app becomes unreachable).
 */
export function createTray(hooksIn: TrayHooks, lang: UiLang = "zh-cn"): boolean {
  hooks = hooksIn;
  uiLang = lang;
  try {
    const icon = loadTrayIcon();
    tray = new Tray(icon);
    refreshTrayMenu();

    tray.on("double-click", showMain);

    return !icon.isEmpty();
  } catch (e) {
    log.error("tray create failed:", errText(e));
    tray = null;
    return false;
  }
}

export function showNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.show();
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
