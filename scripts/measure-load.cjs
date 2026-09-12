/**
 * Measures where a session switch spends its time: pi-side parse+transfer versus
 * renderer-side paint. Used to decide whether CSS virtualization can help.
 *   npm run measure-load
 */
const { app, BrowserWindow } = require("electron");
const electron = require("electron");
if (!electron.app || typeof electron.app.on !== "function") {
  console.error(
    "ELECTRON_RUN_AS_NODE is set - unset it first (electron must run as Electron).\n" +
      "  env -u ELECTRON_RUN_AS_NODE <command>",
  );
  process.exit(2);
}
const path = require("node:path");
const fs = require("node:fs");

if (typeof app.setAppPath === "function") app.setAppPath(path.join(__dirname, ".."));
require(path.join(__dirname, "..", "dist", "main", "main.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function biggestSession() {
  const root = path.join(process.env.USERPROFILE || process.env.HOME, ".pi", "agent", "sessions");
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const st = fs.statSync(full);
        out.push({ file: full, size: st.size });
      }
    }
  };
  walk(root, 0);
  // realistic case: a multi-MB session, not the pathological 20 MB one
  const sized = out.filter((o) => o.size > 1.5 * 1048576 && o.size < 5 * 1048576);
  sized.sort((a, b) => b.size - a.size);
  return sized[0] || out[0];
}

app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    for (let i = 0; i < 100 && (!win || win.webContents.isLoading()); i++) await sleep(200);
    await sleep(4000);
    const target = biggestSession();
    console.log(`[load] target ${(target.size / 1048576).toFixed(2)} MB`);

    const result = await win.webContents.executeJavaScript(
      `(async () => {
         const file = ${JSON.stringify(target.file)};
         const list = document.querySelector('#pi-session-list');
         const t0 = performance.now();
         const before = document.querySelectorAll('.msg').length;
         const invoke = window.pi.invoke('pi:switch-session', { type: 'switchSession', sessionFile: file });
         let tIpc = 0;
         await invoke;
         tIpc = performance.now() - t0;
         // wait until the message list stops growing
         let last = 0;
         let stable = 0;
         let count = 0;
         while (stable < 6 && performance.now() - t0 < 120000) {
           await new Promise(r => setTimeout(r, 120));
           count = document.querySelectorAll('.msg').length;
           if (count === last && count > 0) stable++;
           else stable = 0;
           last = count;
         }
         const tDom = performance.now() - t0;
         return { tIpc: Math.round(tIpc), tDom: Math.round(tDom), blocks: count, before: before, html: document.querySelectorAll('#pi-main .msg').length };
       })()`,
      true,
    );
    console.log(
      `[load] ipc(pi parse+transfer)=${result.tIpc} ms  renderer total=${result.tDom} ms  ` +
        `renderer-only=${result.tDom - result.tIpc} ms  blocks=${result.blocks} (was ${result.before})`,
    );
    const metrics = app.getAppMetrics().filter((m) => m.type === "Tab");
    for (const m of metrics) console.log(`[load] renderer rss=${(m.memory.workingSetSize / 1024).toFixed(0)} MB`);
    app.exit(0);
  } catch (e) {
    console.error("measure failed:", e && e.stack ? e.stack : e);
    app.exit(1);
  }
});
