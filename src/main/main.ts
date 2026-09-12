import { app, BrowserWindow, ipcMain, clipboard, dialog, shell, Menu } from "electron";
import { join, sep, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { readdir as readdirAsync } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import { type StandaloneConfig, DEFAULT_CONFIG, IPC } from "../shared/types";
import { buildChatHtml } from "./chat-adapter";
import { createChatSession, type ChatSession } from "./chat-session";
import { createSessionLister, type SessionLister } from "./sessions";
import {
  authToPublic,
  checkOpenPath,
  parseJsonObject,
  restoreMaskedSecrets,
  sanitizeConfig,
  type JsonValue,
} from "./config";
import { log, errText } from "./log";
import { buildSettingsHtml } from "./settings-window";
import { createTray, showNotification, destroyTray, markQuitting, isQuitting } from "./tray";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let chatSession: ChatSession | null = null;
const childWindows = new Set<BrowserWindow>();
/** webContents id captured at creation: webContents is already destroyed when 'closed' fires. */
let mainWindowId = -1;

/**
 * webContents.id -> chat session. Every window gets its own pi subprocess, so
 * IPC must be routed by sender instead of hitting a single module-level session.
 */
const windowSessions = new Map<number, ChatSession>();

/** msg.type -> IPC channel, for everything chat-session can push to a renderer. */
const MSG_TYPE_TO_CHANNEL: Record<string, string> = {
  state: IPC.STATE,
  models: IPC.MODELS,
  enabledModels: IPC.ENABLED_MODELS,
  thinkingLevels: IPC.THINKING_LEVELS,
  commands: IPC.COMMANDS,
  messages: IPC.MESSAGES,
  event: IPC.EVENT,
  dialog: IPC.DIALOG,
  pickedResources: IPC.PICKED_RESOURCES,
  contextUsage: IPC.CONTEXT_USAGE,
  widget: IPC.WIDGET,
  toast: IPC.TOAST,
  infoPanel: IPC.INFO_PANEL,
  btwAbortReady: IPC.BTW_ABORT_READY,
  error: IPC.ERROR,
  prefillInput: IPC.PREFILL_INPUT,
  appendInput: IPC.APPEND_INPUT,
  sessionInfo: IPC.SESSION_INFO,
  permissionMode: IPC.PERMISSION_MODE,
  files: IPC.FILES,
  sessionsList: IPC.SESSIONS_LIST,
  streaming: IPC.STREAMING,
  mcpStatus: IPC.MCP_STATUS,
  tokenStats: "pi:token-stats",
  tokenMetrics: "pi:token-metrics",
  firstToken: "pi:first-token",
};

function postToWindow(win: BrowserWindow, msg: unknown): void {
  if (win.isDestroyed()) return;
  const type = (msg as { type?: string } | null)?.type;
  const channel = type ? MSG_TYPE_TO_CHANNEL[type] : undefined;
  if (channel) win.webContents.send(channel, msg);
  else log.warn("unknown msg type for renderer:", type);
}

/** The chat session that owns a given renderer. */
function sessionFor(sender: Electron.WebContents): ChatSession | null {
  const direct = windowSessions.get(sender.id);
  if (direct) return direct;
  // A child window whose session is still booting must never fall back to the
  // main window's session (that would send its prompts to the wrong agent).
  const win = BrowserWindow.fromWebContents(sender);
  if (win && childWindows.has(win)) return null;
  return chatSession;
}

// ─── Config ───────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".pi", "standalone");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function loadConfig(): StandaloneConfig {
  try {
    if (existsSync(CONFIG_PATH))
      return sanitizeConfig(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
  } catch (e) {
    log.warn("config.json unreadable — falling back to defaults:", errText(e));
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * config.json is hand-editable and the settings window sends `Partial` over IPC,
 * so the shape is never guaranteed — sanitizeConfig (./config) coerces it.
 */
function saveConfig(next: StandaloneConfig): void {
  config = sanitizeConfig(next);
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

let config = loadConfig();

// ─── Temp HTML lifecycle ──────────────────────────────────────────────

const tempHtmlFiles = new Set<string>();
let ioWarnings = 0;

/** Rate-limited warning: temp/cleanup failures are expected (locked files) and must not spam. */
function warnIo(what: string, e: unknown): void {
  if (ioWarnings++ < 3) log.warn(what, errText(e));
}

/** The chat/settings HTML is generated at runtime — write it somewhere disposable and track it. */
function writeTempHtml(prefix: string, html: string): string {
  const file = join(tmpdir(), `${prefix}-${randomUUID().slice(0, 8)}.html`);
  writeFileSync(file, html, "utf8");
  tempHtmlFiles.add(file);
  return file;
}

/** Remove the files we wrote; also sweep leftovers from earlier runs (older than 1h). */
function sweepStaleTempFiles(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!/^pi-(standalone|heao)-(chat|child|settings).*\.html$/.test(name)) continue;
      const full = join(tmpdir(), name);
      try {
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
      } catch (e) {
        warnIo("temp sweep skipped:", e);
      }
    }
  } catch (e) {
    warnIo("temp sweep failed:", e);
  }
}

function cleanupTempFiles(): void {
  for (const f of tempHtmlFiles) {
    try {
      unlinkSync(f);
    } catch (e) {
      warnIo("temp cleanup skipped:", e);
    }
  }
  tempHtmlFiles.clear();
}

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");

function readPiFile(name: string): string {
  try {
    const p = join(PI_AGENT_DIR, name);
    if (existsSync(p)) return readFileSync(p, "utf8");
  } catch {}
  return "";
}

function writePiFile(name: string, content: string): void {
  if (!existsSync(PI_AGENT_DIR)) mkdirSync(PI_AGENT_DIR, { recursive: true });
  const p = join(PI_AGENT_DIR, name);
  if (content.trim()) writeFileSync(p, content, "utf8");
  else if (existsSync(p)) writeFileSync(p, "", "utf8");
}

// ─── Secrets + path guards live in ./config (pure, unit-tested) ────────

function openPathSafely(raw: string): { ok: boolean; error?: string } {
  const check = checkOpenPath(raw, config.workspaceRoot);
  if (!check.ok) {
    log.warn(`openPath blocked (${check.error}):`, raw);
    return { ok: false, error: check.error };
  }
  void shell.openPath(check.path);
  return { ok: true };
}

// ─── Settings window ──────────────────────────────────────────────────

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 720,
    height: 640,
    title: "Pi Heao 设置",
    backgroundColor: "#1e1e1e",
    parent: mainWindow ?? undefined,
    webPreferences: {
      // settings-only preload: the only window that may touch auth/config files
      preload: join(__dirname, "..", "preload", "preload-settings.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const tmp = writeTempHtml("pi-heao-settings", buildSettingsHtml());
  settingsWindow.loadFile(tmp);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// ─── Window ───────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "Pi Heao GUI",
    backgroundColor: "#1e1e1e",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#181818",
      symbolColor: "#cccccc",
      height: 32,
    },
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Unique temp file per launch — avoids stale-cache when old instance holds the file
  const chatHtml = buildChatHtml(app.getAppPath(), config);
  if (chatHtml) {
    const tmpHtml = writeTempHtml("pi-heao-chat", chatHtml);
    await mainWindow.loadFile(tmpHtml);
  } else {
    const candidates = [
      join(app.getAppPath(), "dist", "renderer", "index.html"),
      join(app.getAppPath(), "src", "renderer", "index.html"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        await mainWindow.loadFile(p);
        break;
      }
    }
  }

  mainWindow.on("closed", () => {
    if (mainWindowId >= 0) windowSessions.delete(mainWindowId);
    mainWindowId = -1;
    mainWindow = null;
    if (chatSession) {
      chatSession.dispose();
      chatSession = null;
    }
  });
}

// ─── Multi-window: open session in new window ─────────────────────────

async function openSessionWindow(sessionFile: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 700,
    minHeight: 450,
    title: `Pi — ${basename(sessionFile, ".jsonl")}`,
    backgroundColor: "#1e1e1e",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#181818", symbolColor: "#cccccc", height: 32 },
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  childWindows.add(win);
  const childWinId = win.webContents.id;

  // Each child window gets a cloned config with the target session
  const childConfig: StandaloneConfig = { ...config };
  const chatHtml = buildChatHtml(app.getAppPath(), childConfig);
  if (chatHtml) {
    const tmpHtml = writeTempHtml("pi-heao-child", chatHtml);
    await win.loadFile(tmpHtml);
  }

  // Create a dedicated chat session for this window
  let childSession: ChatSession | null = null;
  try {
    childSession =
      (await createChatSession({
        appPath: app.getAppPath(),
        config: childConfig,
        sessionFile,
        cwd: config.workspaceRoot || homedir(),
        host: {
          postToRenderer: (msg) => postToWindow(win, msg),
        },
      })) ?? null;
  } catch (e) {
    log.error("child session failed:", errText(e));
  }

  if (childSession) windowSessions.set(childWinId, childSession);

  win.on("closed", () => {
    windowSessions.delete(childWinId);
    childWindows.delete(win);
    if (childSession) {
      childSession.dispose();
      childSession = null;
    }
  });
}

ipcMain.handle("pi:open-session-window", async (_e, sessionFile: string) => {
  const f = String(sessionFile || "");
  if (!f || !existsSync(f)) return { ok: false, error: "会话文件不存在" };
  await openSessionWindow(f);
  return { ok: true };
});

// ─── IPC: Config ──────────────────────────────────────────────────────

ipcMain.handle(IPC.GET_CONFIG, () => config);

ipcMain.handle(IPC.SET_CONFIG, (_e, partial: Partial<StandaloneConfig>) => {
  saveConfig({ ...config, ...partial });
  return config;
});

ipcMain.handle("pi:open-settings", () => {
  openSettingsWindow();
});

ipcMain.handle("pi:read-agent-files", () => {
  return {
    append: readPiFile("APPEND_SYSTEM.md"),
    override: readPiFile("SYSTEM.md"),
    models: readPiFile("models.json") || "{}",
    settings: readPiFile("settings.json") || "{}",
    auth: authToPublic(readPiFile("auth.json") || "{}"),
  };
});

ipcMain.handle(
  "pi:write-agent-files",
  (
    _e,
    data: {
      append?: string;
      override?: string;
      settings?: string;
      models?: string;
      auth?: string;
    },
  ) => {
    if (data.append !== undefined) writePiFile("APPEND_SYSTEM.md", data.append);
    if (data.override !== undefined) writePiFile("SYSTEM.md", data.override);
    if (data.settings !== undefined) {
      const s = data.settings.trim();
      if (s) {
        try {
          JSON.parse(s);
        } catch (e) {
          return {
            ok: false,
            error: `settings.json 不是有效 JSON: ${errText(e)}`,
          };
        }
      }
      writePiFile("settings.json", data.settings);
    }
    if (data.models !== undefined) {
      const s = data.models.trim();
      if (s) {
        try {
          JSON.parse(s);
        } catch (e) {
          return {
            ok: false,
            error: `models.json 不是有效 JSON: ${errText(e)}`,
          };
        }
      }
      writePiFile("models.json", data.models);
    }
    if (data.auth !== undefined) {
      const s = data.auth.trim();
      if (s) {
        let incoming: JsonValue;
        try {
          incoming = JSON.parse(s);
        } catch (e) {
          return {
            ok: false,
            error: `auth.json 不是有效 JSON: ${errText(e)}`,
          };
        }
        // the renderer only ever saw masks — put the real secrets back
        const current: JsonValue = parseJsonObject(readPiFile("auth.json"));
        if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
          return { ok: false, error: "auth.json 必须是 JSON 对象" };
        }
        writePiFile("auth.json", JSON.stringify(restoreMaskedSecrets(incoming, current), null, 2));
      }
    }
    return { ok: true };
  },
);

