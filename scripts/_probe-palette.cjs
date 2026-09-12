/** Throwaway probe: why does the synthetic Ctrl+K not reach the palette? */
const path = require("node:path");
const electron = require("electron");
if (!electron.app || typeof electron.app.on !== "function") {
  console.error("ELECTRON_RUN_AS_NODE is set");
  process.exit(2);
}
const { app, BrowserWindow } = electron;
if (typeof app.setAppPath === "function") app.setAppPath(path.join(__dirname, ".."));
require(path.join(__dirname, "..", "dist", "main", "main.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(6000);
  const win = BrowserWindow.getAllWindows()[0];
  await sleep(3000);
  const out = await win.webContents.executeJavaScript(
    `(function () {
      const p = document.getElementById('pi-palette');
      const before = p ? p.hidden : null;
      const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      const after = p ? p.hidden : null;
      const probe = { exists: !!p, before: before, after: after, prevented: ev.defaultPrevented, hook: !!window.__piPalette, active: document.activeElement && document.activeElement.id };
      let viaHook = null;
      try { window.__piPalette.open(); viaHook = document.getElementById('pi-palette').hidden; } catch (e) { viaHook = 'throw: ' + e.message; }
      let viaHookK = null;
      return Object.assign(probe, { viaHook: viaHook, viaHookK: viaHookK });
    })()`,
    true,
  );
  console.log(JSON.stringify(out, null, 2));

  // Does a keydown delivered the way a user produces it behave differently?
  const out2 = await win.webContents.executeJavaScript(
    `(function () {
      const inp = document.getElementById('pi-palette-input');
      const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
      (inp || document.body).dispatchEvent(ev);
      return { hiddenAfterBubblingFromInput: document.getElementById('pi-palette').hidden, prevented: ev.defaultPrevented };
    })()`,
    true,
  );
  console.log(JSON.stringify(out2, null, 2));
  app.exit(0);
});
