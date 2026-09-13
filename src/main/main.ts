import { app, BrowserWindow, ipcMain, clipboard, dialog, shell, Menu } from "electron";
import { join, sep, basename, dirname } from "node:path";
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
import {
  readdir as readdirAsync,
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import { type StandaloneConfig, DEFAULT_CONFIG, IPC } from "../shared/types";
import { buildChatHtml } from "./chat-adapter";
import { safeWorkspacePath } from "./fs-path";
import {
  createChatSession,
  type ChatSession,
  findPiBinary,
  buildExtensionArgs,
  buildEnv,
} from "./chat-session";
import { createTerminal, type TerminalHandle, type TerminalKind } from "./terminal";
import { generateCommitMessage, git } from "./git";
import { readPiChangelog } from "./changelog";
import { resolveUiLang } from "./i18n";
import {
  isSessionFile as isSessionFilePath,
  renameSession,
  deleteSession,
  archiveSession,
  restoreSession,
  listArchived,
} from "./session-ops";
import { searchSessions, orderByRecency } from "./search";
import { createStatsStore, type StatsStore, type StoredSessionStats } from "./stats-store";
import { openDiffWindow } from "./diff-window";
import {
  runPiCli,
  isSafePackageSource,
  parseInstalledPackages,
  parseAuthStatus,
  type AuthStatus,
} from "./pi-cli";
import { getRpcLogPath } from "./rpc-client";
import { buildTokensCss } from "./theme";
import { refreshTrayMenu, setRecentSessions, setUnreadCount, getUnreadCount } from "./tray";
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
import { createUpdateController, type UpdateController, type UpdaterLike } from "./updater";

// ─── Updates ────────────────────────────────────────────────────────────────
// electron-updater is loaded lazily: it is optional at runtime, and a build that
// cannot load it must still start and answer "updates unavailable".
let updateController: UpdateController | null = null;
let updaterLoading: Promise<void> | null = null;

async function ensureUpdater(): Promise<void> {
  if (updateController) return;
  if (updaterLoading) return updaterLoading;
  updaterLoading = (async () => {
    try {
      const mod = (await import("electron-updater")) as { autoUpdater?: UpdaterLike };
      const candidate = mod.autoUpdater;
      if (!candidate || typeof candidate.on !== "function") {
        log.warn("updater: electron-updater exposes no autoUpdater");
        return;
      }
      updateController = createUpdateController({
        updater: candidate,
        currentVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        onStatus: (status) => {
          // Progress events fire constantly; log only the states that matter.
          if (status.state !== "downloading") log.warn("updater:", JSON.stringify(status));
        },
      });
      updateController.init();
    } catch (e) {
      log.warn("updater: unavailable:", errText(e));
    } finally {
      updaterLoading = null;
    }
  })();
  return updaterLoading;
}

ipcMain.handle("pi:update-status", () => {
  if (updateController) return updateController.status();
  return app.isPackaged
    ? { state: "idle" }
    : { state: "unavailable", reason: "当前为源码运行，不检查更新" };
});

ipcMain.handle("pi:update-check", async () => {
  await ensureUpdater();
  if (!updateController) return { state: "unavailable", reason: "更新组件不可用" };
  return updateController.check({ manual: true });
});

ipcMain.handle("pi:update-install", () => {
  if (!updateController) return { ok: false, error: "更新组件不可用" };
  return updateController.install();
});

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
  // Telemetry stream: the panel polls pi:get-stats, these keep the data flowing
  // for any other consumer instead of logging an unknown-message-type warning.
  liveStats: "pi:live-stats",
  turnStats: "pi:turn-stats",
  stats: "pi:stats",
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
  const tmp = writeTempHtml(
    "pi-heao-settings",
    buildSettingsHtml(resolveUiLang(config.uiLanguage)),
  );
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
      // This window renders untrusted agent output, so it is the last window that
      // should run unsandboxed. `node scripts/probe-preload-sandbox.cjs` confirms
      // the sandboxed preload still reaches webUtils.getPathForFile, so
      // drag-and-drop keeps working — the sandbox costs nothing here.
      sandbox: true,
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
    if (mainWindowId >= 0) {
      windowSessions.delete(mainWindowId);
      disposeTerminalFor(mainWindowId);
    }
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
          saveStats: (sessionFile, data) => getStatsStore().save(sessionFile, data),
          loadStats: (sessionFile) => getStatsStore().load(sessionFile),
          toggleFavorite: (provider, modelId) => {
            const key = `${provider}/${modelId}`;
            const current = config.favoriteModels || [];
            const next = current.includes(key)
              ? current.filter((k) => k !== key)
              : [...current, key];
            saveConfig({ ...config, favoriteModels: next });
            return next;
          },
          getFavorites: () => config.favoriteModels || [],
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

/** Sessions may only be opened from the pi sessions directory. */
function isSessionFile(p: string): boolean {
  return isSessionFilePath(p, join(PI_AGENT_DIR, "sessions"));
}

/**
 * Per-session telemetry store. Primed once before the first chat session is
 * created, then read synchronously so a session can show its history instantly.
 */
let statsStore: StatsStore | null = null;
function getStatsStore(): StatsStore {
  if (!statsStore)
    statsStore = createStatsStore(join(app.getPath("userData"), "session-stats.json"));
  return statsStore;
}

/** Host callbacks shared by every chat session (telemetry persistence). */
function sessionHost(win: BrowserWindow): {
  postToRenderer: (msg: unknown) => void;
  saveStats: (sessionFile: string | undefined, data: StoredSessionStats) => void;
  loadStats: (sessionFile: string) => StoredSessionStats | undefined;
  toggleFavorite: (provider: string, modelId: string) => string[];
  getFavorites: () => string[];
} {
  return {
    postToRenderer: (msg) => {
      // Desktop notification + unread counter when a turn finishes while the
      // window is not focused (the window may be hidden in the tray).
      const m = msg as { type?: string; event?: { type?: string } };
      if (
        m?.type === "event" &&
        m.event?.type === "agent_settled" &&
        !win.isDestroyed() &&
        !win.isFocused()
      ) {
        showNotification("Pi Heao GUI", "Agent 已完成回复");
        setUnreadCount(getUnreadCount() + 1);
        win.flashFrame(true);
      }
      postToWindow(win, msg);
    },
    saveStats: (sessionFile, data) => {
      getStatsStore().save(sessionFile, data);
    },
    loadStats: (sessionFile) => getStatsStore().load(sessionFile),
    toggleFavorite: (provider, modelId) => {
      const key = `${provider}/${modelId}`;
      const current = config.favoriteModels || [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      saveConfig({ ...config, favoriteModels: next });
      return next;
    },
    getFavorites: () => config.favoriteModels || [],
  };
}

ipcMain.handle("pi:open-session-window", async (_e, sessionFile: string) => {
  const f = String(sessionFile || "");
  if (!isSessionFile(f)) return { ok: false, error: "会话文件无效" };
  if (!existsSync(f)) return { ok: false, error: "会话文件不存在" };
  await openSessionWindow(f);
  return { ok: true };
});

// ─── IPC: Config ──────────────────────────────────────────────────────

ipcMain.handle(IPC.GET_CONFIG, () => config);

ipcMain.handle(IPC.SET_CONFIG, (_e, partial: Partial<StandaloneConfig>) => {
  saveConfig({ ...config, ...partial });
  applyConfigSideEffects();
  if (partial.theme !== undefined || partial.accent !== undefined) broadcastTheme();
  // The settings document is generated per language; rebuild it on switch.
  if (partial.uiLanguage !== undefined && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
    settingsWindow = null;
    openSettingsWindow();
  }
  return config;
});

/** Push the current token CSS to every chat window (live theme switching). */
function broadcastTheme(): void {
  const css = buildTokensCss(config.theme, config.accent);
  const payload = { type: "theme", css, theme: config.theme, accent: config.accent };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("pi:theme", payload);
  }
}

/** Windows login item + tray refresh whenever config changes. */
function applyConfigSideEffects(): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!config.openAtLogin,
      path: process.execPath,
      args: [],
    });
  } catch (e) {
    log.warn("setLoginItemSettings:", errText(e));
  }
  refreshTrayMenu();
}

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