// ─── IPC: Session pin / favorite ──────────────────────────────────────

ipcMain.handle("pi:toggle-pin", (_e, sessionFile: string) => {
  const f = String(sessionFile || "");
  if (!f) return { ok: false };
  const pins = new Set(config.pinnedSessions || []);
  if (pins.has(f)) pins.delete(f);
  else pins.add(f);
  saveConfig({ ...config, pinnedSessions: [...pins] });
  return {
    ok: true,
    pinned: pins.has(f),
    pinnedSessions: config.pinnedSessions,
  };
});

ipcMain.handle("pi:get-pins", () => config.pinnedSessions || []);

// ─── IPC: Extension enable / disable ──────────────────────────────────

ipcMain.handle("pi:toggle-extension", (_e, name: string, enable: boolean) => {
  const extDir = join(PI_AGENT_DIR, "extensions");
  if (!existsSync(extDir)) return { ok: false, error: "扩展目录不存在" };
  const n = String(name || "");
  // Match on the base name so we find the file regardless of current disabled state
  let found: string | null = null;
  for (const f of readdirSync(extDir)) {
    if (
      f === n ||
      f === `${n}.disabled` ||
      f === `${n}.disabled-vscode` ||
      f.replace(/\.disabled(-vscode)?$/, "") === n.replace(/\.disabled(-vscode)?$/, "")
    ) {
      found = f;
      break;
    }
  }
  if (!found) return { ok: false, error: `未找到扩展: ${n}` };
  const base = found.replace(/\.disabled(-vscode)?$/, "");
  const from = join(extDir, found);
  const to = enable ? join(extDir, base) : join(extDir, `${base}.disabled`);
  if (from === to) return { ok: true };
  try {
    renameSync(from, to);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("pi:pick-workspace", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    defaultPath: config.workspaceRoot || homedir(),
    buttonLabel: "选择",
    title: "选择工作目录",
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("pi:set-workspace", (_e, dir: string) => {
  saveConfig({ ...config, workspaceRoot: String(dir || "") });
  return config;
});

ipcMain.handle("pi:export-conversation", async (e) => {
  const session = sessionFor(e.sender);
  const win = BrowserWindow.fromWebContents(e.sender) ?? mainWindow;
  if (!session || !win) return null;
  try {
    const messages = await session.rpc.getMessages();
    let md = "# Pi 对话导出\n\n";
    md += `导出时间: ${new Date().toLocaleString("zh-CN")}\n\n---\n\n`;
    for (const msg of messages as any[]) {
      const role = msg.role || msg.message?.role || "unknown";
      const content = msg.content ?? msg.message?.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        for (const b of content) {
          if (b && typeof b === "object") {
            if (b.type === "text" && b.text) text += (text ? "\n\n" : "") + b.text;
            else if (b.type === "thinking" && b.thinking)
              text += `${text ? "\n\n" : ""}> 💭 ${b.thinking.slice(0, 200)}…`;
            else if (b.type === "toolcall")
              text += `${text ? "\n\n" : ""}🔧 \`${b.name || "tool"}\``;
          }
        }
      }
      if (!text.trim()) continue;
      const label = role === "user" ? "👤 用户" : role === "assistant" ? "🤖 Assistant" : role;
      md += `**${label}**\n\n${text}\n\n---\n\n`;
    }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: join(
        homedir(),
        "Desktop",
        `pi-对话-${new Date().toISOString().slice(0, 10)}.md`,
      ),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, md, "utf8");
    return result.filePath;
  } catch (e) {
    log.error("export conversation failed:", errText(e));
    return null;
  }
});

ipcMain.handle("pi:get-env-info", () => {
  const { readdirSync, readFileSync: rf } = require("node:fs");
  // Local extensions
  let extensions: string[] = [];
  try {
    const extDir = join(PI_AGENT_DIR, "extensions");
    if (existsSync(extDir)) {
      extensions = readdirSync(extDir).filter(
        (f: string) => f.endsWith(".ts") || f.endsWith(".js") || f.includes(".disabled"),
      );
    }
  } catch {}
  // Skills
  const skills: Array<{ name: string; description: string }> = [];
  try {
    const skillsDir = join(PI_AGENT_DIR, "skills");
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir)) {
        const skillMd = join(skillsDir, entry, "SKILL.md");
        if (existsSync(skillMd)) {
          try {
            const content = rf(skillMd, "utf8");
            const descMatch = content.match(/^description:\s*(.+)$/m);
            const nameMatch = content.match(/^name:\s*(.+)$/m);
            skills.push({
              name: nameMatch?.[1]?.trim() || entry,
              description: descMatch?.[1]?.trim() || "",
            });
          } catch {
            skills.push({ name: entry, description: "" });
          }
        }
      }
    }
  } catch {}
  return { extensions, skills };
});

