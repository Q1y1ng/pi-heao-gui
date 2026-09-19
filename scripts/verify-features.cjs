/**
 * Feature verification: boots the real app and exercises the new UI surfaces
 * (telemetry panel, command palette, sidebar session menu, settings tabs),
 * asserting on the live DOM. Run with:
 *   npm run verify
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

// The navigation-guard section below clicks a real https: link. The app hands those to the OS
// browser, and a browser tab appearing on whoever ran `npm run verify` would be a side effect of
// measuring rather than of the app -- so the guard records the intent instead (see main.ts).
process.env.PI_NAV_NO_OPEN = "1";
require(path.join(__dirname, "..", "dist", "main", "main.js"));

const OUT = path.join(__dirname, "..", "docs", "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(200);
  }
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = await waitFor(() => BrowserWindow.getAllWindows()[0], 30_000, "main window");
    win.setSize(1280, 800);
    await waitFor(() => !win.webContents.isLoading(), 30_000, "chat load");
    await waitFor(
      () => win.webContents.executeJavaScript("!!window.pi && !!window.pi.invoke", true),
      20_000,
      "preload bridge",
    );

    // ── 1. Telemetry panel ────────────────────────────────────────────
    const stats = await win.webContents.executeJavaScript(
      `(async () => {
         if (!window.__piStats) return { missing: true };
         window.__piStats.open();
         await new Promise(r => setTimeout(r, 900));
         const modal = document.getElementById('pi-stats-modal');
         const cards = document.querySelectorAll('.pi-stat-card').length;
         const kv = document.querySelectorAll('#pi-stats-totals .pi-kv-row').length;
         const table = !!document.querySelector('#pi-stats-turns');
         const tps = document.getElementById('pi-stat-tps').textContent;
         const hit = document.getElementById('pi-stat-modal-cache').textContent;
         const raw = await window.pi.invoke('pi:get-stats');
         return { missing: false, visible: !modal.hidden, cards, kv, table, tps, hit, aggregate: !!(raw && raw.aggregate && typeof raw.aggregate.turns === 'number') };
       })()`,
      true,
    );
    check("telemetry panel opens", !stats.missing && stats.visible, JSON.stringify(stats));
    check("panel shows four metric cards", stats.cards === 4, `cards=${stats.cards}`);
    check("panel shows session totals", stats.kv >= 6, `rows=${stats.kv}`);
    check("panel has the per-turn table", stats.table === true);
    check(
      "pi:get-stats returns a telemetry snapshot",
      stats.aggregate === true,
      `tps=${stats.tps} cache=${stats.hit}`,
    );
    await win.webContents.executeJavaScript("window.__piStats.close()", true);

    // ── 2. Command palette ────────────────────────────────────────────
    const palette = await win.webContents.executeJavaScript(
      `(async () => {
         if (!window.__piPalette) return { missing: true };
         window.__piPalette.open();
         // commands render instantly, sessions arrive from the main process later
         await new Promise(r => setTimeout(r, 200));
         const immediate = document.querySelectorAll('.pi-palette-item').length;
         const input = document.getElementById('pi-palette-input');
         input.value = '新建';
         input.dispatchEvent(new Event('input', { bubbles: true }));
         await new Promise(r => setTimeout(r, 200));
         const filtered = document.querySelectorAll('.pi-palette-item').length;
         const first = document.querySelector('.pi-palette-item .pi-palette-title');
         // wait for the session list and the slash-command list to arrive
         const deadline = Date.now() + 25000;
         let kinds = [];
         let items = 0;
         while (Date.now() < deadline) {
           items = document.querySelectorAll('.pi-palette-item').length;
           kinds = [...new Set([...document.querySelectorAll('.pi-palette-kind')].map(e => e.textContent))];
           if (kinds.length >= 3) break;
           await new Promise(r => setTimeout(r, 400));
         }
         const root = document.getElementById('pi-palette');
         return { missing: false, visible: !root.hidden, items, immediate, kinds, filtered, first: first ? first.textContent : '' };
       })()`,
      true,
    );
    check("palette opens", !palette.missing && palette.visible, JSON.stringify(palette));
    check(
      "palette renders commands immediately",
      palette.immediate > 3,
      `immediate=${palette.immediate}`,
    );
    check("palette lists results", palette.items > 3, `items=${palette.items}`);
    check(
      "palette groups commands, sessions and slash commands",
      ["命令", "会话", "指令"].every((k) => (palette.kinds || []).includes(k)),
      `kinds=${(palette.kinds || []).join(",")}`,
    );
    check(
      "palette filters as you type",
      palette.filtered >= 1 && palette.filtered < palette.items,
      `filtered=${palette.filtered} of ${palette.items}`,
    );
    check("filter matches the new-session command", /新建会话/.test(palette.first), palette.first);
    await win.webContents.executeJavaScript("window.__piPalette.close()", true);

    // ── 3. Sidebar: keyboard nav, archived toggle, context menu ───────
    await waitFor(
      () =>
        win.webContents.executeJavaScript(
          "!!document.querySelector('#pi-session-list .pi-session-item')",
          true,
        ),
      30_000,
      "sidebar rows",
    );
    const sidebar = await win.webContents.executeJavaScript(
      `(async () => {
         const rows = document.querySelectorAll('#pi-session-list .pi-session-item');
         document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
         await new Promise(r => setTimeout(r, 120));
         const focused = document.querySelectorAll('#pi-session-list .pi-session-item.kb').length;
         const firstFile = rows[0] && rows[0].getAttribute('data-file');
         // context menu on the first row
         rows[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }));
         await new Promise(r => setTimeout(r, 120));
         const menuItems = [...document.querySelectorAll('.pi-ctx-item')].map(e => e.textContent);
         const archiveBtn = !!document.getElementById('pi-sidebar-archived-toggle');
         const archivedList = !!document.getElementById('pi-archived-list');
         return { rows: rows.length, focused, menuItems, archiveBtn, archivedList, firstFile };
       })()`,
      true,
    );
    check("sidebar has session rows", sidebar.rows > 0, `rows=${sidebar.rows}`);
    check("ArrowDown focuses a row", sidebar.focused === 1);
    check("archived toggle exists", sidebar.archiveBtn === true);
    check("archived list container exists", sidebar.archivedList === true);
    const menuText = (sidebar.menuItems || []).join("|");
    check("context menu offers rename", /重命名/.test(menuText), menuText);
    check("context menu offers archive", /归档/.test(menuText), menuText);
    check("context menu offers delete", /删除/.test(menuText), menuText);
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('.pi-ctx-item').forEach(e => e.remove())",
      true,
    );

    // ── 4. Diagnostics + settings surfaces (main-process side) ────────
    const diag = await win.webContents.executeJavaScript(
      `window.pi.invoke('pi:diagnostics', 'info').then(r => ({ ok: r.ok, hasVersion: /Pi Heao GUI/.test(r.info || ''), masked: !/sk-[a-zA-Z0-9]{8}/.test(r.info || '') }))`,
      true,
    );
    check(
      "diagnostics info is available",
      diag.ok === true && diag.hasVersion === true,
      JSON.stringify(diag),
    );
    check("diagnostics output masks secrets", diag.masked === true);

    const fontToggle = await win.webContents.executeJavaScript(
      `(async () => {
         const before = getComputedStyle(document.body).backgroundColor;
         const res = await window.pi.invoke('pi:set-theme', 'light');
         const el = document.getElementById('pi-heao-tokens');
         if (el && res && res.css) el.textContent = res.css;
         document.body.classList.add('pi-light');
         await new Promise(r => setTimeout(r, 200));
         const after = getComputedStyle(document.body).backgroundColor;
         await window.pi.invoke('pi:set-theme', 'dark');
         const el2 = document.getElementById('pi-heao-tokens');
         if (el2 && res && res.css) el2.textContent = '';
         document.body.classList.remove('pi-light');
         return { before, after, css: !!(res && res.css && res.css.includes('--pi-bg: #ffffff')) };
       })()`,
      true,
    );
    check(
      "light theme CSS is generated on demand",
      fontToggle.css === true,
      JSON.stringify(fontToggle),
    );

    // ── 5. Rewind diff must render in our own window ───────────────────
    const target = path.join(__dirname, "..", "package.json");
    await win.webContents.executeJavaScript(
      `window.pi.postMessage({ type: 'rewindDiff', absPath: ${JSON.stringify(target)}, baselineHash: null, sessionId: '', basename: 'package.json' })`,
      true,
    );
    let diffWin = null;
    try {
      diffWin = await waitFor(
        () =>
          BrowserWindow.getAllWindows().find((w) => w.id !== win.id && !w.isDestroyed()) || null,
        20_000,
        "diff window",
      );
    } catch {
      diffWin = null;
    }
    check("rewindDiff opens a window instead of the OS default app", !!diffWin);
    if (diffWin) {
      await waitFor(() => !diffWin.webContents.isLoading(), 15_000, "diff load");
      const rows = await diffWin.webContents.executeJavaScript(
        "document.querySelectorAll('.row.add, .row.del').length",
        true,
      );
      const title = await diffWin.webContents.executeJavaScript(
        "(document.querySelector('.title') || {}).textContent || ''",
        true,
      );
      check("diff window names the file", /package\.json/.test(String(title)), String(title));
      check("diff window renders changed lines", rows > 10, `rows=${rows}`);
      diffWin.destroy();
    }

    // —─ 6. Dock: real PTY terminal, file panel, git ──────────────────
    const dock = await win.webContents.executeJavaScript(
      `(async () => {
         if (!window.__piDock) return { missing: true };
         window.__piDock.show('term');
         await new Promise(r => setTimeout(r, 600));
         const deadline = Date.now() + 20000;
         let lines = 0;
         while (Date.now() < deadline) {
           const t = window.__piTerm;
           lines = t && t.buffer && t.buffer.active ? t.buffer.active.length : 0;
           if (lines > 2) break;
           await new Promise(r => setTimeout(r, 300));
         }
         // Read the label only after the terminal is up: the dock writes it at the end of
         // ensureTerm(), which waits on pi:term-open (a 250ms delay in the main process plus the
         // ConPTY spawn), so a fixed 600ms read raced it and reported an empty label while the
         // very next assertion saw real output from the same terminal.
         const meta = document.getElementById('pi-dock-meta').textContent;
         return {
           missing: false,
           visible: !document.getElementById('pi-dock').hidden,
           meta: meta,
           lines: lines,
           hasXterm: !!window.Terminal,
           hasCM: !!window.CodeMirror
         };
       })()`,
      true,
    );
    check("dock opens", !dock.missing && dock.visible, JSON.stringify(dock));
    check("xterm.js and CodeMirror are inlined", dock.hasXterm === true && dock.hasCM === true);
    check("terminal starts the pi TUI", /pi TUI/.test(String(dock.meta)), String(dock.meta));
    check("PTY produces real terminal output", dock.lines > 2, `lines=${dock.lines}`);

    const filesPane = await win.webContents.executeJavaScript(
      `(async () => {
         window.__piDock.show('files');
         await new Promise(r => setTimeout(r, 1500));
         const rowsOf = () => [...document.querySelectorAll('#pi-files-list .pi-files-row')];
         const rootRows = rowsOf().length;
         // The panel lists one level at a time, and a workspace root may hold nothing but
         // directories (this machine's does), so descend until a file is on screen rather than
         // assuming the first listing has one. An empty file would satisfy "a file is selected"
         // while proving nothing, so up to five candidates are tried until one loads content.
         let candidates = [];
         for (let depth = 0; depth < 4 && candidates.length === 0; depth++) {
           candidates = rowsOf().filter(r => r.getAttribute('data-dir') === '0');
           if (candidates.length) break;
           const dir = rowsOf().find(r => r.getAttribute('data-dir') === '1');
           if (!dir) break;
           dir.click();
           await new Promise(r => setTimeout(r, 1200));
         }
         const editor = () => {
           const el = document.querySelector('.CodeMirror');
           return el && el.CodeMirror ? el.CodeMirror : null;
         };
         let opened = false;
         let len = 0;
         for (const row of candidates.slice(0, 5)) {
           row.click();
           await new Promise(r => setTimeout(r, 1200));
           const cm = editor();
           const value = cm ? cm.getValue().length : 0;
           if (value > 0) { opened = true; len = value; break; }
         }
         return {
           rows: rootRows,
           name: document.getElementById('pi-files-name').textContent,
           cm: !!editor(),
           opened: opened,
           len: len,
         };
       })()`,
      true,
    );
    check("file tree lists the workspace", filesPane.rows > 0, `rows=${filesPane.rows}`);
    check("CodeMirror editor is attached", filesPane.cm === true);
    check(
      "opening a file loads its content",
      filesPane.opened === true && filesPane.len > 0 && filesPane.name !== "未打开文件",
      `name=${filesPane.name} chars=${filesPane.len}`,
    );

    const changesPane = await win.webContents.executeJavaScript(
      `(async () => {
         window.__piDock.show('changes');
         await new Promise(r => setTimeout(r, 2500));
         return {
           branch: document.getElementById('pi-git-branch').textContent,
           files: document.querySelectorAll('#pi-git-list .pi-git-file').length,
           hasGenerate: !!document.getElementById('pi-git-generate')
         };
       })()`,
      true,
    );
    check(
      "changes tab answers with a branch or an explicit non-repo note",
      !!changesPane.branch && changesPane.branch !== "git",
      changesPane.branch,
    );
    check("changes tab offers commit-message generation", changesPane.hasGenerate === true);

    // Paste has to land as a native edit, otherwise Ctrl+Z cannot take a pasted
    // block back. This is the discriminating assertion: with the injected
    // capture-phase handler the edit is undoable, while upstream's path rebuilds
    // the composer from a string and leaves nothing on the undo stack.
    const paste = await win.webContents.executeJavaScript(
      `(() => {
         const c = document.getElementById('input');
         if (!c) return { ok: false, why: 'composer missing' };
         const before = c.textContent || '';
         c.focus();
         let dispatched = false;
         try {
           const dt = new DataTransfer();
           dt.setData('text/plain', 'PASTED-BLOCK-MARKER');
           const ev = new ClipboardEvent('paste', {
             clipboardData: dt, bubbles: true, cancelable: true,
           });
           c.dispatchEvent(ev);
           dispatched = true;
         } catch (err) {
           return { ok: false, why: 'cannot synthesise a paste: ' + err.message };
         }
         const inserted = (c.textContent || '').indexOf('PASTED-BLOCK-MARKER') !== -1;
         document.execCommand('undo');
         const restored = (c.textContent || '') === before;
         if (!restored) { c.textContent = before; }
         return { ok: true, dispatched, inserted, restored };
       })()`,
      true,
    );
    check("paste inserts the text", paste.ok && paste.inserted === true, JSON.stringify(paste));
    check(
      "Ctrl+Z takes the paste back in one step",
      paste.restored === true,
      JSON.stringify(paste),
    );

    // ── Navigation guards ──────────────────────────────────────────────
    // The conversation renders model output, and markdown-it turns a bare URL into a real
    // <a href>. Clicking one used to navigate this very window to the remote page -- and Electron
    // injects the preload into every navigation, so that page would have been handed window.pi,
    // whose allowlist includes pi:term-input and pi:fs-write. This is the assertion that the app
    // is still on its own page afterwards.
    const nav = await win.webContents.executeJavaScript(
      `(async () => {
         const before = location.href;
         const click = async (href) => {
           const a = document.createElement('a');
           a.href = href;
           a.textContent = 'link';
           document.body.appendChild(a);
           a.click();
           await new Promise(r => setTimeout(r, 1200));
           const now = location.href;
           a.remove();
           return now;
         };
         const afterExternal = await click('https://example.com/pi-nav-guard');
         // window.open must be refused as well, or a remote page gets a window of ours.
         const opened = window.open('https://example.com/pi-nav-guard-tab', '_blank');
         await new Promise(r => setTimeout(r, 600));
         const afterOpen = location.href;
         // file: is refused too -- and must not be handed to the shell, because pi:open-file
         // validates paths (no executables) and this would be a way around that check.
         const afterFile = await click('file:///C:/Windows/System32/calc.exe');
         return { before, afterExternal, afterOpen, afterFile, opened: opened === null };
       })()`,
      true,
    );
    check(
      "an external link does not navigate the chat window",
      nav.afterExternal === nav.before && nav.afterFile === nav.before,
      JSON.stringify(nav),
    );
    check("window.open cannot spawn a window of ours", nav.opened === true, JSON.stringify(nav));
    check(
      "the window is still on its own page",
      win.webContents.getURL() === nav.before,
      win.webContents.getURL(),
    );

    console.log(`\n--- ${passed}/${passed + failed} feature checks passed ---`);
    app.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    console.error("verify failed:", e?.stack ? e.stack : e);
    app.exit(2);
  }
});
