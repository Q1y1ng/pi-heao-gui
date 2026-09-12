/**
 * System tray + desktop notifications for Pi Standalone GUI.
 */
import { Tray, Menu, app, Notification, BrowserWindow, nativeImage } from "electron";
import { join } from "path";
import { existsSync } from "fs";

let tray: Tray | null = null;

export function createTray(getMainWindow: () => BrowserWindow | null): void {
  const iconPath = join(app.getAppPath(), "build", "icon.png");
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Pi Standalone GUI");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => {
        const win = getMainWindow();
        if (win) { win.show(); win.focus(); }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        (app as any).isQuiting = true;
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