ipcMain.handle(IPC.COPY, (_e, text: string) => {
  clipboard.writeText(String(text ?? ""));
});

ipcMain.handle(IPC.OPEN_FILE, (_e, filePath: string) => {
  return openPathSafely(String(filePath ?? ""));
});

ipcMain.handle(IPC.PICK_RESOURCE, async (e) => {
  const parent = BrowserWindow.fromWebContents(e.sender) ?? mainWindow;
  if (!parent) return [];
  const result = await dialog.showOpenDialog(parent, {
    properties: ["openFile", "openDirectory", "multiSelections"],
    defaultPath: config.workspaceRoot || homedir(),
    buttonLabel: "Add",
    title: "Add file or folder to prompt",
  });
  if (result.canceled) return [];
  const base = config.workspaceRoot || homedir();
  const paths = result.filePaths.map((p) => {
    if (p.startsWith(base + sep) || p === base) return p === base ? "." : p.slice(base.length + 1);
    return p;
  });
  // pi-chat waits for a `pickedResources` message; the invoke result alone is dropped by the preload
  e.sender.send(IPC.PICKED_RESOURCES, { type: "pickedResources", paths });
  return paths;
});

/**
 * The sidebar's drag & drop posts `appendInput`; it has to come back to the same
 * renderer as a host message so the composer can insert the paths.
 */