ipcMain.handle("pi:set-workspace", async (e, dir: string) => {
  const target = String(dir || "");
  if (!target || !existsSync(target)) return config;
  // Remember it, and make it the default for new windows
  const recent = [target, ...(config.recentWorkspaces || []).filter((p) => p !== target)].slice(
    0,
    8,
  );
  saveConfig({ ...config, workspaceRoot: target, recentWorkspaces: recent });
  // Per-window workspace: the pi child is spawned with cwd, so the window bound
  // to this renderer has to be re-created with the new working directory.
  const win = BrowserWindow.fromWebContents(e.sender);
  const session = sessionFor(e.sender);
  if (win && session && win.id === mainWindowId) {
    await rebindMainSession(target);
  }
  return config;
});

/** Recreate the main window's chat session in a new working directory. */
async function rebindMainSession(cwd: string): Promise<void> {
  if (!mainWindow) return;
  const win = mainWindow;
  const previous = chatSession;
  chatSession =
    (await createChatSession({
      appPath: app.getAppPath(),
      config,
      cwd,
      host: sessionHost(win),
    })) ?? null;
  if (chatSession && mainWindowId >= 0) windowSessions.set(mainWindowId, chatSession);
  previous?.dispose();
  postToWindow(win, { type: "toast", text: `工作目录已切换：${cwd}`, kind: "success" });
}

