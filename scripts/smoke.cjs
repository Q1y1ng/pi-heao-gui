/**
 * Runtime smoke test: boots the REAL app (dist/main/main.js) and asserts the
 * security posture + wiring that unit tests cannot see.
 *
 * Run with:  npm run smoke
 *
 * Checks
 *   - renderer: window.pi bridge present, shell/sidebar/titlebar injected, pi-chat composer alive
 *   - sidebar: session list is populated (exercises the real pi:list-sessions handler)
 *   - preload allowlist (chat window): settings/auth channels are BLOCKED, chat ones work
 *   - preload allowlist (settings window): chat channels are BLOCKED
 *   - CSP: eval + remote fetch are refused
 *   - shell.openPath guard: an .exe path is refused instead of launched
 *
 * Exits non-zero when any check fails. Opens a real window for ~20s.
 */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error(
    "ELECTRON_RUN_AS_NODE is set — electron.exe is running as plain Node.js, so no Electron API exists.\n" +
      "Unset it first (PowerShell: $env:ELECTRON_RUN_AS_NODE=''; bash: unset ELECTRON_RUN_AS_NODE) and run again.",
  );
  process.exit(3);
}

const BOOT_TIMEOUT_MS = 120_000;
const JS_TIMEOUT_MS = 20_000;
const RESULTS = [];
const LOGS = [];

function step(msg) {
  console.log(`[step] ${msg}`);
}

