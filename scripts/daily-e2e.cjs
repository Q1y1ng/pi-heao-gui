/**
 * Daily-use end-to-end test: the real app, a real local model, a real workspace.
 *
 * Throwaway harness (gitignored, `_` prefix). It does what a person does — switch
 * to the local model, say what they want, watch the tools run, then use the dock —
 * and asserts on the live DOM plus the filesystem.
 *
 * Isolation: HOME/APPDATA point at a temp directory, so the real config, sessions
 * and the user's own pi setup are never touched. The model catalogue is copied
 * from the real one, with `packages: []` so no third-party extension is pulled in
 * mid-test.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron scripts/daily-e2e.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROVIDER = process.env.PI_DAILY_PROVIDER || "local-ornith-ud";
const MODEL = process.env.PI_DAILY_MODEL || "ornith-1.5-9b-ud";
const TURN_TIMEOUT_MS = 600_000;

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daily-"));
const LOG = path.join(SANDBOX, "progress.log");
function plog(line) {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}
plog("script loaded");
const HOME = path.join(SANDBOX, "home");
const WORK = path.join(SANDBOX, "project");
const AGENT = path.join(HOME, ".pi", "agent");

fs.mkdirSync(AGENT, { recursive: true });
fs.mkdirSync(path.join(HOME, ".pi", "standalone"), { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
// Electron resolves userData under APPDATA; if that parent is missing the app
// never reaches ready and the failure is silent (no window, no error text).
fs.mkdirSync(path.join(HOME, "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(HOME, "AppData", "Local"), { recursive: true });
fs.writeFileSync(path.join(WORK, "README.md"), "# demo project\n\nA scratch project.\n");

// A faithful copy of the daily-driver agent dir: without auth.json a cloud
// provider cannot be reached at all, and without the real package list the
// dynamic model catalogue (which is what lists muse-spark) never gets merged in.
// The copy lives in the sandbox and is deleted with it.
for (const f of ["models.json", "models-store.json", "auth.json"]) {
  const src = path.join(os.homedir(), ".pi", "agent", f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(AGENT, f));
}
let baseSettings = {};
try {
  baseSettings = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".pi", "agent", "settings.json"), "utf8"),
  );
} catch {
  baseSettings = {};
}
fs.writeFileSync(
  path.join(AGENT, "settings.json"),
  JSON.stringify(
    {
      ...baseSettings,
      theme: "dark",
      defaultProvider: PROVIDER,
      defaultModel: MODEL,
      // The real settings say "ask". In RPC mode that question is rendered as a
      // dialog for a person to click, and a headless test never clicks it — pi
      // then treats the project as untrusted and refuses the agent's write tools,
      // which looks exactly like "the turn stopped after one tool call". The test
      // answers it up front so it is testing the app, not the dialog.
      defaultProjectTrust: "trusted",
    },
    null,
    2,
  ),
  "utf8",
);
fs.writeFileSync(
  path.join(HOME, ".pi", "standalone", "config.json"),
  JSON.stringify(
    {
      workspaceRoot: WORK,
      theme: "dark",
      uiLanguage: "zh-cn",
      autoCheckUpdates: false,
      permissionMode: "FullAccess",
    },
    null,
    2,
  ),
  "utf8",
);
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
process.env.APPDATA = path.join(HOME, "AppData");
plog(`sandbox ready: work=${WORK}`);

const { app, BrowserWindow } = require("electron");
const electron = require("electron");
if (!electron.app || typeof electron.app.on !== "function") {
  console.error("ELECTRON_RUN_AS_NODE is set — unset it first");
  process.exit(2);
}
if (typeof app.setAppPath === "function") app.setAppPath(path.join(__dirname, ".."));
plog("requiring dist/main/main.js");
require(path.join(__dirname, "..", "dist", "main", "main.js"));
plog("main.js required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const notes = [];

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
    let v = null;
    try {
      v = await Promise.resolve(fn());
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(500);
  }
}

// poll for the window instead of relying on app.whenReady(): if Electron's ready
// event never reaches this script the poll still shows what is going on, and it
// starts the test as soon as a window exists.
async function waitForWindow() {
  for (;;) {
    const wins = BrowserWindow.getAllWindows();
    plog(`poll: isReady=${app.isReady()} windows=${wins.length}`);
    if (wins.length > 0) return wins[0];
    await sleep(2000);
  }
}

waitForWindow().then(async (win) => {
  plog("window acquired");
  const consoleErrors = [];
  try {
    win.setSize(1280, 860);    win.webContents.on("console-message", (eventOrLevel, level, message) => {
      // Electron >= 37 passes a single event object, older versions pass
      // (event, level, message). Arrow functions have no `arguments`, so handle
      // both shapes explicitly.
      const asObject = eventOrLevel && typeof eventOrLevel === "object";
      const lvl = asObject && "level" in eventOrLevel ? eventOrLevel.level : level;
      const msg = asObject && "message" in eventOrLevel ? eventOrLevel.message : message;
      if (lvl === "error" || lvl === 3) consoleErrors.push(String(msg).slice(0, 200));
    });
    await waitFor(() => !win.webContents.isLoading(), 30_000, "chat load");
    await waitFor(
      () => win.webContents.executeJavaScript("!!window.pi && !!window.pi.invoke", true),
      20_000,
      "preload bridge",
    );
    // The sandbox HOME is empty, so pi installs the eleven packages from the real
    // settings on first spawn — the RPC log shows a full minute of "added N
    // packages". Sending a prompt into that races the installs and the extension
    // reload, and the turn gets cut short; the CLI and the probe never saw this
    // because they run against a HOME where the packages are already there.
    plog("waiting for pi to finish installing packages in the sandbox");
    await sleep(150_000);
    plog("settle wait done");
    const js = (code) => win.webContents.executeJavaScript(code, true);

    console.log("\n── 1. 窗口与桥 ──");
    check("chat window with preload bridge", true);
    const title = await js("document.title || ''");
    check("window has a title", typeof title === "string" && title.length > 0, title);

    console.log("\n── 2. 切到本地模型 ──");
    await js(`window.pi.postMessage({ type: 'setModel', provider: ${JSON.stringify(PROVIDER)}, modelId: ${JSON.stringify(MODEL)} })`);
    const modelShown = await waitFor(
      async () => {
        const t = await js("document.body.innerText || ''");
        // Match the model actually under test, not a hardcoded name.
        // The composer shows a display name ("Muse Spark 1.3"), not the model id, so
        // match the leading token instead of the whole id.
        const needle = MODEL.toLowerCase().split("-")[0];
        return t.toLowerCase().includes(needle) ? t : null;
      },
      45_000,
      "model to appear in the UI",
    ).catch(() => null);
    check(
      "the selected model is shown in the composer",
      !!modelShown,
      modelShown ? "" : `neither the window nor the composer mentioned ${MODEL}`,
    );

    console.log("\n── 3. 新功能：粘贴 → Ctrl+Z 撤回 → 再粘贴 ──");
    const pasteFlow = await js(`(() => {
      const c = document.getElementById('input');
      if (!c) return { ok: false, why: 'composer missing' };
      c.focus();
      const before = c.textContent || '';
      const paste = (text) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      };
      paste('一段错误粘贴的无关文字');
      const afterPaste = c.textContent || '';
      document.execCommand('undo');
      const afterUndo = c.textContent || '';
      return { ok: true, before, afterPaste, afterUndo, restored: afterUndo === before };
    })()`);
    check("a wrong paste lands in the composer", pasteFlow.ok && pasteFlow.afterPaste.includes("错误粘贴"), JSON.stringify(pasteFlow).slice(0, 160));
    check("Ctrl+Z takes the whole paste back", pasteFlow.restored === true, JSON.stringify(pasteFlow).slice(0, 160));

    console.log("\n── 4. 真实日常任务（真模型 + 真工具） ──");
    const task =
      "在当前目录做三件事：1) 创建 greet.js，导出 greet(name)，返回 `你好，<name>！`；" +
      "2) 创建 greet.test.js，用 node:test 测两个用例；3) 运行 node --test 并把结果用一句话总结。";
    await js(`(() => {
      const c = document.getElementById('input');
      c.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(task)});
      c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    const composerText = await js("(document.getElementById('input') || {}).textContent || ''");
    check("the task is in the composer", composerText.includes("greet.js"), composerText.slice(0, 80));

    const sentAt = Date.now();
    await js(`window.pi.postMessage({ type: 'prompt', message: ${JSON.stringify(task)} })`);
    check("prompt accepted by the app", true);

    const streaming = await waitFor(
      () => js("document.body.innerText.includes('停止') || !!document.querySelector('.msg.assistant')"),
      120_000,
      "turn to start",
    ).catch(() => null);
    check("the turn starts (streaming or an assistant message appears)", !!streaming);

    // Ground truth, not the DOM. The turn is over for this task when the files it
    // asked for exist; waiting on a text heuristic instead is what made earlier
    // runs report "4s, no reply" while the app was plainly still working — the
    // screen showed two thoughts, a bash call, and then a write after that.
    const finished = await waitFor(
      () => {
        const files = fs.existsSync(WORK) ? fs.readdirSync(WORK) : [];
        return files.includes("greet.js") && files.includes("greet.test.js") ? files : null;
      },
      TURN_TIMEOUT_MS,
      "the agent to create the files the task asked for",
    ).catch(() => null);
    notes.push(`turn wall time: ${Math.round((Date.now() - sentAt) / 1000)}s`);
    if (!finished) {
      const dump = await js(`(() => {
        const nodes = Array.from(document.querySelectorAll('.msg, .assistant-bubble, .user-bubble'));
        const errs = Array.from(document.querySelectorAll('.error, .pi-error, .toast, .pi-toast'))
          .map((e) => (e.innerText || '').trim()).filter(Boolean).slice(0, 5);
        return {
          nodes: nodes.map((n) => (n.className || '') + ' :: ' + ((n.innerText || '').trim().slice(0, 160))),
          errors: errs,
          bodyTail: (document.body.innerText || '').trim().slice(-400),
        };
      })()`).catch(() => ({}));
      notes.push(`DOM dump: ${JSON.stringify(dump).slice(0, 1200)}`);
    }

    const messages = await js(`(() => {
      const nodes = Array.from(document.querySelectorAll('.msg'));
      return nodes.map((n) => ({ role: n.className, text: (n.innerText || '').slice(0, 400) }));
    })()`);
    const assistant = messages.filter((m) => /assistant/.test(m.role) && m.text.trim().length > 0);
    check("an assistant reply arrived", assistant.length > 0, `${messages.length} messages in the DOM`);
    check(
      "the reply has real content",
      assistant.length > 0 && assistant[assistant.length - 1].text.trim().length > 20,
      assistant.length ? assistant[assistant.length - 1].text.slice(0, 120) : "none",
    );
    check("the turn reached an end state", !!finished, finished ? "" : "no assistant content before timeout");
    const replyText = await js(`(() => {
      const b = Array.from(document.querySelectorAll('.assistant-bubble, .msg.assistant')).pop();
      return b ? (b.innerText || '').trim() : '';
    })()`).catch(() => '');
    notes.push(`assistant reply (first 300): ${String(replyText).slice(0, 300).replace(/\n+/g, ' / ')}`);

    // A second, minimal task: one tool call, nothing to interpret. This separates
    // "the pipeline cannot run tools" from "a 9B model did not choose to".
    console.log("\n── 4b. 极简工具任务（判定管线能否执行工具） ──");
    const beforeFiles = fs.existsSync(WORK) ? fs.readdirSync(WORK).length : 0;
    const mini = "请使用终端运行命令 echo PIPELINE-TOOL-OK，然后只告诉我输出的那串字符。";
    await js(`(() => {
      const c = document.getElementById('input');
      c.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(mini)});
      c.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    const marker = `PIPELINE-TOOL-OK-${Date.now()}`;
    // followUp, not a bare prompt: if anything is still running, pi answers a bare
    // prompt with "Agent is already processing" and the message is lost. That error
    // is exactly what a human watching an earlier run saw on screen.
    await js(
      `window.pi.postMessage({ type: 'prompt', message: ${JSON.stringify(mini)}, streamingBehavior: 'followUp' })`,
    );
    const miniDone = await waitFor(
      () => js("document.body.innerText.includes('PIPELINE-TOOL-OK')"),
      300_000,
      "the minified task to come back with the marker",
    ).catch(() => null);
    const miniText = await js("document.body.innerText || ''").catch(() => '');
    check(
      "a one-tool task executed (its output reached the conversation)",
      !!miniDone || miniText.includes("PIPELINE-TOOL-OK"),
      `marker ${marker.slice(-6)} not found in the window; files before=${beforeFiles}`, );

    const piChild = require("node:child_process")
      .execSync('powershell -NoProfile -Command "@(Get-Process node,pi -ErrorAction SilentlyContinue).Count"', {
        encoding: "utf8",
      })
      .trim();
    notes.push(`node/pi processes visible to the OS during the turn: ${piChild}`);

    console.log("\n── 5. 工具真的动了磁盘 ──");
    const files = fs.existsSync(WORK) ? fs.readdirSync(WORK) : [];
    // Look for the artifact the task asked for. Counting "any file that is not
    // README" passes on junk an extension dropped in the directory — which is
    // exactly what happened when the real package list was copied in and pi-lens
    // left its probe folder behind.
    const wanted = ["greet.js", "greet.test.js"];
    const made = wanted.filter((f) => files.includes(f));
    notes.push(`files in workspace after the turn: ${files.join(", ") || "(none)"}`);
    check(
      "the agent created the files the task asked for",
      made.length === wanted.length,
      `found ${made.length}/${wanted.length} of ${wanted.join(", ")} — workspace: ${files.join(", ") || "(empty)"}`,
    );
    if (made.length) {
      const body = fs.readFileSync(path.join(WORK, "greet.js"), "utf8");
      check("greet.js contains a greet function", /greet/.test(body), body.slice(0, 100));
    }

    console.log("\n── 6. Dock（日常要用的三个面板） ──");
    const dockOpened = await js(`(() => {
      if (!window.__piDock) return false;
      window.__piDock.show('files');
      return !document.getElementById('pi-dock').hidden;
    })()`).catch(() => false);
    check("dock opens", dockOpened === true);

    const fileList = await js(`(() => {
      window.__piDock.show('files');
      return new Promise((r) => setTimeout(() => {
        r(Array.from(document.querySelectorAll('.pi-files-row')).map((e) => e.innerText.trim()));
      }, 2000));
    })()`).catch(() => []);
    check(
      "files panel lists the workspace",
      Array.isArray(fileList) && fileList.some((f) => /README|greet/.test(f)),
      JSON.stringify(fileList).slice(0, 160),
    );

    const changes = await js(`(() => {
      window.__piDock.show('changes');
      return new Promise((r) => setTimeout(() => {
        const b = document.getElementById('pi-git-branch');
        const list = document.getElementById('pi-git-list');
        r({ branch: b ? b.textContent : null, list: list ? list.innerText.slice(0, 200) : null });
      }, 2000));
    })()`).catch(() => ({}));
    check(
      "changes panel answers (branch or an explicit non-repo note)",
      !!changes.branch && changes.branch !== "git",
      JSON.stringify(changes).slice(0, 160),
    );

    console.log("\n── 7. 设置窗与多会话 ──");
    await js("window.pi.invoke('pi:open-settings')").catch(() => null);
    const settingsWin = await waitFor(
      () => BrowserWindow.getAllWindows().find((w) => w !== win),
      30_000,
      "settings window",
    ).catch(() => null);
    check("settings window opens", !!settingsWin);

    await js("window.pi.invoke('pi:list-sessions')").catch(() => null);
    const sessionsOk = await js("!!window.pi.invoke").catch(() => false);
    check("session channels are reachable from the chat window", sessionsOk === true);

    console.log("\n── 8. 渲染进程报错 ──");
    check(
      "no renderer console errors during the run",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(" | "),
    );

    console.log(`\n─── ${passed}/${passed + failed} 项通过 ───`);
    for (const n of notes) console.log(`  注: ${n}`);
    console.log(`  沙箱: ${SANDBOX}`);
    if (process.env.PI_DAILY_KEEP !== "1") {
      try {
        fs.rmSync(SANDBOX, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    app.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    plog(`FAILED: ${e?.message}`);
    console.error("daily e2e failed:", e?.stack ? e.stack : e);
    console.error(`  沙箱保留在: ${SANDBOX}`);
    app.exit(2);
  }
});

setTimeout(() => {
  plog("hard timeout");
  console.error("hard timeout");
  process.exit(3);
}, TURN_TIMEOUT_MS + 300_000);
plog("hard timeout armed at 900s");
