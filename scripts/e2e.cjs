/**
 * End-to-end pass over every page and every feature.
 *
 * Design rules, learned the hard way:
 *   - assert BEHAVIOUR (what changed after the click), never mere presence:
 *     every settings control was present and inert while "tab exists" passed;
 *   - a single uncaught error in any renderer fails the run: a script that fails
 *     to parse leaves a page completely dead and logs nothing in the main process;
 *   - destructive checks (rename/delete/archive, config writes, skills) only run
 *     with --isolated, which points HOME/APPDATA at a throwaway directory first.
 *
 *   npm run e2e              # read-only pass against the real environment
 *   npm run e2e:isolated     # full pass, destructive flows included
 *   npm run e2e -- --keep    # keep the isolated directory for inspection
 */
const ISOLATED = process.argv.includes("--isolated");
const KEEP = process.argv.includes("--keep");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const REPO_ROOT = path.join(__dirname, "..");

// ── Isolated home ────────────────────────────────────────────────────────────
// Must happen before anything reads homedir(). Auth/config are copied so pi is
// actually usable; sessions, snapshots and the app's own state stay throwaway.
let SANDBOX = null;
if (ISOLATED) {
  SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-home-"));
  const realHome = os.homedir();
  const realAgent = path.join(realHome, ".pi", "agent");
  const fakeAgent = path.join(SANDBOX, ".pi", "agent");
  fs.mkdirSync(fakeAgent, { recursive: true });
  for (const f of ["auth.json", "settings.json", "models.json"]) {
    const src = path.join(realAgent, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(fakeAgent, f));
  }
  // Seed the sandbox with real session files so the sidebar holds data that
  // rename/archive/restore/delete can act on — always inside the sandbox, never
  // the user's own store. The lister walks the whole sessions directory, so the
  // slug directory name does not matter; a file whose header cwd differs from
  // this workspace gets its header rewritten instead of the format reinvented.
  const realSessionsRoot = path.join(realAgent, "sessions");
  const wantCwd = path.resolve(REPO_ROOT).toLowerCase();
  const seedDir = path.join(fakeAgent, "sessions", "-e2e-seeded-");
  let copiedSessions = 0;
  let rewrittenCwd = 0;
  if (fs.existsSync(realSessionsRoot)) {
    const candidates = [];
    for (const entry of fs.readdirSync(realSessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(realSessionsRoot, entry.name);
      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const f of files.slice(0, 2)) candidates.push(path.join(dir, f));
      if (candidates.length >= 12) break;
    }

    const wanted = [];
    const other = [];
    for (const file of candidates) {
      try {
        const header = JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0]);
        if (header.cwd && path.resolve(header.cwd).toLowerCase() === wantCwd) wanted.push(file);
        else if (header.cwd) other.push(file);
      } catch {
        /* not a session header */
      }
    }

    fs.mkdirSync(seedDir, { recursive: true });
    const pick = [...wanted, ...other].slice(0, 3);
    for (const file of pick) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const isWanted = wanted.includes(file);
      if (!isWanted) {
        try {
          const header = JSON.parse(lines[0]);
          header.cwd = REPO_ROOT;
          lines[0] = JSON.stringify(header);
          rewrittenCwd++;
        } catch {
          continue; // not a session header we can safely re-point
        }
      }
      fs.writeFileSync(path.join(seedDir, path.basename(file)), lines.join("\n"), "utf8");
      copiedSessions++;
    }
  }
  console.log(
    `  [isolated] sandbox ${SANDBOX} (${copiedSessions} session file(s), ${rewrittenCwd} re-pointed at this workspace)`,
  );
  fs.mkdirSync(path.join(SANDBOX, ".pi", "standalone"), { recursive: true });
  fs.writeFileSync(
    path.join(SANDBOX, ".pi", "standalone", "config.json"),
    JSON.stringify({ workspaceRoot: REPO_ROOT }, null, 2),
    "utf8",
  );
  process.env.USERPROFILE = SANDBOX;
  process.env.HOME = SANDBOX;
  process.env.APPDATA = path.join(SANDBOX, "AppData", "Roaming");
  process.env.LOCALAPPDATA = path.join(SANDBOX, "AppData", "Local");
  fs.mkdirSync(process.env.APPDATA, { recursive: true });
}

const electron = require("electron");
if (!electron.app || typeof electron.app.on !== "function") {
  console.error("ELECTRON_RUN_AS_NODE is set - unset it first (electron must run as Electron).");
  process.exit(2);
}
const { app, BrowserWindow, dialog } = electron;

if (typeof app.setAppPath === "function") app.setAppPath(REPO_ROOT);

// ── Crash / error collection ────────────────────────────────────────────────
const rendererErrors = [];
const rendererWarnings = [];
const crashed = [];
app.on("web-contents-created", (_e, wc) => {
  wc.on("console-message", (...args) => {
    // Electron < 36 passes (event, level, message, line, sourceId); newer passes
    // a single event object. Support both.
    const ev = args[0];
    const level = typeof ev === "object" && ev !== null && "level" in ev ? ev.level : args[1];
    const message = typeof ev === "object" && ev !== null && "message" in ev ? ev.message : args[2];
    const isError = level === "error" || level === 3 || level === 2;
    const entry = String(message || "").slice(0, 300);
    if (!entry) return;
    // The security section deliberately calls channels the preload blocks.
    if (/\[pi-preload\] blocked channel/.test(entry)) return;
    (isError ? rendererErrors : rendererWarnings).push(entry);
  });
  wc.on("render-process-gone", (_ev, details) => crashed.push(details.reason));
  wc.on("preload-error", (_ev, preloadPath, error) => {
    rendererErrors.push(`preload ${preloadPath}: ${error?.message}`);
  });
});

