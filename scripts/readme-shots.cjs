/**
 * Screenshots for the README.
 *
 * `npm run shot` captures whatever is on this machine, which is fine for local
 * review but must never be committed: a real session list carries project names,
 * file paths and message text. This script builds a throwaway world instead —
 * its own HOME, its own demo project (with a git change to show), and a
 * synthesised session whose text is invented — so the pictures can live in the
 * repository.
 *
 * Run with:  npm run shots
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const REPO_ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "docs", "images");

// ── Throwaway world, before anything reads homedir() ────────────────────────
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "pi-shots-"));

/**
 * The dock shows the resolved working directory, so a temp path would print this
 * machine's user name into the picture. Prefer a short, neutral directory and
 * fall back to the sandbox only if the drive is not writable.
 */
function pickDemoRoot() {
  for (const root of ["E:\\pi-demo", path.join(SANDBOX, "demo")]) {
    try {
      // A previous run cannot always delete its own directory: the pi child runs
      // with this as its working directory, and Windows refuses to remove a
      // directory that a live process still holds. Cleaning up on the way in
      // makes the script self-healing instead.
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    try {
      fs.mkdirSync(root, { recursive: true });
      return root;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("no writable demo directory");
}
const DEMO_ROOT = pickDemoRoot();
const DEMO = path.join(DEMO_ROOT, "demo-app");
fs.mkdirSync(path.join(DEMO, "src"), { recursive: true });
fs.writeFileSync(
  path.join(DEMO, "package.json"),
  JSON.stringify(
    { name: "demo-app", version: "0.1.0", type: "module", scripts: { test: "node --test" } },
    null,
    2,
  ),
  "utf8",
);
fs.writeFileSync(
  path.join(DEMO, "README.md"),
  "# demo-app\n\nA small project used for the screenshots.\n",
  "utf8",
);
fs.writeFileSync(
  path.join(DEMO, "src", "stats.js"),
  [
    "export function mean(values) {",
    "  if (values.length === 0) return 0;",
    "  return values.reduce((a, b) => a + b, 0) / values.length;",
    "}",
    "",
    "export function median(values) {",
    "  if (values.length === 0) return 0;",
    "  const sorted = [...values].sort((a, b) => a - b);",
    "  const mid = Math.floor(sorted.length / 2);",
    "  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;",
    "}",
    "",
  ].join("\n"),
  "utf8",
);
fs.writeFileSync(
  path.join(DEMO, "src", "stats.test.js"),
  [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { mean, median } from "./stats.js";',
    "",
    'test("mean", () => assert.equal(mean([1, 2, 3]), 2));',
    'test("median", () => assert.equal(median([3, 1, 2]), 2));',
    "",
  ].join("\n"),
  "utf8",
);

// Give the changes pane something to show: a repository with one open edit.
const { execFileSync } = require("node:child_process");
try {
  execFileSync("git", ["init", "-q"], { cwd: DEMO });
  execFileSync("git", ["add", "-A"], { cwd: DEMO });
  execFileSync(
    "git",
    ["-c", "user.email=demo@example.com", "-c", "user.name=demo", "commit", "-qm", "init"],
    { cwd: DEMO },
  );
  fs.appendFileSync(
    path.join(DEMO, "src", "stats.js"),
    "\nexport function sum(values) {\n  return values.reduce((a, b) => a + b, 0);\n}\n",
    "utf8",
  );
} catch (e) {
  console.warn("demo git setup skipped:", e?.message);
}

const agentDir = path.join(SANDBOX, ".pi", "agent");
fs.mkdirSync(path.join(agentDir, "sessions", "demo"), { recursive: true });

/**
 * A neutral model catalogue.
 *
 * Do NOT copy the real `models.json`: on the machine this was written on it held
 * exactly one provider — a local model whose display name made it into the input
 * bar of the first set of screenshots. Model names are configuration, not
 * personal data, but they are still not the reader's business.
 */
const DEMO_MODELS = {
  providers: {
    anthropic: {
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      api: "anthropic",
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        thinkingFormat: "anthropic",
        maxTokensField: "max_tokens",
      },
      models: [
        {
          id: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          reasoning: true,
          thinkingLevelMap: {
            off: null,
            minimal: null,
            low: null,
            medium: null,
            high: "high",
            xhigh: null,
            max: null,
          },
          input: ["text", "image"],
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          contextWindow: 200000,
          maxTokens: 64000,
        },
      ],
    },
  },
};
fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(DEMO_MODELS, null, 2), "utf8");
// Keep pi from installing the real package set into the sandbox.
fs.writeFileSync(
  path.join(agentDir, "settings.json"),
  JSON.stringify({ packages: [] }, null, 2),
  "utf8",
);
fs.mkdirSync(path.join(SANDBOX, ".pi", "standalone"), { recursive: true });
fs.writeFileSync(
  path.join(SANDBOX, ".pi", "standalone", "config.json"),
  JSON.stringify({ workspaceRoot: DEMO, theme: "dark", uiLanguage: "zh-cn" }, null, 2),
  "utf8",
);

// ── A synthesised session (invented text, valid format) ─────────────────────
const SESSION_ID = "demo-0001";
const now = Date.now();
let parentId = null;
const lines = [];
const push = (obj) => {
  lines.push(JSON.stringify(obj));
  parentId = obj.id ?? parentId;
};
const message = (id, role, text, usage) => ({
  type: "message",
  id,
  parentId,
  timestamp: new Date(now).toISOString(),
  message: {
    role,
    content: [{ type: "text", text }],
    timestamp: now,
    ...(usage ? { usage } : {}),
  },
});

lines.push(
  JSON.stringify({
    type: "session",
    version: 1,
    id: SESSION_ID,
    timestamp: new Date(now).toISOString(),
    cwd: DEMO,
  }),
);
parentId = undefined;
lines.push(
  JSON.stringify({
    type: "model_change",
    id: "m1",
    parentId: null,
    timestamp: new Date(now).toISOString(),
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
  }),
);
push({
  type: "session_info",
  id: "s1",
  parentId: "m1",
  timestamp: new Date(now).toISOString(),
  name: "给 demo-app 加一个 median 函数",
});

push(
  message(
    "u1",
    "user",
    "给 src/stats.js 加上 median（中位数），补一个测试，并说明你选的实现为什么不用排序整个数组。",
  ),
);
push(
  message(
    "a1",
    "assistant",
    [
      "我先看了 `src/stats.js`，里面已经有 `mean`，风格是纯函数 + 提前返回。照这个风格补 `median`：",
      "",
      "```js",
      "export function median(values) {",
      "  if (values.length === 0) return 0;",
      "  const sorted = [...values].sort((a, b) => a - b);",
      "  const mid = Math.floor(sorted.length / 2);",
      "  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;",
      "}",
      "```",
      "",
      "两点说明：",
      "",
      "1. **先拷贝再排序**：`[...values]` 是为了不修改调用方传进来的数组，否则 `median` 会有副作用。",
      "2. **排序是必要的**：中位数的定义依赖有序性，O(n log n) 已经是这类实现的常态；",
      "   只有在数据流很长时才值得上双堆，这个文件目前没这个必要。",
    ].join("\n"),
    { inputTokens: 1840, outputTokens: 612, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ),
);
push(message("u2", "user", "好，顺手把测试也补上。"));
push(
  message(
    "a2",
    "assistant",
    [
      "`src/stats.test.js` 已补：",
      "",
      "| 用例 | 输入 | 期望 |",
      "| --- | --- | --- |",
      "| 奇数个 | `[3, 1, 2]` | `2` |",
      "| 偶数个 | `[1, 2, 3, 4]` | `2.5` |",
      "| 空数组 | `[]` | `0` |",
      "",
      "`node --test` 全绿。",
    ].join("\n"),
    { inputTokens: 2260, outputTokens: 298, cacheReadTokens: 1840, cacheWriteTokens: 0 },
  ),
);

fs.writeFileSync(
  path.join(agentDir, "sessions", "demo", `${SESSION_ID}.jsonl`),
  `${lines.join("\n")}\n`,
  "utf8",
);

fs.mkdirSync(path.join(SANDBOX, ".pi", "standalone"), { recursive: true });

process.env.USERPROFILE = SANDBOX;
process.env.HOME = SANDBOX;
process.env.APPDATA = path.join(SANDBOX, "AppData", "Roaming");
process.env.LOCALAPPDATA = path.join(SANDBOX, "AppData", "Local");
fs.mkdirSync(process.env.APPDATA, { recursive: true });

// ── Capture ────────────────────────────────────────────────────────────────
const electron = require("electron");
if (!electron.app || typeof electron.app.on !== "function") {
  console.error("ELECTRON_RUN_AS_NODE is set — unset it first.");
  process.exit(2);
}
const { app, BrowserWindow } = electron;
if (typeof app.setAppPath === "function") app.setAppPath(REPO_ROOT);
require(path.join(REPO_ROOT, "dist", "main", "main.js"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code, true);

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    // fn may return a value or a promise; both are fine here.
    const v = await Promise.resolve(fn()).catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label}`);
    await sleep(200);
  }
}

let saved = 0;
async function shot(win, name) {
  await sleep(400);
  const img = await win.webContents.capturePage();
  // Keep the repository light: 1280 wide is plenty for a README.
  const { width } = img.getSize();
  const out = width > 1280 ? img.resize({ width: 1280 }) : img;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), out.toPNG());
  saved++;
  console.log(`  saved docs/images/${name}.png`);
}

app.whenReady().then(async () => {
  try {
    const win = await waitFor(async () => BrowserWindow.getAllWindows()[0], 45_000, "main window");
    win.setSize(1400, 900);
    await waitFor(() => js(win, "!!document.getElementById('pi-shell')"), 45_000, "shell");
    await waitFor(
      () => js(win, "document.querySelectorAll('.pi-session-item').length > 0"),
      60_000,
      "session list",
    );

    // Open the demo session so the chat has content.
    await js(
      win,
      `(() => {
      const items = [...document.querySelectorAll('.pi-session-item')];
      const hit = items.find((el) => (el.textContent || '').includes('median')) || items[0];
      if (hit) hit.click();
      return !!hit;
    })()`,
    );
    await waitFor(
      () => js(win, "document.querySelectorAll('.msg, .message').length >= 4"),
      90_000,
      "messages",
    );
    await sleep(1500);

    await shot(win, "chat");

    // Dock: terminal, then the git pane.
    await js(win, "document.getElementById('pi-dock-toggle').click()");
    await sleep(2500);
    await js(
      win,
      "window.pi.invoke('pi:term-input', 'git status --short' + String.fromCharCode(13))",
    );
    await sleep(2500);
    await shot(win, "dock-terminal");

    await js(
      win,
      `(() => { const b = document.querySelector('.pi-dock-tab[data-dock="changes"]'); if (b) b.click(); })()`,
    );
    await sleep(3000);
    await shot(win, "dock-changes");

    // Command palette.
    await js(win, "document.getElementById('pi-dock-close').click()");
    await sleep(600);
    await js(
      win,
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))",
    );
    await sleep(1200);
    await shot(win, "palette");
    await js(
      win,
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
    );

    // Settings: the two tabs that show the most surface.
    await js(win, "window.pi.invoke('pi:open-settings')");
    const settings = await waitFor(
      () => BrowserWindow.getAllWindows().find((w) => w !== win),
      25_000,
      "settings window",
    );
    await waitFor(
      () => js(settings, "!!document.getElementById('panel-models')"),
      20_000,
      "settings dom",
    );
    settings.setSize(1100, 780);
    await sleep(2500);
    await shot(settings, "settings-models");

    await js(
      settings,
      `(() => { document.querySelector('.tab[data-tab="appearance"]').click(); })()`,
    );
    await sleep(1200);
    await shot(settings, "settings-appearance");

    console.log(`\n  ${saved} screenshot(s) in docs/images/ — sandbox: ${SANDBOX}`);
  } catch (e) {
    console.error("failed:", e && (e.stack || e.message));
  } finally {
    try {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) await w.webContents.executeJavaScript("window.pi.invoke('pi:term-close')", true);
    } catch {
      /* nothing to close */
    }
    await sleep(500);
    // Clean up before quitting: app.quit() ends the event loop, so a timer
    // scheduled for later would never run and the demo project would stay behind.
    try {
      fs.rmSync(DEMO_ROOT, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    app.quit();
    setTimeout(() => app.exit(0), 2500);
    setTimeout(() => process.exit(0), 6000);
  }
});