ipcMain.handle("pi:append-input", (e, msg: { text?: string } | string) => {
  const text = typeof msg === "string" ? msg : String(msg?.text ?? "");
  if (!text) return { ok: false, error: "empty text" };
  e.sender.send(IPC.APPEND_INPUT, { type: "appendInput", text });
  return { ok: true };
});

ipcMain.handle(IPC.SEARCH_FILES, async (e, query: string) => {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!q || !config.workspaceRoot) return [];
  const root = config.workspaceRoot;
  const results: string[] = [];
  const maxResults = 80;
  const maxDepth = 6;
  const skipDirs = new Set([
    "node_modules",
    ".git",
    ".vscode",
    ".idea",
    "dist",
    "build",
    "__pycache__",
    ".next",
    ".cache",
  ]);

  // Typing fast fires many queries: only the newest one per window may finish.
  const generation = (searchGeneration.get(e.sender.id) ?? 0) + 1;
  searchGeneration.set(e.sender.id, generation);
  const stale = () => searchGeneration.get(e.sender.id) !== generation;

  // Async breadth-first walk with Dirent (no per-entry stat) — a synchronous
  // walk over a large workspace used to freeze the whole main process.
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length && results.length < maxResults && !stale()) {
    const current = queue.shift();
    if (!current) break;
    let entries: Dirent[];
    try {
      entries = await readdirAsync(current.dir, { withFileTypes: true });
    } catch (err) {
      warnIo("search-files readdir:", err);
      continue;
    }
    for (const entry of entries) {
      if (results.length >= maxResults || stale()) break;
      const name = entry.name;
      if (name.startsWith(".") && name !== ".env") continue;
      if (skipDirs.has(name)) continue;
      if (entry.isDirectory()) {
        if (current.depth < maxDepth)
          queue.push({
            dir: join(current.dir, name),
            depth: current.depth + 1,
          });
        continue;
      }
      if (!entry.isFile()) continue; // never follow symlinks/sockets
      if (name.toLowerCase().includes(q)) {
        const full = join(current.dir, name);
        results.push(full.startsWith(root + sep) ? full.slice(root.length + 1) : full);
      }
    }
  }
  if (stale()) return results;
  // pi-chat waits for a `files` message; the invoke result alone is dropped by the preload
  e.sender.send(IPC.FILES, { type: "files", query: q, files: results });
  return results;
});