function record(name, ok, detail) {
  RESULTS.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Each probe is isolated: one failure must not abort the remaining checks. */
async function checkEq(name, promise, expected) {
  try {
    const value = await promise;
    record(name, value === expected, String(value));
  } catch (e) {
    record(name, false, `ERROR: ${e?.message}`);
  }
}

async function checkTrue(name, promise) {
  try {
    record(name, !!(await promise));
  } catch (e) {
    record(name, false, `ERROR: ${e?.message}`);
  }
}

function describeWindows() {
  return (
    BrowserWindow.getAllWindows()
      .map(
        (w) =>
          `win(id=${w.id} destroyed=${w.isDestroyed()} loading=${w.webContents.isLoading()} url=${w.webContents.getURL()})`,
      )
      .join(", ") || "(none)"
  );
}

app.on("browser-window-created", (_e, win) => {
  win.__smokeLoaded = false;
  const wc = win.webContents;
  wc.on("did-finish-load", () => {
    win.__smokeLoaded = true;
  });
  // Electron >= 30 passes an event object; older builds pass positional args.
  wc.on("console-message", (ev, level, message) => {
    const l = typeof ev?.level === "number" ? ev.level : level;
    const m = typeof ev?.message === "string" ? ev.message : message;
    LOGS.push(`[console:${l}] ${String(m ?? "")}`);
  });
  wc.on("preload-error", (_ev, preloadPath, err) => {
    LOGS.push(`[preload-error] ${preloadPath}: ${err?.message}`);
  });
  wc.on("did-fail-load", (_ev, code, desc) => {
    LOGS.push(`[did-fail-load] ${code} ${desc}`);
  });
  wc.on("render-process-gone", (_ev, details) => {
    LOGS.push(`[render-gone] ${JSON.stringify(details)}`);
  });
});

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${label} (windows: ${describeWindows()})`);
}

async function main() {
  step("waiting for main window");
  const all = await waitFor(
    () => (BrowserWindow.getAllWindows().length ? BrowserWindow.getAllWindows() : null),
    30_000,
    "main window",
  );
  const mainWin = all[0];

  step("waiting for the chat document to finish loading");
  await waitFor(
    () => mainWin.__smokeLoaded && !mainWin.webContents.isLoading(),
    40_000,
    "did-finish-load",
  );
  step(`loaded: ${describeWindows()}`);

  const js = (code) =>
    Promise.race([
      mainWin.webContents.executeJavaScript(code, true),
      new Promise((_res, rej) =>
        setTimeout(
          () => rej(new Error(`executeJavaScript timed out: ${code.slice(0, 60)}`)),
          JS_TIMEOUT_MS,
        ),
      ),
    ]);

  // ── renderer shell ──
  await checkTrue("bridge window.pi exposed", js("!!window.pi"));
  await checkTrue(
    "injected shell present",
    js(
      "!!document.getElementById('pi-shell') && !!document.getElementById('pi-titlebar') && !!document.getElementById('pi-sidebar')",
    ),
  );
  await checkTrue(
    "pi-chat composer alive",
    js("!!document.querySelector('.composer-input, .composer-box, textarea')"),
  );
  await checkTrue(
    "app renamed to Pi Heao GUI",
    js(
      "document.title === 'Pi Heao GUI' && /Pi Heao GUI/.test(document.querySelector('.pi-tb-app').textContent)",
    ),
  );
  await checkTrue(
    "author watermark present",
    js(
      "!!document.querySelector('.pi-tb-brand') && /HEAOZIE/.test(document.querySelector('.pi-tb-brand').textContent)",
    ),
  );
  // A runtime-injected <style> may be first at query time, so assert what
  // actually matters: the policy is in <head> and nothing remote is loaded.
  const cspInfo = await js(
    "(function(){var m=document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]');" +
      "var remote=0;document.querySelectorAll('script[src],link[href]').forEach(function(el){" +
      "var u=el.getAttribute('src')||el.getAttribute('href')||'';if(/^(https?:)?\\/\\//i.test(u))remote++;});" +
      "return (m?(m.parentElement===document.head?'IN_HEAD':'ELSEWHERE'):'MISSING')+'|remoteRefs='+remote;})()",
  );
  record(
    "CSP meta in <head> and no remote refs",
    String(cspInfo).startsWith("IN_HEAD|remoteRefs=0"),
    String(cspInfo),
  );

  // ── sidebar data path: exercises the real async session lister ──
  try {
    const count = await waitFor(
      () => js("document.querySelectorAll('#pi-session-list .pi-session-item').length"),
      30_000,
      "session list items",
    );
    record("sidebar sessions rendered", count > 0, `${count} items`);
  } catch (e) {
    record("sidebar sessions rendered", false, e.message);
  }

  // ── the sidebar must stay interactive ──
  // Electron swallows every mouse event inside a `-webkit-app-region: drag`
  // area: the whole sidebar becomes a window-drag handle and clicks stop
  // working. Walk the ancestors to find the effective region per element.
  const dragInfo = await js(
    `(function(){
       var sels = ['#pi-sidebar', '#pi-session-list', '.pi-session-item', '#pi-session-filter', '#pi-new-session'];
       var out = [];
       for (var i = 0; i < sels.length; i++) {
         var el = document.querySelector(sels[i]);
         if (!el) { out.push(sels[i] + '=MISSING'); continue; }
         var node = el, region = 'none';
         while (node && node !== document.body) {
           var v = getComputedStyle(node).getPropertyValue('-webkit-app-region');
           if (v === 'drag') { region = 'DRAG@' + (node.id || node.className); break; }
           if (v === 'no-drag') { region = 'no-drag'; break; }
           node = node.parentElement;
         }
         out.push(sels[i] + '=' + region);
       }
       return out.join(' | ');
     })()`,
  );
  record("sidebar is not a window drag region", !/DRAG@/.test(String(dragInfo)), String(dragInfo));
  await checkEq(
    "sidebar header is still draggable",
    js(
      "(function(){var h=document.getElementById('pi-sidebar-header');" +
        "return h?getComputedStyle(h).getPropertyValue('-webkit-app-region'):'MISSING';})()",
    ),
    "drag",
  );
  await checkTrue(
    "session items accept clicks (pointer-events + cursor)",
    js(
      "(function(){var it=document.querySelector('.pi-session-item');if(!it)return false;" +
        "var cs=getComputedStyle(it);return cs.pointerEvents==='auto' && cs.cursor==='pointer';})()",
    ),
  );

  // ── CSP actually enforced ──
  await checkEq(
    "CSP blocks eval",
    js("(function(){try{eval('1+1');return 'ALLOWED'}catch(e){return 'BLOCKED'}})()"),
    "BLOCKED",
  );
  await checkEq(
    "CSP blocks remote fetch",
    js(
      "fetch('https://example.com/x.json').then(function(){return 'ALLOWED'}).catch(function(){return 'BLOCKED'})",
    ),
    "BLOCKED",
  );

  // ── preload allowlist: the chat window must not reach settings/auth channels ──
  await checkEq(
    "chat window cannot read auth.json",
    js(
      "window.pi.invoke('pi:read-agent-files').then(function(){return 'ALLOWED'},function(){return 'BLOCKED'})",
    ),
    "BLOCKED",
  );
  await checkEq(
    "chat window cannot write agent files",
    js(
      "window.pi.invoke('pi:write-agent-files',{append:'x'}).then(function(){return 'ALLOWED'},function(){return 'BLOCKED'})",
    ),
    "BLOCKED",
  );
  await checkEq(
    "chat window cannot change config",
    js(
      "window.pi.invoke('pi:set-config',{permissionMode:'FullAccess'}).then(function(){return 'ALLOWED'},function(){return 'BLOCKED'})",
    ),
    "BLOCKED",
  );
  const listed = await js(
    "window.pi.invoke('pi:list-sessions').then(function(r){return Array.isArray(r)?('ARRAY:'+r.length):'OTHER'},function(e){return 'REJECTED:'+e.message})",
  );
  record(
    "chat window can still use chat channels",
    String(listed).startsWith("ARRAY"),
    String(listed),
  );

  // ── shell.openPath guard (must refuse, and must NOT launch calc) ──
  const opened = await js(
    "window.pi.invoke('pi:open-file','C:\\\\Windows\\\\System32\\\\calc.exe').then(function(r){return JSON.stringify(r)},function(e){return 'REJECTED:'+e.message})",
  );
  record(
    "openPath refuses .exe",
    !String(opened).startsWith('{"ok":true') && String(opened).includes("false"),
    String(opened),
  );

  // ── Windows shim resolver: arguments must never be handed to cmd.exe ──
  try {
    const fs = require("node:fs");
    const { resolveSpawnTarget } = require(
      path.join(__dirname, "..", "dist", "main", "rpc-client.js"),
    );
    const shim = path.join(process.env.APPDATA || "", "npm", "pi.cmd");
    if (fs.existsSync(shim)) {
      const resolved = resolveSpawnTarget(shim, ["--version", "a&echo PWNED"]);
      const lastArg = resolved.args.at(-1);
      record(
        "spawn resolver avoids cmd.exe",
        !/cmd\.exe$/i.test(resolved.command),
        resolved.command,
      );
      record(
        "spawn resolver keeps metachars as data",
        lastArg === "a&echo PWNED",
        JSON.stringify(lastArg),
      );
    }
  } catch (e) {
    record("spawn resolver check", false, e?.message);
  }

  // ── settings window: its own narrow preload ──
  await js("window.pi.invoke('pi:open-settings')");
  step(`windows after open-settings: ${describeWindows()}`);
  const settingsWin = await waitFor(
    () => {
      const wins = BrowserWindow.getAllWindows();
      return wins.find((w) => /pi-(standalone|heao)-settings/.test(w.webContents.getURL())) || null;
    },
    20_000,
    "settings window",
  );
  await waitFor(() => settingsWin.__smokeLoaded, 20_000, "settings load");
  const sjs = (code) =>
    Promise.race([
      settingsWin.webContents.executeJavaScript(code, true),
      new Promise((_res, rej) =>
        setTimeout(() => rej(new Error("settings executeJavaScript timed out")), JS_TIMEOUT_MS),
      ),
    ]);
  await checkEq(
    "settings window can read config",
    sjs(
      "window.pi.invoke('pi:get-config').then(function(c){return c&&c.permissionMode?'OK':'OTHER'},function(e){return 'REJECTED:'+e.message})",
    ),
    "OK",
  );
  await checkEq(
    "settings window cannot drive the agent",
    sjs(
      "window.pi.invoke('pi:prompt',{message:'x'}).then(function(){return 'ALLOWED'},function(){return 'BLOCKED'})",
    ),
    "BLOCKED",
  );
  await checkEq(
    "settings window auth is masked",
    sjs(
      "window.pi.invoke('pi:read-agent-files').then(function(a){return /\\u2022/.test(a.auth)?'MASKED':(a.auth==='{}'?'EMPTY':'PLAINTEXT')},function(e){return 'REJECTED:'+e.message})",
    ).then((v) => (v === "EMPTY" ? "MASKED" : v)),
    "MASKED",
  );
}

const hardTimeout = setTimeout(() => {
  console.error(`\nSMOKE TIMEOUT after ${BOOT_TIMEOUT_MS} ms`);
  console.error(`windows: ${describeWindows()}`);
  console.error(
    `checks: ${RESULTS.map((r) => `${r.ok ? "PASS" : "FAIL"}:${r.name}`).join(", ") || "(none)"}`,
  );
  console.error(LOGS.slice(-30).join("\n"));
  app.exit(2);
}, BOOT_TIMEOUT_MS);

// Boot the real app (it owns app.whenReady()).
// Launched as `electron scripts/smoke.cjs`, Electron treats scripts/ as the app
// directory; point it back at the repo root so the app finds its assets.
if (typeof app.setAppPath === "function") app.setAppPath(path.join(__dirname, ".."));
require(path.join(__dirname, "..", "dist", "main", "main.js"));

app.whenReady().then(async () => {
  try {
    await main();
  } catch (e) {
    record("smoke run completed", false, e?.message);
  }

  const fatal = LOGS.filter((l) => /\[preload-error\]|\[render-gone\]|\[did-fail-load\]/.test(l));
  if (fatal.length) record("no preload/renderer failures", false, fatal.slice(0, 3).join(" | "));

  clearTimeout(hardTimeout);
  const failed = RESULTS.filter((r) => !r.ok);
  console.log(`\n--- ${RESULTS.length - failed.length}/${RESULTS.length} checks passed ---`);
  const cspViolations = LOGS.filter((l) => /Content Security Policy/i.test(l));
  if (cspViolations.length)
    console.log(
      `CSP violation reports: ${cspViolations.length} (expected: the deliberate remote-fetch probe)`,
    );
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  - ${f.name}`);
    console.log("\nlast renderer console lines:");
    console.log(LOGS.slice(-20).join("\n") || "(none)");
  }
  // Graceful quit so before-quit/will-quit run (temp cleanup, tray destroy,
  // session disposal) — app.exit() would skip them.
  process.exitCode = failed.length ? 1 : 0;
  app.quit();
  setTimeout(() => app.exit(failed.length ? 1 : 0), 5000);
});
