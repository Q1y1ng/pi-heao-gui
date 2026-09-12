/**
 * System tray + desktop notifications for Pi Heao GUI.
 */
import {
  Tray,
  Menu,
  app,
  dialog,
  Notification,
  type BrowserWindow,
  nativeImage,
  type NativeImage,
} from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { log, errText } from "./log";

let tray: Tray | null = null;

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
    join(app.getAppPath(), "vendor", "upstream", "assets", "icon.png"),
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

/**
 * @returns true when a usable tray icon exists. The caller must NOT hide the
 * main window on close if this is false (otherwise the app becomes unreachable).
 */
export function createTray(getMainWindow: () => BrowserWindow | null): boolean {
  try {
    const icon = loadTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip("Pi Heao GUI V0.1 — made by HEAOZIE");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "显示主窗口",
        click: () => {
          const win = getMainWindow();
          if (win) {
            win.show();
            win.focus();
          }
        },
      },
      { type: "separator" },
      {
        label: "关于 Pi Heao GUI",
        click: () => {
          const detail = [
            "Pi Heao GUI V0.1",
            "made by HEAOZIE",
            "",
            "Electron shell for `pi --mode rpc` (JSONL over stdio).",
            "Chat UI: vendored pi-chat (MIT, JohnnyZ93/pi-agent-studio).",
          ].join("\n");
          const win = getMainWindow();
          if (win)
            void dialog.showMessageBox(win, {
              type: "info",
              title: "关于",
              message: "Pi Heao GUI V0.1",
              detail,
              buttons: ["好"],
            });
          else
            void dialog.showMessageBox({
              type: "info",
              title: "关于",
              message: "Pi Heao GUI V0.1",
              detail,
              buttons: ["好"],
            });
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          markQuitting();
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("double-click", () => {
      const win = getMainWindow();
      if (win) {
        win.show();
        win.focus();
      }
    });

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