// ─── IPC: Sessions list ───────────────────────────────────────────────

let sessionLister: SessionLister | null = null;

/** Per-window search generation, so a newer @file query cancels the older walk. */
const searchGeneration = new Map<number, number>();

function getSessionLister(): SessionLister {
  if (!sessionLister) {
    sessionLister = createSessionLister({
      sessionsDir: join(PI_AGENT_DIR, "sessions"),
      cachePath: join(app.getPath("userData"), "session-names.json"),
      pinned: () => config.pinnedSessions || [],
    });
  }
  return sessionLister;
}

ipcMain.handle(IPC.LIST_SESSIONS, async () => getSessionLister().list());

// ─── IPC: Chat session wiring ─────────────────────────────────────────

// Map IPC channels to chat-session message types (what handleMessage expects)
const channelToMsgType: Record<string, string> = {
  [IPC.WEBVIEW_READY]: "webviewReady",
  [IPC.PROMPT]: "prompt",
  [IPC.ABORT]: "abort",
  [IPC.CLEAR_QUEUE]: "clearQueue",
  [IPC.SET_MODEL]: "setModel",
  [IPC.SET_THINKING]: "setThinking",
  [IPC.SET_SESSION_NAME]: "setSessionName",
  [IPC.NEW_SESSION]: "newSession",
  [IPC.SWITCH_SESSION]: "switchSession",
  [IPC.DIALOG_RESPONSE]: "dialogResponse",
  [IPC.FORK]: "fork",
  [IPC.REVERT]: "revert",
  [IPC.RELOAD]: "reload",
  [IPC.TODO_CLEAR]: "todoClear",
  [IPC.MCP_OPEN]: "mcpOpen",
  [IPC.MCP_ACTION]: "mcpAction",
  [IPC.SET_PERMISSION]: "setPermission",
  [IPC.BTW_ABORT]: "btwAbort",
  [IPC.REWIND_ACCEPT]: "rewindAccept",
  [IPC.REWIND_ACCEPT_FILE]: "rewindAcceptFile",
  [IPC.REWIND_REVERT]: "rewindRevert",
  [IPC.REWIND_REVERT_FILE]: "rewindRevertFile",
  [IPC.TOGGLE_FAVORITE]: "toggleFavorite",
};