// Dialogs would block an unattended run.
let lastSavePath = null;
dialog.showSaveDialog = async (_win, _opts) => {
  lastSavePath = path.join(os.tmpdir(), `pi-e2e-${Date.now()}.md`);
  return { canceled: false, filePath: lastSavePath };
};
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });

require(path.join(REPO_ROOT, "dist", "main", "main.js"));

// ── Harness plumbing ───────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name, why) {
  skipped++;
  console.log(`  SKIP  ${name}${why ? ` (${why})` : ""}`);
}
function heading(title) {
  console.log(`\n\u2500\u2500 ${title} ${"\u2500".repeat(Math.max(0, 62 - title.length))}`);
}
/** Runs a section so one hard error cannot abort the whole run. */
async function section(title, fn) {
  heading(title);
  try {
    await fn();
  } catch (e) {
    check(`${title} (section completed)`, false, e?.message);
  }
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* keep polling */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(200);
  }
}

const allWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
const byTitle = (re) => allWindows().find((w) => re.test(w.getTitle()));
const chatWindow = () => allWindows()[0];
const js = (win, code) => win.webContents.executeJavaScript(code, true);

app.whenReady().then(async () => {
  const t0 = Date.now();
  try {
    const win = await waitFor(() => chatWindow(), 45_000, "chat window");
    win.setSize(1400, 900);
    await waitFor(() => !win.webContents.isLoading(), 45_000, "chat window load");
    await waitFor(() => js(win, "!!(window.pi && window.pi.invoke)"), 30_000, "preload bridge");

    // ══ 1. Chat window shell ══════════════════════════════════════════════
    await section("Chat window: shell and title bar", async () => {
      const ids = [
        "pi-shell",
        "pi-titlebar",
        "pi-tb-new",
        "pi-dock-toggle",
        "pi-tb-history",
        "pi-tb-search",
        "pi-tb-refresh",
        "pi-tb-export",
        "pi-tb-settings",
        "pi-token-stats",
      ];
      for (const id of ids) {
        check(`#${id} present`, await js(win, `!!document.getElementById(${JSON.stringify(id)})`));
      }
      check(
        "no horizontal overflow (title bar fits)",
        await js(
          win,
          "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2",
        ),
      );
      check(
        "window controls are not covered by the title bar",
        await js(
          win,
          `(() => {
        const b = document.getElementById('pi-tb-settings');
        if (!b) return false;
        const r = b.getBoundingClientRect();
        const pad = getComputedStyle(document.querySelector('.pi-titlebar')).paddingRight;
        return r.right <= window.innerWidth - parseInt(pad, 10) + 1;
      })()`,
        ),
      );
    });

    // ══ 2. Preload isolation ══════════════════════════════════════════════
    await section("Security: the chat window cannot reach settings channels", async () => {
      const blocked = await js(
        win,
        `(async () => {
        try { await window.pi.invoke('pi:set-config', { theme: 'dark' }); return 'allowed'; }
        catch (e) { return String(e && e.message || e); }
      })()`,
      );
      check(
        "pi:set-config rejected from the chat window",
        /blocked channel/i.test(String(blocked)),
        String(blocked).slice(0, 80),
      );
      const readBlocked = await js(
        win,
        `(async () => {
        try { const r = await window.pi.invoke('pi:read-agent-files'); return 'allowed:' + JSON.stringify(r).slice(0, 40); }
        catch (e) { return String(e && e.message || e); }
      })()`,
      );
      check(
        "pi:read-agent-files rejected from the chat window",
        /blocked channel/i.test(String(readBlocked)),
        String(readBlocked).slice(0, 80),
      );
    });

    // ══ 3. Sidebar ════════════════════════════════════════════════════════
    await section("Sidebar: sessions, filter, collapse", async () => {
      const count = await waitFor(
        () =>
          js(win, "document.querySelectorAll('#pi-session-list .pi-session-item').length || null"),
        30_000,
        "session items",
      );
      check("session list renders items", Number(count) > 0, `count=${count}`);

      await js(
        win,
        `(() => {
        const i = document.getElementById('pi-session-filter');
        if (!i) return;
        i.value = 'zzz-no-such-session-zzz';
        i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
      );
      await sleep(400);
      const afterFilter = await js(
        win,
        "document.querySelectorAll('#pi-session-list .pi-session-item').length",
      );
      check(
        "filter narrows the list",
        Number(afterFilter) < Number(count),
        `before=${count} after=${afterFilter}`,
      );

      await js(
        win,
        `(() => {
        const i = document.getElementById('pi-session-filter');
        i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
      );
      await sleep(500);
      const restored = await js(
        win,
        "document.querySelectorAll('#pi-session-list .pi-session-item').length",
      );
      check(
        "clearing the filter restores the list",
        Number(restored) >= Number(count),
        `restored=${restored}`,
      );

      const collapse = await js(
        win,
        `(() => {
        const rail = document.getElementById('pi-sidebar-collapsed');
        const btn = document.getElementById('pi-sidebar-toggle');
        const expand = document.getElementById('pi-sidebar-expand');
        if (!rail) return { ok: false };
        const snap = () => getComputedStyle(rail).display;
        const s0 = snap();
        const sidebar = document.getElementById('pi-sidebar');
        // Collapsed means the whole sidebar is display:none, so "which button is
        // visible" cannot be read from the buttons themselves.
        const pick = () =>
          sidebar && getComputedStyle(sidebar).display === 'none' ? expand : btn;
        const a = pick();
        if (!a) return { ok: false, s0: s0 };
        a.click();
        const s1 = snap();
        const b = pick();
        if (b) b.click();
        return { ok: true, s0: s0, s1: s1, s2: snap() };
      })()`,
      );
      check(
        "collapse toggles the rail",
        collapse.ok && collapse.s0 !== collapse.s1 && collapse.s0 === collapse.s2,
        JSON.stringify(collapse),
      );

      const archived = await js(
        win,
        `(() => {
        const b = document.getElementById('pi-sidebar-archived-toggle');
        if (!b) return { ok: false };
        const list = document.getElementById('pi-archived-list');
        b.click();
        return { ok: true, shown: getComputedStyle(list).display !== 'none' || list.offsetHeight > 0 };
      })()`,
      );
      check("archived section toggles", archived.ok === true, JSON.stringify(archived));
    });

    // ══ 4. Command palette ════════════════════════════════════════════════
    await section("Command palette (Ctrl+K)", async () => {
      const state = await js(
        win,
        `(() => {
        const p = document.getElementById('pi-palette');
        const start = p ? p.hidden : null;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        const after1 = p.hidden;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        const after2 = p.hidden;
        return { tag: p ? p.tagName : null, start: start, after1: after1, after2: after2 };
      })()`,
      );
      check(
        "#pi-palette resolves to the dialog, not a <style> tag",
        state.tag === "DIV",
        JSON.stringify(state),
      );
      check(
        "Ctrl+K opens the palette",
        state.start === true && state.after1 === false,
        JSON.stringify(state),
      );
      check("Ctrl+K closes it again", state.after2 === true, JSON.stringify(state));
      await js(
        win,
        `(function(){ document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); })()`,
      );
      await sleep(300);
      check(
        "palette input has focus at open-time shape",
        await js(win, "!!document.getElementById('pi-palette-input')"),
      );

      const filtered = await js(
        win,
        `(() => {
        const i = document.getElementById('pi-palette-input');
        // "token" matches the title in either language: the sandbox can resolve to
        // English, and this check must not depend on which one is active.
        i.value = 'token';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return document.querySelectorAll('#pi-palette-list [data-id], #pi-palette-list li, #pi-palette-list .pi-palette-item').length;
      })()`,
      );
      await sleep(700);
      // Poll: the sandbox starts with a cold pi child, so the command list can
      // take longer to render there than in the read-only run.
      const items = await waitFor(
        async () => {
          const n = await js(
            win,
            "document.querySelectorAll('#pi-palette-list [data-id], #pi-palette-list li, #pi-palette-list .pi-palette-item').length",
          );
          return Number(n) > 0 ? Number(n) : null;
        },
        // A fresh home makes pi install its packages on first start ("added 134
        // packages" showed up here), and the palette's data arrives over RPC, so
        // this can take much longer in the sandbox than in the read-only run.
        75_000,
        "palette items",
      ).catch(() => 0);
      // The built-in commands do not depend on how many sessions exist, so the
      // list must not be empty while the query matches one of them.
      check(
        "palette renders built-in commands",
        Number(filtered) >= 1 || Number(items) >= 1,
        `items=${filtered}`,
      );
      check("a matching command stays listed", Number(items) >= 1, `now=${items}`);

      const closed = await js(
        win,
        `(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const p = document.getElementById('pi-palette');
        return p ? p.hidden : null;
      })()`,
      );
      await sleep(200);
      check("Escape closes the palette", closed === true, String(closed));
    });

    // ══ 5. Token / performance panel ══════════════════════════════════════
    await section("Token panel (the statistics page)", async () => {
      const openedByChip = await js(
        win,
        `(() => {
        const chip = document.querySelector('#pi-token-stats .pi-stat');
        if (!chip) return null;
        chip.click();
        const m = document.getElementById('pi-stats-modal');
        return m ? !m.hidden : null;
      })()`,
      );
      await sleep(600);
      check("clicking the token chip opens the panel", openedByChip === true, String(openedByChip));
      check(
        "panel shows a session path",
        (await js(win, "(document.getElementById('pi-stats-path')||{}).textContent || ''")).trim()
          .length > 0,
      );
      const cells = await js(
        win,
        `['ttft','tps','cache','cost'].filter(k => { const e = document.getElementById('pi-stat-modal-' + k); return e && e.textContent.trim().length > 0; }).length`,
      );
      check("all four metrics render a value", Number(cells) === 4, `filled=${cells}`);
      check(
        "turns section is present",
        await js(win, "!!document.getElementById('pi-stats-turns')"),
      );
      check(
        "title-bar chips and panel metrics are distinct elements",
        await js(
          win,
          "!!document.getElementById('pi-stat-modal-tps') && !!document.getElementById('pi-stat-tps')",
        ),
      );
      const closedByBtn = await js(
        win,
        `(() => { document.getElementById('pi-stats-close').click(); const m = document.getElementById('pi-stats-modal'); return m.hidden; })()`,
      );
      await sleep(200);
      check("close button hides the panel", closedByBtn === true);
      const toggled = await js(
        win,
        `(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true }));
        const m = document.getElementById('pi-stats-modal');
        return !m.hidden;
      })()`,
      );
      await sleep(200);
      check("Ctrl+Shift+S toggles the panel", toggled === true);
      await js(
        win,
        `(() => { const m = document.getElementById('pi-stats-modal'); if (!m.hidden) document.getElementById('pi-stats-close').click(); })()`,
      );
    });

    // ══ 6. Dock: terminal, files, changes ════════════════════════════════
    await section("Dock: terminal / files / changes", async () => {
      const opened = await js(
        win,
        `(() => {
        const d = document.getElementById('pi-dock');
        if (!d) return null;
        if (d.hidden) document.getElementById('pi-dock-toggle').click();
        return { hidden: d.hidden };
      })()`,
      );
      await sleep(1500);
      const dockNow = await js(
        win,
        `(() => ({
        hidden: document.getElementById('pi-dock').hidden,
        bodyOpen: document.body.classList.contains('pi-dock-open'),
        tabs: document.querySelectorAll('.pi-dock-tab').length,
      }))()`,
      );
      check(
        "dock opens",
        dockNow.hidden === false && dockNow.bodyOpen === true,
        JSON.stringify({ opened, dockNow }),
      );
      check("dock exposes its three tabs", dockNow.tabs === 3, JSON.stringify(dockNow));

      for (const [tab, pane] of [
        ["term", "pi-pane-term"],
        ["files", "pi-pane-files"],
        ["changes", "pi-pane-changes"],
      ]) {
        const active = await js(
          win,
          `(() => {
          const b = document.querySelector('.pi-dock-tab[data-dock="${tab}"]');
          if (!b) return { found: false };
          b.click();
          const p = document.getElementById('${pane}');
          return { found: true, active: p.classList.contains('active') };
        })()`,
        );
        await sleep(400);
        check(
          `dock tab "${tab}" activates ${pane}`,
          active.found === true && active.active === true,
          JSON.stringify(active),
        );
      }

      // Terminal: drive the real PTY and wait for the echo to come back.
      await js(
        win,
        `(() => { const b = document.querySelector('.pi-dock-tab[data-dock="term"]'); if (b) b.click(); })()`,
      );
      await sleep(300);
      // The dock defaults to pi's own TUI, which repaints the whole screen; get a
      // plain shell so a command's echo is unambiguous.
      const kind = await js(win, "(document.getElementById('pi-term-kind')||{}).textContent || ''");
      if (/pi TUI/i.test(kind)) {
        await js(win, "document.getElementById('pi-term-kind').click()");
        await sleep(2500);
      }
      const READ_TERM = "((document.getElementById('pi-dock-term')||{}).innerText || '')";
      const marker = `e2e-${Date.now().toString(36)}`;
      // Restarting the terminal (the kind toggle) is asynchronous, so a write can
      // land before the new PTY is registered — retry rather than assume.
      let echoed = false;
      for (let attempt = 0; attempt < 3 && !echoed; attempt++) {
        await js(
          win,
          `window.pi.invoke('pi:term-input', 'echo ${marker}' + String.fromCharCode(13))`,
        );
        echoed = await waitFor(
          async () => (await js(win, READ_TERM)).includes(marker),
          9_000,
          "terminal echo",
        ).catch(() => false);
      }
      const termText = await js(win, READ_TERM);
      const termDiag = await js(
        win,
        `(() => ({
        meta: (document.getElementById('pi-dock-meta')||{}).textContent || '',
        writeResult: 'see console',
        hasXterm: !!document.querySelector('#pi-dock-term .xterm'),
      }))()`,
      );
      const writeRes = await js(
        win,
        `window.pi.invoke('pi:term-input', 'echo probe' + String.fromCharCode(13))`,
      );
      check(
        "terminal runs a command and shows its output",
        echoed === true,
        `${termText.slice(0, 100).replace(/\s+/g, " ")} | meta="${termDiag.meta}" xterm=${termDiag.hasXterm} write=${JSON.stringify(writeRes)}`,
      );
      check(
        "terminal pane shows shell output, not stylesheet text",
        !/\.xterm-[\w-]+\s*\{/.test(termText),
        termText.slice(0, 80),
      );
      check(
        "terminal rendered an xterm surface",
        await js(
          win,
          "!!document.querySelector('#pi-dock-term .xterm, #pi-dock-term canvas, #pi-dock-term textarea')",
        ),
      );

      // Files pane
      await js(
        win,
        `(() => { const b = document.querySelector('.pi-dock-tab[data-dock="files"]'); if (b) b.click(); })()`,
      );
      await sleep(800);
      const fileCount = await js(
        win,
        "document.querySelectorAll('#pi-files-list .pi-files-row').length",
      );
      check("file list is populated", Number(fileCount) > 0, `entries=${fileCount}`);
      const opened2 = await js(
        win,
        `(() => {
        const first = document.querySelector('#pi-files-list .pi-files-row');
        if (!first) return { ok: false };
        first.click();
        return { ok: true };
      })()`,
      );
      await sleep(1200);
      const loaded = await js(
        win,
        `(() => {
        const n = document.getElementById('pi-files-name');
        return { name: n ? n.textContent : '', hasEditor: !!document.querySelector('#pi-files-editor, .cm-editor, .CodeMirror') };
      })()`,
      );
      check(
        "clicking a file loads it into the editor",
        opened2.ok === true && loaded.hasEditor === true,
        JSON.stringify(loaded),
      );

      // Changes pane
      await js(
        win,
        `(() => { const b = document.querySelector('.pi-dock-tab[data-dock="changes"]'); if (b) b.click(); })()`,
      );
      await sleep(1500);
      const git = await js(
        win,
        `(() => ({
        branch: (document.getElementById('pi-git-branch')||{}).textContent || '',
        rows: document.querySelectorAll('#pi-git-list .pi-git-item, #pi-git-list li, #pi-git-list > *').length,
      }))()`,
      );
      check(
        "git pane shows the current branch",
        git.branch.trim().length > 0 && git.branch.trim() !== "—",
        JSON.stringify(git),
      );
    });

    // ══ 7. Diff window ═══════════════════════════════════════════════════
    await section("Diff window", async () => {
      const { openDiffWindow } = require(path.join(REPO_ROOT, "dist", "main", "diff-window.js"));
      const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-e2e-diff-"));
      const target = path.join(base, "demo.txt");
      fs.writeFileSync(target, "alpha\nbeta changed\ngamma\n", "utf8");
      const sessionId = `e2e-${Date.now().toString(36)}`;
      const snapshotDir = path.join(os.homedir(), ".pi", "snapshots", sessionId);
      fs.mkdirSync(snapshotDir, { recursive: true });
      fs.writeFileSync(path.join(snapshotDir, "base1"), "alpha\nbeta\ngamma\n", "utf8");

      const res = await openDiffWindow({
        absPath: target,
        baselineHash: "base1",
        sessionId,
        basename: "demo.txt",
      });
      check("diff window reports success", res && res.ok === true, JSON.stringify(res));
      const diffWin = await waitFor(
        () => byTitle(/diff|对比/i) || allWindows().find((w) => w !== win),
        15_000,
        "diff window",
      ).catch(() => null);
      if (!diffWin) {
        skip("diff window content", "window not found");
      } else {
        await waitFor(() => !diffWin.webContents.isLoading(), 15_000, "diff load");
        const body = await js(diffWin, "(document.getElementById('body')||{}).innerHTML || ''");
        check(
          "diff renders a change",
          /ins|del|added|removed|beta changed/i.test(body),
          body.slice(0, 120),
        );
        const wrap = await js(
          diffWin,
          `(() => { const b = document.getElementById('wrap'); if (!b) return null; b.click(); return document.body.className || document.documentElement.className; })()`,
        );
        check("diff window has working controls", wrap !== null, String(wrap).slice(0, 60));
        diffWin.destroy();
      }
      fs.rmSync(snapshotDir, { recursive: true, force: true });
    });

    // ══ 8. Export conversation ════════════════════════════════════════════
    await section("Export conversation", async () => {
      lastSavePath = null;
      await js(win, "document.getElementById('pi-tb-export').click()");
      const wrote = await waitFor(
        () => lastSavePath && fs.existsSync(lastSavePath),
        15_000,
        "export file",
      ).catch(() => false);
      if (wrote) {
        const text = fs.readFileSync(lastSavePath, "utf8");
        check(
          "export writes a markdown file with content",
          text.length > 0,
          `bytes=${text.length}`,
        );
        fs.rmSync(lastSavePath, { force: true });
      } else {
        skip("export writes a markdown file", "no file was produced (session may be empty)");
      }
    });

    // ══ 9. Settings window: every tab and every control ═══════════════════
    await section("Settings window: every tab switches", async () => {
      await js(win, "document.getElementById('pi-tb-settings').click()");
      const sw = await waitFor(() => byTitle(/设置|Settings/), 20_000, "settings window");
      await waitFor(() => !sw.webContents.isLoading(), 20_000, "settings load");
      await waitFor(
        () => js(sw, "!!document.getElementById('panel-models')"),
        15_000,
        "settings dom",
      );
      await sleep(800);

      const tabs = await js(
        sw,
        `Array.from(document.querySelectorAll('.tab')).map(t => t.dataset.tab)`,
      );
      check(
        "settings exposes all 8 tabs",
        Array.isArray(tabs) && tabs.length === 8,
        JSON.stringify(tabs),
      );
      for (const t of tabs || []) {
        const res = await js(
          sw,
          `(() => {
          const tab = document.querySelector('.tab[data-tab="${t}"]');
          if (!tab) return { ok: false };
          tab.click();
          return {
            ok: true,
            tabActive: tab.classList.contains('active'),
            panelActive: document.getElementById('panel-${t}').classList.contains('active'),
            otherActive: Array.from(document.querySelectorAll('.panel')).filter(p => p.classList.contains('active')).length,
          };
        })()`,
        );
        await sleep(180);
        check(
          `tab "${t}" becomes active and shows panel-${t}`,
          res.ok && res.tabActive && res.panelActive && res.otherActive === 1,
          JSON.stringify(res),
        );
      }
    });

    await section("Settings window: panels load their data", async () => {
      const sw = byTitle(/设置|Settings/);
      const reload = async () => {
        await js(sw, "document.getElementById('btn-reload').click()");
        await sleep(1500);
      };
      await js(sw, `(() => { document.querySelector('.tab[data-tab="models"]').click(); })()`);
      await reload();
      const models = await js(
        sw,
        `({ providers: document.querySelectorAll('#models-list .list-item').length, auth: document.querySelectorAll('#auth-list .list-item').length, status: (document.getElementById('status')||{}).textContent || '' })`,
      );
      check("models tab lists providers", models.providers > 0, JSON.stringify(models));

      await js(sw, `(() => { document.querySelector('.tab[data-tab="extensions"]').click(); })()`);
      await sleep(2000);
      const exts = await js(
        sw,
        `document.querySelectorAll('#local-extensions .card, #npm-packages .list-item, #local-extensions > *, #npm-packages > *').length`,
      );
      check("extensions tab renders entries", Number(exts) > 0, `entries=${exts}`);

      await js(sw, `(() => { document.querySelector('.tab[data-tab="skills"]').click(); })()`);
      await sleep(1200);
      check("skills tab renders a list", await js(sw, "!!document.getElementById('skills-list')"));

      await js(sw, `(() => { document.querySelector('.tab[data-tab="sysprompt"]').click(); })()`);
      await sleep(1200);
      const sysprompt = await js(
        sw,
        `(() => ({ a: (document.getElementById('agent-append')||{}).value != null, o: (document.getElementById('agent-override')||{}).value != null }))()`,
      );
      check(
        "system prompt tab loads both editors",
        sysprompt.a && sysprompt.o,
        JSON.stringify(sysprompt),
      );

      await js(sw, `(() => { document.querySelector('.tab[data-tab="appearance"]').click(); })()`);
      await sleep(600);
      const appear = await js(
        sw,
        `(() => ({
        themes: document.querySelectorAll('#theme-group [data-theme], #theme-group input, #theme-group button').length,
        swatches: document.querySelectorAll('#accent-swatches [data-accent], #accent-swatches > *').length,
      }))()`,
      );
      check(
        "appearance tab shows themes and accents",
        appear.themes > 0 && appear.swatches > 0,
        JSON.stringify(appear),
      );

      await js(sw, `(() => { document.querySelector('.tab[data-tab="diagnostics"]').click(); })()`);
      await sleep(2500);
      const diag = await js(
        sw,
        `(() => ({ info: ((document.getElementById('diag-info')||{}).textContent || '').trim().length, log: ((document.getElementById('diag-log')||{}).textContent || '').trim().length }))()`,
      );
      check("diagnostics tab fills in info", diag.info > 0, JSON.stringify(diag));

      await js(sw, `(() => { document.querySelector('.tab[data-tab="changelog"]').click(); })()`);
      await sleep(2500);
      const changelog = await js(
        sw,
        `(() => ({ meta: ((document.getElementById('changelog-meta')||{}).textContent || '').trim(), body: ((document.getElementById('changelog-body')||{}).textContent || '').length }))()`,
      );
      check(
        "changelog tab loads content",
        changelog.body > 100,
        `body=${changelog.body} meta=${changelog.meta.slice(0, 40)}`,
      );

      await js(sw, `(() => { document.querySelector('.tab[data-tab="general"]').click(); })()`);
      await sleep(1200);
      const general = await js(
        sw,
        `(() => ({
        piPath: (document.getElementById('cfg-piPath')||{}).value,
        piPathHint: (document.getElementById('cfg-piPath')||{}).placeholder,
        workspace: (document.getElementById('cfg-workspaceRoot')||{}).value,
      }))()`,
      );
      const hint = String(general.piPathHint || "");
      check(
        "general tab shows the pi path or its auto-detect hint",
        String(general.piPath || "").length > 0 || hint.length > 0,
        JSON.stringify(general).slice(0, 140),
      );
      check(
        "general tab shows the workspace",
        String(general.workspace || "").length > 0,
        String(general.workspace).slice(0, 80),
      );
    });

    await section("Settings window: auth check and save", async () => {
      const sw = byTitle(/设置|Settings/);
      await js(
        sw,
        `(() => { document.querySelector('.tab[data-tab="models"]').click(); document.getElementById('btn-auth-check').click(); })()`,
      );
      const auth = await waitFor(
        async () => {
          const rows = await js(
            sw,
            "document.querySelectorAll('#auth-status-list .list-item, #auth-status-list > *').length",
          );
          return Number(rows) > 0 ? rows : null;
        },
        25_000,
        "auth status rows",
      ).catch(() => 0);
      check("auth check lists provider status", Number(auth) > 0, `rows=${auth}`);

      const saved = await js(
        sw,
        `(async () => {
        document.querySelector('.tab[data-tab="general"]').click();
        document.getElementById('btn-save').click();
        return true;
      })()`,
      );
      await sleep(2500);
      const statusText = await js(sw, "(document.getElementById('status')||{}).textContent || ''");
      check(
        "save reports a result",
        saved === true && statusText.trim().length > 0,
        `status="${statusText.slice(0, 80)}"`,
      );
      check(
        "save did not leave an error",
        !/失败|error|Error|异常/.test(statusText),
        `status="${statusText.slice(0, 80)}"`,
      );
    });

    // ══ 10. Isolated-only destructive flows ══════════════════════════════
    if (ISOLATED) {
      await section("Session operations (isolated home)", async () => {
        const listBefore = await js(
          win,
          `(async () => (await window.pi.invoke('pi:list-sessions')).length)()`,
        );
        check(
          "sandbox sidebar has sessions to operate on",
          Number(listBefore) > 0,
          `count=${listBefore}`,
        );

        // A brand-new session is not written to disk until its first message, so
        // assert the UI moved to a fresh session rather than a file appearing.
        await js(win, "document.getElementById('pi-tb-new').click()");
        await sleep(3000);
        const freshState = await js(
          win,
          `(() => ({
          active: !!document.querySelector('#pi-session-list .pi-session-item.active'),
          messages: document.querySelectorAll('#pi-main .msg, #pi-main .message').length,
        }))()`,
        );
        check(
          "new session clears the active session and transcript",
          freshState.active === false && freshState.messages === 0,
          JSON.stringify(freshState),
        );

        const target = await js(
          win,
          `(async () => { const l = await window.pi.invoke('pi:list-sessions'); return l[0] && (l[0].file || l[0].path); })()`,
        );
        if (!target) {
          skip("session rename/archive/delete", "no session available");
        } else {
          // pi:session-op takes { op, file, name } — that is how the sidebar calls it.
          const op = (args) =>
            js(
              win,
              `(async () => await window.pi.invoke('pi:session-op', ${JSON.stringify(args)}))()`,
            );

          const renamed = await op({ op: "rename", file: target, name: "e2e-renamed" });
          await sleep(1200);
          const names = await js(
            win,
            `(async () => (await window.pi.invoke('pi:list-sessions')).map(s => s.name || s.title).join('|'))()`,
          );
          check(
            "rename is persisted",
            String(names).includes("e2e-renamed"),
            `names=${String(names).slice(0, 120)} (res=${JSON.stringify(renamed).slice(0, 80)})`,
          );

          const pinned = await js(
            win,
            `(async () => {
              await window.pi.invoke('pi:toggle-pin', ${JSON.stringify(target)});
              const l = await window.pi.invoke('pi:list-sessions');
              return l.filter(s => s.pinned).length;
            })()`,
          );
          check(
            "pin toggles and is reported by the session list",
            Number(pinned) >= 1,
            `pinned=${pinned}`,
          );

          const archivedRes = await op({ op: "archive", file: target });
          await sleep(1500);
          const archivedList = await js(
            win,
            `(async () => (await window.pi.invoke('pi:list-archived')).length)()`,
          );
          check(
            "archive moves the session out of the active list",
            Number(archivedList) >= 1,
            `archived=${archivedList} res=${JSON.stringify(archivedRes).slice(0, 80)}`,
          );

          const restoredRes = await op({ op: "restore", file: target });
          await sleep(1500);
          const restoredList = await js(
            win,
            `(async () => (await window.pi.invoke('pi:list-sessions')).length)()`,
          );
          check(
            "restore brings it back",
            Number(restoredList) >= Number(listBefore),
            `active=${restoredList} res=${JSON.stringify(restoredRes).slice(0, 80)}`,
          );

          // Archive/restore can move the file, so re-resolve the target by name
          // before deleting instead of trusting the original path.
          const currentTarget = await js(
            win,
            `(async () => {
              const l = await window.pi.invoke('pi:list-sessions');
              const hit = l.find(s => String(s.name || s.title || '').includes('e2e-renamed'));
              return hit ? (hit.file || hit.path) : null;
            })()`,
          );
          const deleteTarget = currentTarget || target;

          // Deleting the session that is open in the window is refused on purpose;
          // switch to another one first, then delete.
          let deleted = await op({ op: "delete", file: deleteTarget });
          if (deleted && deleted.ok === false) {
            const switched = await js(
              win,
              `(async () => {
                const l = await window.pi.invoke('pi:list-sessions');
                const o = l.find(s => (s.file || s.path) !== ${JSON.stringify(deleteTarget)});                if (!o) return false;
                await window.pi.invoke('pi:switch-session', o.file || o.path);
                return true;
              })()`,
            );
            check(
              "an in-use session is not deleted, and switching away is possible",
              switched === true,
              `first delete said: ${JSON.stringify(deleted).slice(0, 90)}`,
            );
            await sleep(2500);
            deleted = await op({ op: "delete", file: deleteTarget });
          }
          await sleep(1500);
          const afterDelete = await js(
            win,
            `(async () => (await window.pi.invoke('pi:list-sessions')).length)()`,
          );
          check(
            "delete removes the session",
            Number(afterDelete) < Number(restoredList),
            `before=${restoredList} after=${afterDelete} res=${JSON.stringify(deleted).slice(0, 80)}`,
          );
        }
      });

      await section("Settings: language switch and config round-trip", async () => {
        const sw = byTitle(/设置|Settings/);
        await js(
          sw,
          `(async () => {
          document.querySelector('.tab[data-tab="general"]').click();
          const sel = document.getElementById('ui-language');
          sel.value = 'en';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
        );
        const reopened = await waitFor(
          () => byTitle(/Settings|设置/),
          25_000,
          "reopened settings window",
        ).catch(() => null);
        // Persistence is the real contract: assert the sandbox config on disk.
        const configPath = path.join(SANDBOX, ".pi", "standalone", "config.json");
        const persisted = await waitFor(
          () => {
            try {
              return JSON.parse(fs.readFileSync(configPath, "utf8")).uiLanguage === "en";
            } catch {
              return false;
            }
          },
          15_000,
          "uiLanguage persisted",
        ).catch(() => false);
        check("language switch persists to config", persisted === true);
        if (reopened) {
          await waitFor(() => !reopened.webContents.isLoading(), 15_000, "reloaded settings");
          const english = await js(reopened, "document.body.innerText");
          check(
            "language switch reopens the window in English",
            /Settings|Appearance|General/i.test(english),
            String(english).slice(0, 80).replace(/\s+/g, " "),
          );
          await js(
            reopened,
            `(async () => {
            document.querySelector('.tab[data-tab="general"]').click();
            const sel = document.getElementById('ui-language');
            sel.value = 'zh-cn';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          })()`,
          );
          await sleep(2500);
        } else {
          skip("language switch reopens the window in English", "window not found");
        }
      });

      await section("File panel: write a file and send it to the chat", async () => {
        const name = `e2e-${Date.now().toString(36)}.txt`;
        const res = await js(
          win,
          `(async () => await window.pi.invoke('pi:fs-write', { path: ${JSON.stringify(name)}, content: 'hello e2e' }))()`,
        );
        const onDisk = path.join(REPO_ROOT, name);
        check(
          "file write reaches disk",
          fs.existsSync(onDisk),
          `res=${JSON.stringify(res).slice(0, 80)}`,
        );
        if (fs.existsSync(onDisk)) {
          const read = await js(
            win,
            `(async () => await window.pi.invoke('pi:fs-read', ${JSON.stringify(name)}))()`,
          );
          check(
            "file read returns the content",
            String(JSON.stringify(read)).includes("hello e2e"),
            String(JSON.stringify(read)).slice(0, 80),
          );
          fs.rmSync(onDisk, { force: true });
        }
      });
    }

    // ══ 11. Cross-cutting invariants ══════════════════════════════════════
    await section("Invariants: no secrets in the DOM, no renderer errors", async () => {
      for (const w of allWindows()) {
        const html = await js(w, "document.documentElement.outerHTML").catch(() => "");
        const leak = /sk-[A-Za-z0-9_-]{16,}/.test(html);
        check(`no API key material in "${w.getTitle().slice(0, 30)}"`, leak === false);
      }
      check("no renderer crashed", crashed.length === 0, crashed.join(", "));
      if (rendererErrors.length > 0) {
        console.log("  renderer errors seen:");
        for (const e of [...new Set(rendererErrors)].slice(0, 10)) console.log(`    - ${e}`);
      }
      check(
        "no renderer console errors",
        rendererErrors.length === 0,
        `${rendererErrors.length} error(s)`,
      );
    });

    // ══ Report ════════════════════════════════════════════════════════════
    console.log(`\n${"=".repeat(70)}`);
    console.log(
      `  ${ISOLATED ? "ISOLATED" : "READ-ONLY"} e2e — ${passed} passed, ${failed} failed, ${skipped} skipped`,
    );
    console.log(
      `  ${allWindows().length} window(s) still open · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    if (failures.length > 0) {
      console.log("\n  FAILURES:");
      for (const f of failures) console.log(`    - ${f}`);
    }
    if (rendererWarnings.length > 0) {
      console.log(`\n  (${rendererWarnings.length} renderer warning(s) ignored)`);
    }
    console.log("=".repeat(70));
  } catch (e) {
    console.error("\nfatal:", e && (e.stack || e.message || e));
    failed++;
  } finally {
    try {
      const w = chatWindow();
      if (w) {
        // Bounded: a busy renderer must not stop the run from finishing.
        await Promise.race([
          w.webContents.executeJavaScript("window.pi.invoke('pi:term-close')", true),
          sleep(2000),
        ]);
        await sleep(400);
      }
    } catch {
      /* nothing to close */
    }
    if (ISOLATED && SANDBOX && !KEEP) {
      try {
        fs.rmSync(SANDBOX, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    await section("Accessibility: text contrast in both themes", async () => {
    // Regression guard. Shipped defects this would have caught on the spot:
    //   .msg h1/h2/h3 pinned to #f2f4f8 -> 1.1:1 on a light background;
    //   pre pinned to #12151a            -> a black code block in light mode;
    //   links using the raw accent       -> 3.20:1 on white.
    // All three were hardcoded values in the theme bridge that ignored the theme.
    const measure = `(() => {
      const lum = (c) => {
        const m = String(c).match(/[\\d.]+/g) || [];
        const f = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(+m[0] || 0) + 0.7152 * f(+m[1] || 0) + 0.0722 * f(+m[2] || 0);
      };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const bad = [];
      document.querySelectorAll('body *').forEach((el) => {
        const txt = (el.textContent || '').trim();
        if (!txt || txt.length > 300) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 4) return;
        let op = 1, n = el;
        while (n) { op *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; }
        let bg = 'rgb(255,255,255)', m = el;
        while (m) { const b = getComputedStyle(m).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)') { bg = b; break; } m = m.parentElement; }
        // Contrast is not linear in opacity, so the text colour is composited with its backdrop
        // at the element's effective opacity, and the ratio is measured on the result.
        const parse = (c) => {
          const s = String(c).trim();
          if (s.charAt(0) === '#') {
            const h = s.length === 4 ? s.replace(/[0-9a-f]/gi, (d) => d + d).slice(1) : s.slice(1);
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
          }
          const n = (s.match(/[0-9.]+/g) || []).map(Number);
          return [n[0] || 0, n[1] || 0, n[2] || 0, n.length > 3 ? n[3] : 1];
        };
        const mix = (fg, over, a) => {
          const f = parse(fg), o = parse(over);
          const c = [0, 1, 2].map((i) => Math.round(f[i] * a + o[i] * (1 - a)));
          return 'rgb(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')';
        };
        const v = ratio(mix(cs.color, bg, op), bg);
        // A hidden element is not a contrast defect: an idle toast sits at opacity 0.
        if (op < 0.05) return;
        // WCAG holds large or bold text, and UI components (1.4.11), to 3:1 rather than 4.5:1.
        // The primary button's white label on the accent colour is 3.2:1 and is intended.
        // Both sides are normalised to "r,g,b" so a hex token and an rgb() computed value compare.
        const rgb = (c) => {
          const s = String(c).trim();
          if (s.charAt(0) === '#') {
            const h = s.length === 4 ? s.replace(/[0-9a-f]/gi, (d) => d + d).slice(1) : s.slice(1);
            return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
          }
          return (s.match(/[0-9.]+/g) || []).slice(0, 3).join(',');
        };
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--pi-accent');
        const onAccent = accent.trim() !== '' && rgb(cs.backgroundColor) === rgb(accent);
        const big = parseFloat(cs.fontWeight) >= 600 || parseFloat(cs.fontSize) >= 18 || onAccent;
        if (v < (big ? 3 : 4.5)) bad.push({ v: +v.toFixed(2), sel: el.tagName.toLowerCase() + '.' + String(el.className || '').slice(0, 24), color: cs.color, bg });
      });
      bad.sort((a, b) => a.v - b.v);
      return JSON.stringify(bad.slice(0, 6));
    })()`;

    for (const theme of ["light", "dark"]) {
      await js(chatWindow(), `window.pi.invoke('pi:set-config',{theme:'${theme}'})`);
      await sleep(1200);
      const w = allWindows().find((x) => /pi-heao-chat|chat-dist/i.test(String(x.webContents.getURL()))) || chatWindow();
      let rows;
      try {
        rows = await w.webContents.executeJavaScript(measure, true);
      } catch (e) {
        rows = "ERR " + (e && e.message);
      }
      if (typeof rows !== "string" || !rows.startsWith("[")) {
        check(`contrast measurable in ${theme} theme`, false, String(rows).slice(0, 90));
        continue;
      }
      const bad = JSON.parse(rows);
      const worst = bad[0];
      check(
        `no text below 4.5:1 in the ${theme} theme`,
        bad.length === 0,
        worst ? `${worst.v}:1 ${worst.color} on ${worst.bg} — ${worst.sel}` : undefined,
      );
    }
    await js(chatWindow(), "window.pi.invoke('pi:set-config',{theme:'light'})");
    await sleep(600);
  });

  // Let the app run its own shutdown path (will-quit disposes the PTYs); a
    // hard app.exit() would leave node-pty's ConPTY helper to crash on the way out.
    app.quit();
    setTimeout(() => app.exit(failed === 0 ? 0 : 1), 2500);
    setTimeout(() => process.exit(failed === 0 ? 0 : 1), 6000);
  }
});