// ─── IPC: session management (rename / delete / archive) ───────────────

ipcMain.handle(
  "pi:session-op",
  async (
    e,
    msg: { op?: string; file?: string; name?: string; silent?: boolean },
  ): Promise<{ ok: boolean; error?: string; path?: string }> => {
    const dir = join(PI_AGENT_DIR, "sessions");
    const op = String(msg?.op || "");
    const file = String(msg?.file || "");
    if (op !== "restore" && !isSessionFile(file)) return { ok: false, error: "会话文件无效" };

    let result: { ok: boolean; error?: string; path?: string } = { ok: false, error: "未知操作" };
    if (op === "rename") {
      const name = String(msg?.name || "");
      // The open session is renamed through pi so its own state follows along.
      const session = sessionFor(e.sender);
      if (session && session.sessionFile === file) {
        result = await session.renameCurrent(name);
      } else {
        result = await renameSession(file, name);
      }
    } else if (op === "delete") {
      const session = sessionFor(e.sender);
      if (session && session.sessionFile === file) {
        return { ok: false, error: "该会话正在使用中，请先切换到其它会话" };
      }
      result = await deleteSession(file);
      if (result.ok) getStatsStore().forget(file);
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.SESSIONS_LIST, { type: "sessionsList" });
      }
    } else if (op === "archive") {
      result = await archiveSession(file, dir);
    } else if (op === "restore") {
      // Archived paths are the only ones accepted here.
      result = await restoreSession(file, dir);
    }

    if (result.ok && op !== "rename" && !msg?.silent) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC.SESSIONS_LIST, { type: "sessionsList" });
      }
    }
    return result;
  },
);

ipcMain.handle("pi:list-archived", async () => {
  const dir = join(PI_AGENT_DIR, "sessions");
  const files = await listArchived(dir);
  const lister = getSessionLister();
  const items = await lister.list();
  const names = new Map(items.map((i) => [i.file, i.name]));
  const ordered = await orderByRecency(files);
  return ordered.map((file) => ({
    file,
    name: names.get(file) || basename(file, ".jsonl"),
    archived: true,
  }));
});

// ─── IPC: full-text search across sessions ────────────────────────────

ipcMain.handle("pi:search-sessions", async (e, query: string) => {
  const q = String(query || "");
  const items = await getSessionLister().list();
  const files = await orderByRecency(items.map((i) => i.file));
  const names = new Map(items.map((i) => [i.file, i.name]));
  const hits = await searchSessions({
    files,
    query: q,
    nameOf: (file) => names.get(file) || basename(file, ".jsonl"),
    limit: 120,
    onProgress: (p) => {
      if (!e.sender.isDestroyed())
        e.sender.send("pi:search-progress", { type: "searchProgress", ...p });
    },
  });
  return { ok: true, query: q, hits };
});

// ─── IPC: telemetry + diff viewer ────────────────────────────────────

ipcMain.handle("pi:get-stats", async (e) => {
  const session = sessionFor(e.sender);
  if (!session) return null;
  return session.statsSnapshot();
});