// Register handlers for all chat-session-bound channels
for (const [channel, msgType] of Object.entries(channelToMsgType)) {
  ipcMain.handle(channel, async (e, msg: Record<string, unknown>) => {
    const session = sessionFor(e.sender);
    if (!session) {
      log.warn(`ipc ${channel}: no session for renderer`);
      return { ok: false, error: "会话未就绪" };
    }
    try {
      if (msgType === "switchSession") {
        const file = String(msg?.sessionFile || msg?.file || "");
        if (!file) {
          log.warn("ipc switchSession: no file", msg);
          return { ok: false, error: "缺少会话文件路径" };
        }
        log.info("ipc switchSession ->", file);
        await session.switchTo(file);
        return { ok: true };
      } else if (msgType === "newSession") {
        await session.newSession();
        return { ok: true };
      } else {
        await session.handleMessage({ ...msg, type: msgType });
        return { ok: true };
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log.error(`ipc ${channel} error:`, err);
      return { ok: false, error: err };
    }
  });
}

// rewindDiff: open file in system (no VS Code diff available)
ipcMain.handle(IPC.REWIND_DIFF, async (_e, msg: { absPath?: string }) => {
  if (!msg?.absPath) return { ok: false, error: "empty path" };
  return openPathSafely(String(msg.absPath));
});

// ─── Boot ─────────────────────────────────────────────────────────────

// Two instances would race on ~/.pi/standalone/config.json and on the pi
// session files (last writer wins, sessions get clobbered).
const singleInstance = app.requestSingleInstanceLock();
if (singleInstance) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
} else {
  app.quit();
}

function setupChineseMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "新建会话",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            mainWindow?.webContents.send("pi:event", {
              type: "event",
              event: { type: "newSessionShortcut" },
            });
          },
        },
        { type: "separator" },
        {
          label: "退出",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            markQuitting();
            app.quit();
          },
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { role: "close", label: "关闭" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "设置",
          accelerator: "CmdOrCtrl+,",
          click: () => openSettingsWindow(),
        },
        { type: "separator" },
        {
          label: "关于 Pi Heao GUI",
          click: () => {
            const detail = [
              "made by HEAOZIE",
              "",
              "Electron shell for `pi --mode rpc` (JSONL over stdio).",
              "Chat UI: vendored pi-chat (MIT, JohnnyZ93/pi-agent-studio).",
            ].join("\n");
            const opts = {
              type: "info" as const,
              title: "关于",
              message: "Pi Heao GUI V0.1",
              detail,
              buttons: ["好"],
            };
            if (mainWindow) void dialog.showMessageBox(mainWindow, opts);
            else void dialog.showMessageBox(opts);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  if (!singleInstance) return;
  sweepStaleTempFiles();
  setupChineseMenu();
  await createWindow();
  const trayReady = createTray(() => mainWindow);

  // Minimize to tray instead of quit — only while there is a visible tray icon
  // to restore the window from; otherwise closing must really close.
  mainWindow?.on("close", (e) => {
    if (!isQuitting() && trayReady) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  // Create chat session after window is ready
  if (mainWindow) {
    mainWindowId = mainWindow.webContents.id;
    try {
      const win = mainWindow;
      chatSession =
        (await createChatSession({
          appPath: app.getAppPath(),
          config,
          host: {
            postToRenderer: (msg) => {
              // Desktop notification when agent finishes
              const m = msg as any;
              if (m?.type === "event" && m.event?.type === "agent_settled") {
                if (!win.isDestroyed() && !win.isFocused()) {
                  showNotification("Pi Heao GUI", "Agent 已完成回复");
                }
              }
              postToWindow(win, msg);
            },
          },
        })) ?? null;
      if (chatSession && mainWindowId >= 0) windowSessions.set(mainWindowId, chatSession);
      log.info("chat session created");
    } catch (e) {
      log.error("failed to create chat session:", errText(e));
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  markQuitting();
  for (const session of windowSessions.values()) session.dispose();
  windowSessions.clear();
});

app.on("will-quit", () => {
  destroyTray();
  cleanupTempFiles();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
