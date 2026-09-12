/**
 * Screenshot harness: boots the real app, captures the main window and the
 * settings window to docs/screenshots/, then exits.
 *
 * Run with:  npm run shot
 *
 * Used to review visual changes without launching the app by hand.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

if ("ELECTRON_RUN_AS_NODE" in process.env) {
  console.error("ELECTRON_RUN_AS_NODE is set — unset it first (electron must run as Electron).");
  process.exit(3);
}

const OUT_DIR = path.join(__dirname, "..", "docs", "screenshots");
const WIDTH = Number(process.env.PI_SHOT_WIDTH || 1280);
const HEIGHT = Number(process.env.PI_SHOT_HEIGHT || 800);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  const { width, height } = img.getSize();
  console.log(`saved ${path.relative(path.join(__dirname, ".."), file)} (${width}x${height})`);
}

const hardTimeout = setTimeout(() => {
  console.error("screenshot run timed out");
  app.exit(2);
}, 120_000);

if (typeof app.setAppPath === "function") app.setAppPath(path.join(__dirname, ".."));
require(path.join(__dirname, "..", "dist", "main", "main.js"));

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const main = await waitFor(
      () => {
        const wins = BrowserWindow.getAllWindows();
        return wins.length ? wins[0] : null;
      },
      30_000,
      "main window",
    );

    main.setSize(WIDTH, HEIGHT);
    await waitFor(
      () => !main.webContents.isLoading() && main.webContents.getURL(),
      30_000,
      "chat load",
    );
    await waitFor(
      () =>
        main.webContents.executeJavaScript("!!document.querySelector('.pi-session-item')", true),
      30_000,
      "sidebar rows",
    );
    await sleep(1200);
    await shot(main, "main");

    // objective check that the design tokens actually won over upstream CSS
    const probe = await main.webContents.executeJavaScript(
      `(function(){
         function c(sel, prop){ var el = document.querySelector(sel); if (!el) return sel + '=MISSING'; return getComputedStyle(el).getPropertyValue(prop); }
         return [
           'name=' + c('.pi-session-name', 'color'),
           'group=' + c('.pi-group', 'color'),
           'row=' + c('.pi-session-item', 'border-radius'),
           'titlebar=' + c('.pi-titlebar', 'height'),
           'sidebar=' + c('#pi-sidebar', 'background-color'),
           'main=' + c('#pi-main', 'background-color'),
           'font=' + c('body', 'font-family'),
         ].join(' | ');
       })()`,
      true,
    );
    console.log(`[probe] ${probe}`);

    // a real session: exercises message/code/table styling (and measures how
    // long a large session takes to load)
    const t0 = Date.now();
    await main.webContents.executeJavaScript(
      "document.querySelector('#pi-session-list .pi-session-item')?.click()",
      true,
    );
    let rendered = 0;
    try {
      rendered = await waitFor(
        () =>
          main.webContents.executeJavaScript(
            "document.querySelectorAll('#pi-main .msg').length",
            true,
          ),
        90_000,
        "messages",
      );
    } catch (e) {
      console.warn("[probe] messages never rendered:", e.message);
    }
    console.log(`[probe] session load: ${Date.now() - t0} ms, ${rendered} message blocks`);
    await sleep(1500);
    await shot(main, "main-session");

    // sidebar collapsed + settings are the other two surfaces worth reviewing
    await main.webContents.executeJavaScript(
      "document.getElementById('pi-sidebar-toggle')?.click()",
      true,
    );
    await sleep(500);
    await shot(main, "main-sidebar-collapsed");
    await main.webContents.executeJavaScript(
      "document.getElementById('pi-sidebar-expand')?.click()",
      true,
    );
    await sleep(300);

    await main.webContents.executeJavaScript("window.pi.invoke('pi:open-settings')", true);
    const settings = await waitFor(
      () => {
        const wins = BrowserWindow.getAllWindows();
        return (
          wins.find((w) =>
            /pi-heao-settings|pi-standalone-settings/.test(w.webContents.getURL()),
          ) || null
        );
      },
      20_000,
      "settings window",
    );
    settings.setSize(760, 680);
    await sleep(900);
    await shot(settings, "settings-models");
    await settings.webContents.executeJavaScript(
      "document.querySelectorAll('.tab')[4]?.click()",
      true,
    );
    await sleep(500);
    await shot(settings, "settings-general");

    clearTimeout(hardTimeout);
    app.quit();
    setTimeout(() => app.exit(0), 4000);
  } catch (e) {
    console.error("screenshot run failed:", e?.message);
    clearTimeout(hardTimeout);
    app.exit(1);
  }
});