/**
 * Shared diff entry point. pi-chat's rewind widget sends absPath + baselineHash
 * + sessionId, so the baseline snapshot can be resolved without guessing.
 */
async function showDiffFor(
  sender: Electron.WebContents,
  msg:
    | { absPath?: string; baselineHash?: string | null; sessionId?: string; basename?: string }
    | undefined,
): Promise<{ ok: boolean; error?: string }> {
  const session = sessionFor(sender);
  let sessionId = msg?.sessionId ? String(msg.sessionId) : "";
  if (!sessionId && session) {
    try {
      sessionId = (await session.rpc.getState()).sessionId || "";
    } catch {
      // fall through: the diff still renders without a snapshot baseline
    }
  }
  return openDiffWindow({
    absPath: String(msg?.absPath || ""),
    baselineHash: msg?.baselineHash ?? null,
    sessionId,
    basename: msg?.basename,
  });
}

ipcMain.handle(
  "pi:show-diff",
  async (
    e,
    msg: { absPath?: string; baselineHash?: string | null; sessionId?: string; basename?: string },
  ) => showDiffFor(e.sender, msg),
);

ipcMain.handle("pi:get-commands", async (e) => {
  const session = sessionFor(e.sender);
  if (!session) return [];
  try {
    return await session.rpc.getCommands();
  } catch (e2) {
    log.warn("get-commands:", errText(e2));
    return [];
  }
});

/** Theme toggle from the chat window (palette / shortcut). Returns the new token CSS. */
ipcMain.handle("pi:set-theme", async (_e, theme: string) => {
  const next = theme === "light" || theme === "dark" || theme === "system" ? theme : "dark";
  saveConfig({ ...config, theme: next });
  return { ok: true, theme: next, css: buildTokensCss(next, config.accent) };
});

// ─── IPC: extension packages + provider auth (pi CLI one-shots) ───────

/** Resolved pi executable for CLI subcommands (same lookup the RPC client uses). */
function piCliPath(): string {
  return findPiBinary(config.piPath || undefined);
}

ipcMain.handle("pi:pkg-list", async () => {
  const res = await runPiCli(piCliPath(), ["list"], {
    timeoutMs: 30_000,
    cwd: config.workspaceRoot || undefined,
  });
  const packages = parseInstalledPackages(res.stdout);
  if (!res.ok && packages.length === 0) {
    return { ok: false, error: res.error || res.stderr || "pi list 执行失败", packages: [] };
  }
  return { ok: true, packages, raw: res.stdout.trim() };
});

ipcMain.handle("pi:pkg-install", async (_e, source: string) => {
  const src = String(source || "").trim();
  if (!isSafePackageSource(src)) {
    return {
      ok: false,
      error: "安装源无效。示例：npm:@scope/pkg、git:github.com/user/repo、https://…",
    };
  }
  const res = await runPiCli(piCliPath(), ["install", src], {
    timeoutMs: 300_000,
    cwd: config.workspaceRoot || undefined,
  });
  return {
    ok: res.ok,
    error: res.ok ? undefined : res.error || res.stderr || `安装失败（exit ${res.code}）`,
    output: `${res.stdout}\n${res.stderr}`.trim().slice(0, 4000),
  };
});

ipcMain.handle("pi:pkg-remove", async (_e, source: string) => {
  const src = String(source || "").trim();
  if (!isSafePackageSource(src)) return { ok: false, error: "扩展源无效" };
  const res = await runPiCli(piCliPath(), ["remove", src], {
    timeoutMs: 120_000,
    cwd: config.workspaceRoot || undefined,
  });
  return {
    ok: res.ok,
    error: res.ok ? undefined : res.error || res.stderr || `移除失败（exit ${res.code}）`,
    output: `${res.stdout}\n${res.stderr}`.trim().slice(0, 4000),
  };
});

/**
 * Provider readiness via `pi auth check --json`. This is read-only: new OAuth
 * logins still have to happen in the pi CLI (the RPC protocol has no login),
 * but pi refreshes expired credentials itself, so this is the honest status.
 */
