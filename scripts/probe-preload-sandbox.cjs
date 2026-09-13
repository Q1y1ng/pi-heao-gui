/**
 * Throwaway probe (gitignored, `_` prefix): can a SANDBOXED preload still reach
 * webUtils? The chat window currently runs with sandbox:false, and this file
 * exists to find out whether that is load-bearing or just legacy.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron scripts/_probe-sandbox.cjs
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const preload = path.join(os.tmpdir(), "pi-probe-preload.js");

fs.writeFileSync(
  preload,
  [
    "const out = [];",
    "function probe(label, fn) { try { out.push(label + ': ' + fn()); } catch (e) { out.push(label + ': FAILED ' + e.message); } }",
    "probe('require(electron)', () => { const e = require('electron'); return 'OK keys=' + Object.keys(e).join('|'); });",
    "probe('webUtils', () => { const { webUtils } = require('electron'); return webUtils ? 'present, getPathForFile=' + typeof webUtils.getPathForFile : 'MISSING'; });",
    "probe('require(node:fs)', () => 'OK ' + typeof require('node:fs').readFileSync);",
    "probe('process.versions.electron', () => process.versions.electron);",
    "require('electron').ipcRenderer.send('probe-result', out);",
  ].join("\n"),
  "utf8",
);

app.whenReady().then(() => {
  ipcMain.on("probe-result", (_e, out) => {
    console.log("=== sandbox:true preload ===");
    for (const line of out) console.log(`  ${line}`);
    app.quit();
    setTimeout(() => app.exit(0), 1500);
    setTimeout(() => process.exit(0), 4000);
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL("data:text/html,<h1>probe</h1>");

  setTimeout(() => {
    console.log("TIMEOUT: no result from preload");
    process.exit(3);
  }, 15000);
});