ipcMain.handle("pi:auth-status", async (_e, providers: string[]) => {
  const list = Array.isArray(providers)
    ? providers.filter((p) => typeof p === "string" && /^[a-z0-9._-]{1,40}$/i.test(p)).slice(0, 12)
    : [];
  const results: AuthStatus[] = [];
  for (const provider of list) {
    const res = await runPiCli(piCliPath(), ["auth", "check", "--provider", provider, "--json"], {
      timeoutMs: 30_000,
      cwd: config.workspaceRoot || undefined,
    });
    const parsed = parseAuthStatus(res.stdout);
    results.push(
      parsed ?? {
        provider,
        status: res.ok ? "unknown" : "error",
        reason: (res.error || res.stderr || "").trim().slice(0, 200) || undefined,
      },
    );
  }
  return { ok: true, results };
});

// ─── IPC: skills (read / create / edit SKILL.md) ──────────────────────

const SKILLS_DIR = join(PI_AGENT_DIR, "skills");

/** Skill directory names are used as path segments — nothing else is allowed. */
function safeSkillName(name: string): string | null {
  const n = String(name || "").trim();
  if (!n || n.length > 64) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(n)) return null;
  if (n === "." || n === "..") return null;
  return n;
}

ipcMain.handle("pi:read-skill", async (_e, name: string) => {
  const safe = safeSkillName(name);
  if (!safe) return { ok: false, error: "技能名无效" };
  try {
    const content = await readFile(join(SKILLS_DIR, safe, "SKILL.md"), "utf8");
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

ipcMain.handle(
  "pi:write-skill",
  async (_e, msg: { name?: string; content?: string; renameFrom?: string }) => {
    const safe = safeSkillName(String(msg?.name || ""));
    if (!safe) return { ok: false, error: "技能名只能包含字母、数字、点、下划线和短横线" };
    const content = String(msg?.content ?? "");
    if (content.length > 512 * 1024) return { ok: false, error: "内容过大（上限 512 KB）" };
    const dir = join(SKILLS_DIR, safe);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), content, "utf8");
      // Optional rename of an existing skill directory (edit-in-place keeps the name)
      const from = msg?.renameFrom ? safeSkillName(String(msg.renameFrom)) : null;
      if (from && from !== safe) {
        await rename(join(SKILLS_DIR, from), join(SKILLS_DIR, safe)).catch((e: unknown) =>
          log.warn("skill rename:", errText(e)),
        );
      }
      return { ok: true, path: join(dir, "SKILL.md") };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  },
);

ipcMain.handle("pi:delete-skill", async (_e, name: string) => {
  const safe = safeSkillName(name);
  if (!safe) return { ok: false, error: "技能名无效" };
  try {
    await rm(join(SKILLS_DIR, safe), { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

// ─── IPC: PTY terminal (the portable half of upstream's terminal TUI) ──

/** One terminal per window; the pi TUI is spawned exactly like the chat session. */
const terminals = new Map<number, TerminalHandle>();

function disposeTerminalFor(webContentsId: number): void {
  const handle = terminals.get(webContentsId);
  if (!handle) return;
  handle.kill();
  terminals.delete(webContentsId);
}

ipcMain.handle(
  "pi:term-open",
  async (
    e,
    msg: { kind?: string; cols?: number; rows?: number; sessionFile?: string } | undefined,
  ) => {
    const sender = e.sender;
    disposeTerminalFor(sender.id);
    // Killing a ConPTY on Windows leaves state behind for a moment; creating the
    // replacement in the same tick made the new shell exit on its first write
    // (the dock then sat on a dead terminal that swallowed every keystroke).
    await new Promise((resolve) => setTimeout(resolve, 250));
    // The terminal follows the window's pi session so `pi` resumes the same chat.
    const session = sessionFor(sender);
    const kind: TerminalKind = msg?.kind === "shell" ? "shell" : "pi";
    const result = createTerminal({
      kind,
      cwd: config.workspaceRoot || homedir(),
      piPath: findPiBinary(config.piPath || undefined),
      extensionArgs: buildExtensionArgs(app.getAppPath(), config),
      sessionFile: msg?.sessionFile || session?.sessionFile,
      env: buildEnv(config, app.getAppPath()),
      cols: Number(msg?.cols) || 80,
      rows: Number(msg?.rows) || 24,
      onData: (data) => {
        if (!sender.isDestroyed()) sender.send("pi:term-data", { data });
      },
      onExit: (code) => {
        terminals.delete(sender.id);
        if (!sender.isDestroyed()) sender.send("pi:term-exit", { code });
      },
    });
    if (!result.ok) return { ok: false, error: result.error };
    const handle = result.handle;
    terminals.set(sender.id, handle);
    return { ok: true, kind: handle.kind, shell: handle.shell, cwd: handle.cwd, pid: handle.pid };
  },
);

ipcMain.handle("pi:term-input", (e, data: string) => {
  const term = terminals.get(e.sender.id);
  // Say so instead of swallowing the keystrokes: the dock creates its PTY
  // asynchronously, so a write can arrive before there is anything to write to.
  if (!term) return { ok: false, error: "终端尚未就绪" };
  term.write(String(data ?? ""));
  return { ok: true };
});

ipcMain.handle("pi:term-resize", (e, msg: { cols?: number; rows?: number }) => {
  terminals.get(e.sender.id)?.resize(Number(msg?.cols) || 80, Number(msg?.rows) || 24);
  return { ok: true };
});

ipcMain.handle("pi:term-close", (e) => {
  disposeTerminalFor(e.sender.id);
  return { ok: true };
});

// ─── IPC: workspace files (file panel / add-to-chat) ───────────────────

/** Every file path from the renderer is resolved against the workspace root. */
function workspaceRootDir(): string {
  return config.workspaceRoot || homedir();
}

const FS_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".vscode",
  ".idea",
  "dist",
  "dist-electron",
  "build",
  "__pycache__",
  ".next",
  ".cache",
  ".venv",
]);

ipcMain.handle("pi:fs-tree", async (_e, relPath: string) => {
  const root = String(relPath || ".");
  const dir = safeWorkspacePath(workspaceRootDir(), root);
  if (!dir) return { ok: false, error: "路径无效" };
  try {
    const entries = await readdirAsync(dir, { withFileTypes: true });
    const items = entries
      .filter((en) => !FS_SKIP_DIRS.has(en.name))
      .map((en) => ({
        name: en.name,
        dir: en.isDirectory(),
        path: root === "." ? en.name : `${root}/${en.name}`,
      }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
      .slice(0, 500);
    return { ok: true, root: workspaceRootDir(), path: root, items };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

ipcMain.handle("pi:fs-read", async (_e, relPath: string) => {
  const full = safeWorkspacePath(workspaceRootDir(), relPath);
  if (!full) return { ok: false, error: "路径无效" };
  try {
    const st = await stat(full);
    if (st.size > 4 * 1024 * 1024) return { ok: false, error: "文件过大（上限 4 MB）" };
    const content = await readFile(full, "utf8");
    return { ok: true, content, path: String(relPath), size: st.size };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

ipcMain.handle("pi:fs-write", async (_e, msg: { path?: string; content?: string }) => {
  const full = safeWorkspacePath(workspaceRootDir(), String(msg?.path || ""));
  if (!full) return { ok: false, error: "路径无效" };
  const content = String(msg?.content ?? "");
  if (content.length > 4 * 1024 * 1024) return { ok: false, error: "内容过大（上限 4 MB）" };
  try {
    await writeFile(full, content, "utf8");
    return { ok: true, path: String(msg?.path || "") };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

// ─── IPC: git (branch, diff, commit message) ─────────────────────────

ipcMain.handle("pi:git-info", async () => {
  const cwd = workspaceRootDir();
  const inside = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside.ok || !inside.stdout.trim().startsWith("true")) {
    return { ok: true, repo: false };
  }
  const [branch, statusRaw, stagedNumstat, unstagedNumstat] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    git(["status", "--porcelain"], cwd),
    git(["diff", "--cached", "--numstat"], cwd),
    git(["diff", "--numstat"], cwd),
  ]);
  const parseNumstat = (raw: string): Array<{ path: string; added: number; removed: number }> =>
    raw
      .split("\n")
      .map((l) => l.trim().split("\t"))
      .filter((p) => p.length === 3)
      .map((p) => ({
        path: p[2],
        added: p[0] === "-" ? 0 : Number(p[0]) || 0,
        removed: p[1] === "-" ? 0 : Number(p[1]) || 0,
      }));
  return {
    ok: true,
    repo: true,
    cwd,
    branch: branch.ok ? branch.stdout.trim() : "",
    changed: statusRaw.stdout.trim() ? statusRaw.stdout.trim().split("\n").length : 0,
    staged: parseNumstat(stagedNumstat.stdout),
    unstaged: parseNumstat(unstagedNumstat.stdout),
  };
});

ipcMain.handle(
  "pi:git-commit-message",
  async (_e, msg: { stagedOnly?: boolean; notes?: string }) => {
    const cwd = workspaceRootDir();
    const stagedOnly = msg?.stagedOnly !== false;
    const diffArgs = stagedOnly ? ["diff", "--cached"] : ["diff", "HEAD"];
    let diff = (await git(diffArgs, cwd, 60_000)).stdout;
    if (!diff.trim()) {
      // nothing staged (or no HEAD yet) — fall back to the working tree
      diff = (await git(["diff"], cwd, 60_000)).stdout;
    }
    if (!diff.trim()) return { ok: false, error: "没有可用的改动（请先 git add 或修改文件）" };

    return generateCommitMessage({
      piPath: piCliPath(),
      cwd,
      diff,
      currentInput: String(msg?.notes || ""),
      language: config.commitLanguage || "English",
      systemPrompt: config.commitMessagePrompt || "",
    });
  },
);

// ─── IPC: pi changelog (port of upstream pi-changelog.ts) ─────────────

ipcMain.handle("pi:changelog", async () => {
  const res = await readPiChangelog(findPiBinary(config.piPath || undefined));
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, content: res.content, root: res.root, version: res.version };
});

// ─── IPC: provider login (drives pi's own /login in the built-in terminal) ──

/**
 * OAuth belongs to pi: its TUI has `/login <provider>` and the SDK's
 * ModelRuntime writes the credentials to auth.json. Rather than re-implement the
 * OAuth dance (upstream drove the pi SDK's login() from its webview), the app
 * opens its own PTY terminal on the pi TUI and types the command, then the
 * readiness check reports the result.
 */
ipcMain.handle("pi:login-provider", (_e, provider: string) => {
  const id = String(provider || "").trim();
  if (!/^[a-z0-9._-]{1,40}$/i.test(id)) return { ok: false, error: "提供商无效" };
  const win = mainWindow;
  if (!win || win.isDestroyed()) return { ok: false, error: "主窗口不可用" };
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send("pi:login-request", { provider: id });
  return { ok: true, provider: id };
});

// ─── IPC: diagnostics ────────────────────────────────────────────────

function diagnosticsInfo(): string {
  const masked = {
    ...config,
    env: Object.fromEntries(Object.keys(config.env || {}).map((k) => [k, "••••"])),
  };
  return [
    `Pi Heao GUI ${app.getVersion()}`,
    `electron ${process.versions.electron}  chrome ${process.versions.chrome}  node ${process.versions.node}`,
    `platform ${process.platform} ${process.arch}`,
    `userData ${app.getPath("userData")}`,
    `pi agent dir ${PI_AGENT_DIR}`,
    `workspace ${config.workspaceRoot || "(home)"}`,
    `theme ${config.theme} accent ${config.accent}`,
    `rpc log ${getRpcLogPath()}`,
    "",
    "config:",
    JSON.stringify(masked, null, 2),
  ].join("\n");
}

async function tailLog(lines = 200): Promise<string> {
  try {
    const raw = await readFile(getRpcLogPath(), "utf8");
    return raw.split("\n").slice(-lines).join("\n");
  } catch (e) {
    return `（无法读取日志：${errText(e)}）`;
  }
}

ipcMain.handle("pi:diagnostics", async (_e, op: string) => {
  const action = String(op || "info");
  if (action === "info") return { ok: true, info: diagnosticsInfo() };
  if (action === "log") return { ok: true, info: await tailLog() };
  if (action === "copy") return { ok: true, info: diagnosticsInfo() };
  if (action === "open-logs") {
    void shell.openPath(dirname(getRpcLogPath()));
    return { ok: true };
  }
  if (action === "open-userdata") {
    void shell.openPath(app.getPath("userData"));
    return { ok: true };
  }
  if (action === "report") {
    const dir = join(app.getPath("userData"), "diagnostics");
    await mkdir(dir, { recursive: true });
    const file = join(dir, `diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
    const body = `${diagnosticsInfo()}\n\n===== rpc log (tail 400) =====\n${await tailLog(400)}\n`;
    await writeFile(file, body, "utf8");
    void shell.openPath(dir);
    return { ok: true, path: file };
  }
  return { ok: false, error: "未知操作" };
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

ipcMain.handle(IPC.LIST_SESSIONS, async () => {
  const items = await getSessionLister().list();
  // Keep the tray's "recent sessions" submenu in step with the sidebar.
  setRecentSessions(items.slice(0, 8).map((i) => ({ label: i.name, file: i.file })));
  return items;
});

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
        if (!isSessionFile(file)) {
          log.warn("ipc switchSession: refused path", file);
          return { ok: false, error: "会话文件无效（必须在 ~/.pi/agent/sessions 下）" };
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

// rewindDiff: render the change in our own diff window (baseline = the rewind
// snapshot, current = the file on disk). Previously this handed the file to the
// OS default application, which meant no diff at all.
ipcMain.handle(
  IPC.REWIND_DIFF,
  async (
    e,
    msg: { absPath?: string; baselineHash?: string | null; sessionId?: string; basename?: string },
  ) => {
    if (!msg?.absPath) return { ok: false, error: "empty path" };
    return showDiffFor(e.sender, msg);
  },
);

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
              message: "Pi Heao GUI V1.1",
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

/**
 * First-run guidance. A fresh download has no pi CLI, and the shell is useless
 * without it — so say so once per version instead of failing silently.
 */
async function checkPiAvailable(): Promise<void> {
  const pi = findPiBinary(config.piPath || undefined);
  if (pi && existsSync(pi)) return;
  if (config.lastOnboardedVersion === app.getVersion()) return;
  saveConfig({ ...config, lastOnboardedVersion: app.getVersion() });

  const result = await dialog.showMessageBox({
    type: "warning",
    title: "缺少 pi CLI",
    message: "未检测到 pi CLI —— 对话无法启动",
    detail: [
      "Pi Heao GUI 只是外壳，真正的 agent 由 pi 提供。",
      "",
      "请先安装（需要 Node.js 22 或更高）：",
      "",
      "  npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
      "",
      "然后在「设置 → 模型配置」填入 API Key（或用「提供商就绪检查 → 登录」完成 OAuth），",
      "再重启本应用即可开始对话。",
    ].join("\n"),
    buttons: ["打开设置", "我知道了"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (result.response === 0) openSettingsWindow();
}

app.whenReady().then(async () => {
  if (!singleInstance) return;
  sweepStaleTempFiles();
  setupChineseMenu();
  await createWindow();
  const trayReady = createTray(
    {
      getMainWindow: () => mainWindow,
      openSession: (file) => {
        if (!isSessionFile(file)) return;
        void openSessionWindow(file);
      },
      newSession: () => {
        const win = mainWindow;
        if (!win) return;
        win.show();
        win.focus();
        postToWindow(win, { type: "newSession" });
      },
      openSettings: () => openSettingsWindow(),
    },
    resolveUiLang(config.uiLanguage ?? "auto"),
  );

  // Background update check for packaged builds: late enough not to compete with
  // startup, and skipped entirely when the user turned it off.
  if (config.autoCheckUpdates) {
    setTimeout(() => void ensureUpdater(), 20_000);
  }

  // Unread counter: clearing happens whenever the window regains focus.
  mainWindow?.on("focus", () => {
    setUnreadCount(0);
    mainWindow?.flashFrame(false);
  });

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
          host: sessionHost(win),
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

  // After the shell is up, tell a first-time user what is missing.
  void checkPiAvailable();
});

app.on("before-quit", () => {
  markQuitting();
  for (const session of windowSessions.values()) session.dispose();
  windowSessions.clear();
});

app.on("will-quit", () => {
  for (const id of [...terminals.keys()]) disposeTerminalFor(id);
  destroyTray();
  cleanupTempFiles();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
