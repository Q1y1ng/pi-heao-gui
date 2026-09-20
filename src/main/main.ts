import {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  dialog,
  shell,
  Menu,
  webContents,
  screen,
  type WebContents,
} from "electron";
import { join, sep, basename, dirname, resolve } from "node:path";
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
import { type StandaloneConfig, DEFAULT_CONFIG, DEFAULT_DANGEROUS_PATTERNS, IPC } from "../shared/types";
import { buildChatHtml } from "./chat-adapter";
import { isWithin, safeWorkspacePath } from "./fs-path";
import {
  createChatSession,
  type ChatSession,
  findPiBinary,
  buildExtensionArgs,
  buildEnv,
} from "./chat-session";
import { createTerminal, type TerminalHandle, type TerminalKind } from "./terminal";
import {
  generateCommitMessage,
  git,
  isSafeBranchName,
  listWorktrees,
  worktreePathFor,
} from "./git";
import { readPiChangelog } from "./changelog";
import { resolveUiLang } from "./i18n";
import {
  isSessionFile as isSessionFilePath,
  renameSession,
  deleteSession,
  archiveSession,
  restoreSession,
  listArchived,
  importSession,
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
import { mediaMimeFor, previewKindFor } from "./file-kind";
import { buildTokensCss } from "./theme";
import { refreshTrayMenu, setRecentSessions, setWindowList, bumpUnread, clearUnread } from "./tray";
import { createSessionLister, type SessionLister } from "./sessions";
import {
  authToPublic,
  checkOpenPath,
  parseJsonObject,
  redactSecrets,
  restoreMaskedSecrets,
  sanitizeConfig,
  type JsonValue,
} from "./config";
import { log, errText } from "./log";
import { installNavigationGuards } from "./navigation";
import { createDecisionQueue, describeRequest } from "./decisions";
import { createProjectStore } from "./projects";
import { createWindowStatusBoard } from "./window-status";
import { getSpawnQueue, profileKey } from "./spawn-queue";
import { buildSettingsHtml } from "./settings-window";
import {
  createTray,
  showNotification,
  destroyTray,
  markQuitting,
  isQuitting,
  unreadFor,
} from "./tray";
import { disposeAlerts, fireAlert, isAlertNotifierWindow, playChime } from "./alerts";
import {
  createUpdateController,
  PORTABLE_REASON,
  type UpdateController,
  type UpdaterLike,
} from "./updater";

// ─── Updates ────────────────────────────────────────────────────────────────
// electron-updater is loaded lazily: it is optional at runtime, and a build that
// cannot load it must still start and answer "updates unavailable".
let updateController: UpdateController | null = null;
let updaterLoading: Promise<void> | null = null;

/**
 * Whether this process is the portable build.
 *
 * electron-builder's portable launcher sets `PORTABLE_EXECUTABLE_FILE` (and the `_DIR` / app-name
 * siblings) in the child environment — that is the only way it is distinguishable at runtime from
 * the installed build, and the two need different answers to "is there an update?".
 */
function isPortableBuild(): boolean {
  return !!process.env.PORTABLE_EXECUTABLE_FILE;
}

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
        isPortable: isPortableBuild(),
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
  if (!app.isPackaged) return { state: "unavailable", reason: "当前为源码运行，不检查更新" };
  if (isPortableBuild()) return { state: "unavailable", reason: PORTABLE_REASON };
  return { state: "idle" };
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
  decisions: IPC.DECISIONS,
  windowStatus: IPC.WINDOW_STATUS,
  projects: IPC.PROJECTS,
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

// ─── Alerts: "a person is required" ────────────────────────────────────

/** A dialog nobody has answered is repeated this many times in total. */
const DECISION_ALERT_ATTEMPTS = 3;
const DECISION_ALERT_REPEAT_MS = 5000;
/** window id -> pending repeat timers */
const decisionAlerts = new Map<number, NodeJS.Timeout[]>();

function fireDecisionAlert(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  fireAlert("decision", config.alerts, win.isFocused());
}

/**
 * A dialog is the one signal that a person is required — a permission, an
 * elevation, a confirmation. It is heard even when its window has focus, because
 * the turn is blocked until someone answers; the repeats only happen while that
 * window stays in the background, so watching it does not mean hearing it three
 * times. Answering, focusing, switching session or closing the window all stop it.
 */
function scheduleDecisionAlerts(win: BrowserWindow): void {
  cancelDecisionAlerts(win.id);
  fireDecisionAlert(win);
  const timers: NodeJS.Timeout[] = [];
  for (let i = 1; i < DECISION_ALERT_ATTEMPTS; i++) {
    const t = setTimeout(() => {
      if (win.isDestroyed() || win.isFocused()) return;
      fireDecisionAlert(win);
    }, i * DECISION_ALERT_REPEAT_MS);
    // A pending reminder is never a reason to keep the process alive.
    t.unref?.();
    timers.push(t);
  }
  decisionAlerts.set(win.id, timers);
}

function cancelDecisionAlerts(windowId: number): void {
  const timers = decisionAlerts.get(windowId);
  if (!timers) return;
  for (const t of timers) clearTimeout(t);
  decisionAlerts.delete(windowId);
}

function cancelAllDecisionAlerts(): void {
  for (const id of [...decisionAlerts.keys()]) cancelDecisionAlerts(id);
}

// ─── The list of decisions nobody has answered yet ─────────────────────
//
// The chime above says "someone is required"; this says *who* and *for what*, in every window. The
// list is global on purpose: a decision can be raised in a child window, in a session that is not on
// screen, or in the window nobody is looking at, and the panel is how the person finds it.
const decisions = createDecisionQueue({ log: (message) => log.info(message) });

// What every window is doing, for the board (see window-status.ts). Same shape as the decision list:
// the main process is the only place that can see all the windows, so it keeps the state and pushes
// it, and every window's board shows the same rows.
const windowStatus = createWindowStatusBoard();

// ─── Saved projects ───────────────────────────────────────────────────
//
// A project is a directory plus the name to call it (see projects.ts). The store is thin — the list
// lives in the config file, which is also the file a person may edit by hand — and everything that
// follows a workspace (session, terminal, git pane, file tree) keeps following the window's `cwd`.
// What a project buys is that switching between them stops meaning "walk the native picker again".
const projects = createProjectStore({
  load: () => config.projects || [],
  save: (list) => saveConfig({ ...config, projects: list }),
});

projects.onChange(() => {
  const items = projects.list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) postToWindow(win, { type: "projects", items });
  }
});

windowStatus.onChange(() => {
  const items = windowStatus.list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) postToWindow(win, { type: "windowStatus", items });
  }
});

/** Keep each window's "waiting" count in step with the decision list. */
function refreshWaiting(): void {
  const items = decisions.list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    windowStatus.update(win.id, { waiting: items.filter((d) => d.windowId === win.id).length });
  }
}

decisions.onChange(() => {
  refreshWaiting();
  const items = decisions.list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) postToWindow(win, { type: "decisions", items });
  }
});

/**
 * What to call a window in that list. Session windows are titled after their session, so their title
 * is the useful half; the main window and the settings window are not, and a bare id is.
 */
function decisionWindowLabel(win: BrowserWindow): string {
  const title = win.getTitle().trim();
  if (win === mainWindow) return "主窗口";
  if (title && !/^Pi Heao (GUI|设置)/.test(title)) return title;
  return `窗口 #${win.id}`;
}

function postToWindow(win: BrowserWindow, msg: unknown): void {
  if (win.isDestroyed()) return;
  const type = (msg as { type?: string } | null)?.type;
  const channel = type ? MSG_TYPE_TO_CHANNEL[type] : undefined;
  if (channel) win.webContents.send(channel, msg);
  else log.warn("unknown msg type for renderer:", type);
  // PI_DEBUG_WINDOW counts what the host actually sends to a window: the child shell with all
  // its panels stripped renders a full page and then shows no session, and the question is
  // whether the host ever sends it anything at all. See docs/KNOWN-ISSUES.md.
  if (process.env.PI_DEBUG_WINDOW === "1") {
    console.error(
      `[host->${win.webContents.id}] ${String((msg as { type?: string })?.type ?? "?")}`,
    );
  }
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
/**
 * Write a file by writing a sibling temp file first and renaming it over the
 * target. What matters is the crash case: an interrupted writeFileSync leaves a
 * truncated file, and for config.json that means the user's workspace, theme,
 * favourites and budgets are gone. rename() replaces the destination on Windows
 * too, so the new content appears whole or not at all.
 */
function writeFileAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp-${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, target);
}

function saveConfig(next: StandaloneConfig): void {
  config = sanitizeConfig(next);
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileAtomic(CONFIG_PATH, JSON.stringify(config, null, 2));
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

// One shell file per (variant, baked-in config), reused by every window. The page is
// ~5.7 MB of inlined UI: building and writing it once per window was pure waste — in
// bytes on disk and in the time it takes a window to appear. Theme and accent are
// applied live by the shim, so only the values compiled into the document are part of
// the key; changing the font size simply produces the next key.
const chatShellFiles = new Map<string, string>();

function chatShellFile(variant: "full" | "minimal"): string | null {
  const key = `${variant}|${JSON.stringify([
    config.chatFontSize,
    config.workspaceRoot,
    config.language,
    config.theme,
    config.accent,
    config.uiLanguage,
    config.chatBackgroundImage,
    config.chatBackgroundOpacity,
    config.chatMermaidTheme,
    config.chatSendShortcut,
  ])}`;
  const cached = chatShellFiles.get(key);
  if (cached && existsSync(cached)) return cached;
  const html = buildChatHtml(app.getAppPath(), config, { minimal: variant === "minimal" });
  if (!html) return null;
  const file = writeTempHtml(variant === "minimal" ? "pi-heao-child" : "pi-heao-chat", html);
  chatShellFiles.set(key, file);
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
  const check = checkOpenPath(raw, config.workspaceRoot, protectedPaths());
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
    icon: join(__dirname, "..", "..", "build", "icon.png"),
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
    buildSettingsHtml(
      resolveUiLang(config.uiLanguage),
      config.theme,
      config.accent,
      config.chatFontSize,
      DEFAULT_DANGEROUS_PATTERNS,
    ),
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
    // The overlay draws the minimise / maximise / close buttons. Hardcoded dark values
    // left a black block in the corner of an otherwise light window.
    titleBarOverlay: overlayColors(config.theme),
    icon: join(__dirname, "..", "..", "build", "icon.png"),
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

  const tmpHtml = chatShellFile("full");
  if (tmpHtml) {
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

  registerShortcuts(mainWindow);
  refreshWindowList();

  mainWindow.on("closed", () => {
    if (mainWindowId >= 0) {
      windowSessions.delete(mainWindowId);
      disposeTerminalFor(mainWindowId);
      clearUnread(mainWindowId);
      cancelDecisionAlerts(mainWindowId);
      decisions.dropWindow(mainWindowId);
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

/**
 * Which window drives which session file. One session must have exactly one
 * writer: pi appends to a single .jsonl per session, so two windows running the
 * same one would interleave their turns and leave behind a history neither wrote.
 */
const windowsBySession = new Map<string, BrowserWindow>();

const sessionKey = (file: string): string => resolve(file).toLowerCase();

function windowForWebContentsId(id: number): BrowserWindow | null {
  const wc = webContents.fromId(id);
  return wc && !wc.isDestroyed() ? BrowserWindow.fromWebContents(wc) : null;
}

/** The window already driving this session, if any — child or main. */
function windowDrivingSession(file: string): BrowserWindow | null {
  const key = sessionKey(file);
  const known = windowsBySession.get(key);
  if (known) {
    if (!known.isDestroyed()) return known;
    windowsBySession.delete(key);
  }
  // The main window's session is created through createWindow, not through this
  // path, so it is only visible through its chat session's live state.
  for (const [wcId, session] of windowSessions) {
    const current = session.statsSnapshot().sessionFile;
    if (current && sessionKey(current) === key) return windowForWebContentsId(wcId);
  }
  return null;
}

/**
 * Where a dragged-out window should land: at the pointer, on the display the
 * pointer is on, clamped so its title bar stays reachable. The renderer's
 * screenX/screenY are CSS pixels and Electron's work area is in DIP, which on
 * Windows are the same unit — so no scale conversion is involved.
 */
function boundsNear(where?: { screenX?: number; screenY?: number }): Electron.Rectangle {
  const width = 1000;
  const height = 720;
  const x0 = Number(where?.screenX);
  const y0 = Number(where?.screenY);
  const dropped = Number.isFinite(x0) && Number.isFinite(y0);
  const area = dropped
    ? screen.getDisplayNearestPoint({ x: Math.round(x0), y: Math.round(y0) }).workArea
    : screen.getPrimaryDisplay().workArea;
  // Centred on that display when there is no drop point (menu, Ctrl+Shift+N).
  const cx = dropped ? x0 : area.x + (area.width - width) / 2;
  const cy = dropped ? y0 : area.y + (area.height - height) / 2;
  return {
    x: Math.round(Math.min(Math.max(cx - width / 2, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(cy - 30, area.y), area.y + area.height - height)),
    width,
    height,
  };
}

/**
 * The tray's window list. Only interesting with more than one window, which is why
 * setWindowList ignores a single entry.
 */
function refreshWindowList(): void {
  setWindowList(
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && !isAlertNotifierWindow(w))
      .map((w) => ({ id: w.id, label: w.getTitle() || "Pi Heao GUI" })),
  );
}

// ─── Window state: reopen what was open ───────────────────────────────

interface RestoredWindow {
  file: string;
  bounds: Electron.Rectangle;
}

const windowsStatePath = (): string => join(app.getPath("userData"), "session-windows.json");

/** Remember which sessions had their own window, for the next launch. */
function saveWindowState(): void {
  const items: RestoredWindow[] = [];
  for (const [file, win] of windowsBySession) {
    if (win.isDestroyed()) continue;
    items.push({ file, bounds: win.getBounds() });
  }
  try {
    writeFileSync(windowsStatePath(), JSON.stringify({ windows: items.slice(0, 8) }, null, 2));
  } catch (e) {
    log.warn("window state not saved:", errText(e));
  }
}

/**
 * Reopen the windows the last run left behind. Opt-out via config, and skipped
 * outright when a test harness sets PI_NO_RESTORE=1 — a restored window appearing
 * mid-run would change what the e2e sees without it having asked for one.
 */
async function restoreWindowState(): Promise<void> {
  if (!config.restoreWindows || process.env.PI_NO_RESTORE === "1") return;
  let parsed: { windows?: RestoredWindow[] } = {};
  try {
    parsed = JSON.parse(readFileSync(windowsStatePath(), "utf8")) as { windows?: RestoredWindow[] };
  } catch {
    return; // never saved, or unreadable: nothing to restore
  }
  const items = Array.isArray(parsed.windows) ? parsed.windows.slice(0, 8) : [];
  for (const item of items) {
    const file = String(item?.file || "");
    if (!file || !isSessionFile(file) || !existsSync(file)) continue;
    await openSessionWindow(file, { bounds: item.bounds });
  }
}

/** Ctrl+Shift+N opens a fresh session in its own window. */
function registerShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    if (String(input.key).toLowerCase() !== "n") return;
    event.preventDefault();
    void openSessionWindow();
  });
}

/**
 * Each session window runs its own pi process (~250 MB) and its own renderer
 * (~130 MB), so an unbounded number of them is a memory leak with a nicer name.
 */
const MAX_SESSION_WINDOWS = 6;

async function openSessionWindow(
  sessionFile?: string,
  where?: { screenX?: number; screenY?: number; bounds?: Electron.Rectangle },
  /**
   * Where this window's pi should run, when that is not the app-wide workspace — the one caller is
   * "new working copy": the point of a worktree is to run something *else* in parallel, so the
   * window that asked keeps its own directory. `label` is what the title bar calls it (the branch).
   */
  opts?: { cwd?: string; label?: string },
): Promise<{ ok: boolean; focused?: boolean; error?: string; windowId?: number }> {
  if (sessionFile) {
    // Focusing the window that already drives this session is the whole point of
    // the guard: a second writer would corrupt the session file.
    const existing = windowDrivingSession(sessionFile);
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { ok: true, focused: true };
    }
  }
  // Each window runs its own pi process and renderer — the two biggest things this
  // app allocates — so the cap is enforced rather than discovered by the OOM killer.
  const liveChildren = [...childWindows].filter((w) => !w.isDestroyed());
  if (liveChildren.length >= MAX_SESSION_WINDOWS) {
    return {
      ok: false,
      error: `会话窗口已达上限 ${MAX_SESSION_WINDOWS} 个（每个窗口都会独立启动 pi，约需 380 MB 内存）；请先关掉一个`,
    };
  }

  const placement = where?.bounds ?? boundsNear(where);
  // A window is titled after what it is about: the branch it was made for, the session it shows, or
  // nothing at all (a fresh session that has not been written yet).
  const label = opts?.label ?? (sessionFile ? basename(sessionFile, ".jsonl") : "");
  const title = label ? `Pi — ${label}` : "Pi Heao GUI";
  const win = new BrowserWindow({
    ...placement,
    minWidth: 700,
    minHeight: 450,
    title,
    backgroundColor: "#1e1e1e",
    titleBarStyle: "hidden",
    titleBarOverlay: overlayColors(config.theme),
    icon: join(__dirname, "..", "..", "build", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  childWindows.add(win);
  windowStatus.update(win.id, {
    label: label || "Pi Heao GUI",
    sessionFile,
    touchedAt: Date.now(),
  });
  debugWindow(`child window created ${win.webContents.id}`);
  // The chat page sets its own <title> ("Pi Heao GUI"), and Electron copies a page
  // title over the window title — which is how a window about one session ended up
  // indistinguishable from the main one. For these windows the session name wins.
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(title);
    refreshWindowList();
  });
  registerShortcuts(win);
  const childWinId = win.webContents.id;
  if (sessionFile) windowsBySession.set(sessionKey(sessionFile), win);
  refreshWindowList();

  // Each child window gets a cloned config with the target session
  const childConfig: StandaloneConfig = { ...config };
  // The stripped shell: a drag bar with the session name, and the chat. No sidebar,
  // no dock, no palette — this window is a place to watch one session, while the main
  // window stays the control centre for switching, terminals and everything else.
  //
  // It opened empty once, for a reason worth keeping in mind: preload's onMessage is a SINGLE
  // listener (see preload.ts), the shim holds it and re-emits every host message as a window
  // "message" event, and this shell's own title script registered on that same channel — replacing
  // the shim, so the vendored chat app received nothing and the window showed the right title with
  // an empty conversation and no error logged. The title script now listens for the forwarded
  // event instead. See docs/KNOWN-ISSUES.md.
  //
  // Diagnostics: PI_MINIMAL_CHILD=0 puts a child on the full shell for comparison, and
  // PI_DEBUG_WINDOW=1 prints what the child renderer says — console output, preload errors, load
  // failures, renderer death — plus a DOM fingerprint and a time series, to the main process
  // stdout. Both are off by default; the shell choice defaults to the stripped one.
  if (process.env.PI_DEBUG_WINDOW === "1") {
    const tag = `[child ${win.webContents.id}]`;
    win.webContents.on("console-message", (event, level, message, line, sourceId) => {
      // SAFETY: Electron has two shapes for this event — the event object with the message
      // on it (current) and the older positional arguments — so the fields are read from
      // whichever is present. The cast keeps the handler assignable to the declared overload.
      const e = event as unknown as {
        level?: string;
        message?: string;
        lineNumber?: number;
        sourceId?: string;
      };
      const text = e?.message ?? message;
      const where = e?.sourceId ?? sourceId;
      const at = e?.lineNumber ?? line;
      console.error(`${tag} console.${e?.level ?? level}: ${text} (${where}:${at})`);
    });
    win.webContents.on("preload-error", (_event, path, error) => {
      console.error(`${tag} preload-error ${path}: ${error?.message ?? String(error)}`);
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error(`${tag} render-process-gone ${JSON.stringify(details)}`);
    });
    win.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.error(`${tag} did-fail-load ${code} ${description} ${url}`);
    });
    const probe = setTimeout(() => {
      if (win.isDestroyed()) return;
      void win.webContents
        .executeJavaScript(
          `JSON.stringify({
               shell: !!document.getElementById('pi-shell'),
               main: !!document.getElementById('pi-main'),
               msgs: document.querySelectorAll('.msg').length,
               mainChars: (document.getElementById('pi-main') || { innerHTML: '' }).innerHTML.length,
               bodyChars: (document.body || { innerHTML: '' }).innerHTML.length,
               globals: ['piChrome','piShell','piSidebar','piDock','piStats','piPalette','piTokens','piHost']
                 .filter((k) => k in window),
               top: Array.from(document.body.children)
                 .slice(0, 8)
                 .map((el) => ({
                   tag: el.tagName.toLowerCase(),
                   id: el.id,
                   cls: String(el.className || '').slice(0, 100),
                   n: el.children.length,
                   chars: el.innerHTML.length,
                   text: (el.textContent || '').replace(/[ \n\r\t]+/g, ' ').trim().slice(0, 70),
                 })),
               // The class vocabulary of whatever is actually rendered. The earlier selectors
               // for "does the conversation show up" were guesses, and a guess that misses is
               // indistinguishable from an empty window — this is how the real names get read
               // off the page instead. See docs/KNOWN-ISSUES.md.
               chatish: (() => {
                 const out = [];
                 for (const el of document.querySelectorAll('div,section,ul,ol,main')) {
                   const cls = String(el.className || '');
                   if (/msg|message|chat|turn|bubble|conversation|transcript/i.test(cls) && el.children.length) {
                     out.push(cls.slice(0, 70) + '#' + el.children.length);
                     if (out.length >= 12) break;
                   }
                 }
                 return out;
               })(),
               bodyText: (document.body.textContent || '').replace(/[ \n\r\t]+/g, ' ').trim().slice(0, 200),
               msgSelectors: ['.msg', '.text-block', '.user-bubble', '.msg-body', '[data-role="user"]']
                 .map((s) => s + '=' + document.querySelectorAll(s).length),
             })`,
        )
        .then((result) => console.error(`${tag} dom ${String(result)}`))
        .catch((error) => console.error(`${tag} dom probe failed: ${String(error)}`));
    }, 8000);
    probe.unref();
    win.on("closed", () => clearTimeout(probe));
    // Samples over time, not once: at 8s both shells report zero conversation nodes and the
    // assertion only passes in one of them, so the question is which selector lights up and
    // when. The ancestor chain says where the chat actually rendered relative to #pi-shell,
    // which the byte counts alone cannot answer.
    const samples = [6000, 10000, 14000, 18000, 22000, 26000];
    const probes = samples.map((ms) =>
      setTimeout(() => {
        if (win.isDestroyed()) return;
        const script = `JSON.stringify({
             t: ${ms},
             sel: ['.msg', '.text-block', '.user-bubble', '.msg-body'].map((s) => s + '=' + document.querySelectorAll(s).length),
             // The font-size question, measured where the text actually is. An earlier attempt read
             // these off our own chrome and reported a healthy chain that said nothing about the
             // message text. See docs/KNOWN-ISSUES.md.
             fsVars: (() => {
               const cs = getComputedStyle(document.documentElement);
               return (
                 cs.getPropertyValue('--pi-fs-md').trim() +
                 ' / ' +
                 cs.getPropertyValue('--chat-fs').trim()
               );
             })(),
             textFs: (() => {
               const el = document.querySelector('.text-block, .msg');
               return el ? getComputedStyle(el).fontSize : null;
             })(),
             mainChars: (document.getElementById('pi-main') || { innerHTML: '' }).innerHTML.length,
             shellChars: (document.getElementById('pi-shell') || { innerHTML: '' }).innerHTML.length,
             path: (() => {
               const el = document.querySelector('.messages-wrap, .messages, .messages-inner');
               const out = [];
               for (let n = el; n && n !== document.documentElement && out.length < 7; n = n.parentElement) {
                 out.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className ? '.' + String(n.className).split(' ')[0] : ''));
               }
               return out.join(' < ');
             })(),
           })`;
        void win.webContents
          .executeJavaScript(script)
          .then((result) => console.error(`${tag} sample ${String(result)}`))
          .catch((error) => console.error(`${tag} sample failed: ${String(error)}`));
      }, ms),
    );
    for (const timer of probes) timer.unref();
    win.on("closed", () => {
      for (const timer of probes) clearTimeout(timer);
    });
  }
  const tmpHtml = chatShellFile(process.env.PI_MINIMAL_CHILD === "0" ? "full" : "minimal");
  debugWindow(`shell file ${tmpHtml ? `ok ${tmpHtml}` : "null"}`);
  if (tmpHtml) await win.loadFile(tmpHtml);
  debugWindow("loadFile done");

  // Create a dedicated chat session for this window
  let childSession: ChatSession | null = null;
  try {
    childSession =
      (await createChatSession({
        appPath: app.getAppPath(),
        config: childConfig,
        sessionFile,
        cwd: opts?.cwd || config.workspaceRoot || homedir(),
        host: sessionHost(win),
      })) ?? null;
  } catch (e) {
    log.error("child session failed:", errText(e));
  }

  if (childSession) windowSessions.set(childWinId, childSession);
  debugWindow(`child session ready: ${!!childSession}`);

  win.on("focus", () => {
    clearUnread(win.id);
    windowStatus.update(win.id, { unread: 0 });
    cancelDecisionAlerts(win.id);
    win.flashFrame(false);
  });

  win.on("closed", () => {
    windowSessions.delete(childWinId);
    childWindows.delete(win);
    if (sessionFile) windowsBySession.delete(sessionKey(sessionFile));
    clearUnread(win.id);
    cancelDecisionAlerts(win.id);
    decisions.dropWindow(win.id);
    windowStatus.remove(win.id);
    if (childSession) {
      childSession.dispose();
      childSession = null;
    }
    refreshWindowList();
  });
  return { ok: true, focused: false };
}

/** PI_DEBUG_WINDOW=1 traces the window-creation path (see docs/KNOWN-ISSUES.md). */
function debugWindow(message: string): void {
  if (process.env.PI_DEBUG_WINDOW === "1") console.error(`[window] ${message}`);
}

/**
 * Start a new session for `win` — in that window when it is idle, in a window of its own when its
 * agent is mid-turn.
 *
 * A running turn owns its window: pi keeps one session per process and refuses to swap it under an
 * in-flight turn, so a new session cannot take this window over. Refusing is the wrong answer
 * though — "start something else while this keeps going" is exactly what a person means by New
 * session while the agent is working, and sessions running side by side is what the multi-window
 * model is for.
 *
 * Shared by every entry point that means the same thing to whoever clicked it: the sidebar button,
 * the title-bar "+" and the command palette (all through IPC), the File menu's Ctrl+N, and the
 * tray. The menu and the tray used to route through the renderer, where nothing consumed them.
 */
async function startNewSessionForWindow(
  win: BrowserWindow | null,
): Promise<{ ok: boolean; openedWindow?: boolean; error?: string }> {
  if (!win || win.isDestroyed()) return { ok: false, error: "窗口已关闭" };
  const session = sessionFor(win.webContents);
  if (!session) return { ok: false, error: "会话未就绪" };

  if (!session.streaming) {
    await session.newSession();
    return { ok: true };
  }

  debugWindow("newSession while streaming -> openSessionWindow");
  const opened = await openSessionWindow();
  debugWindow(`openSessionWindow -> ${JSON.stringify(opened)}`);
  postToWindow(win, {
    type: "toast",
    text: opened.ok ? "已在新窗口打开新会话，当前会话继续运行" : opened.error,
    kind: opened.ok ? "success" : "error",
  });
  if (!opened.ok) log.warn("newSession while running: could not open a window:", opened.error);
  return { ok: opened.ok, openedWindow: opened.ok, error: opened.error };
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
      const m = msg as { type?: string; event?: { type?: string }; request?: unknown };
      if (m?.type === "event" && m.event?.type === "agent_settled" && !win.isDestroyed()) {
        const focused = win.isFocused();
        // Two separate decisions that happen to share a moment: the chime has its
        // own rules (alerts.ts) and the toast is about the window being in the
        // background — which is also what the unread counter tracks. `toastSilent`
        // is what keeps the two from making a sound each.
        const sound = fireAlert("turnEnd", config.alerts, focused);
        if (!focused) {
          showNotification("Pi Heao GUI", "Agent 已完成回复", { silent: sound.toastSilent });
          bumpUnread(win.id);
          windowStatus.update(win.id, { unread: unreadFor(win.id) });
          win.flashFrame(true);
        }
      }
      // Permission, elevation or a confirmation: someone has to answer, so this is
      // the one alert that is allowed to interrupt — and it goes on the list every
      // window can see, because the window that is waiting is not always the window
      // the person is looking at.
      if (m?.type === "dialog" && m.request && !win.isDestroyed()) {
        const described = describeRequest(m.request);
        decisions.add({
          id: String((m.request as { id?: unknown }).id ?? ""),
          windowId: win.id,
          method: described.method,
          title: described.title,
          message: described.message,
          windowLabel: decisionWindowLabel(win),
          askedAt: Date.now(),
        });
        scheduleDecisionAlerts(win);
      }
      // The session's pi is gone: whatever it was waiting for can no longer be answered, so it must
      // not keep sitting on the list. A reload or a fresh message starts a new pi, and a new pi asks
      // its own questions.
      if (m?.type === "error" && !win.isDestroyed()) decisions.dropWindow(win.id);
      // The board's two moving parts: whether a turn is streaming here, and what the window is
      // about. Both are posted by the session anyway, so this is bookkeeping, not a new signal.
      if (m?.type === "streaming" && !win.isDestroyed()) {
        windowStatus.update(win.id, {
          running: Boolean((m as { running?: unknown }).running),
          touchedAt: Date.now(),
        });
      }
      if (m?.type === "sessionInfo" && !win.isDestroyed()) {
        const label = String((m as { label?: unknown }).label ?? "").trim();
        if (label) windowStatus.update(win.id, { label, touchedAt: Date.now() });
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

ipcMain.handle("pi:open-session-window", async (_e, arg: unknown) => {
  // Two shapes: a plain path (the context menu) or an object carrying where the
  // drag was released. Keeping the string form means the existing caller and the
  // preload tests do not have to change.
  const payload =
    typeof arg === "string"
      ? { file: arg }
      : ((arg ?? {}) as { file?: string; screenX?: number; screenY?: number });
  const f = String(payload.file || "");
  if (!isSessionFile(f)) return { ok: false, error: "会话文件无效" };
  if (!existsSync(f)) return { ok: false, error: "会话文件不存在" };
  return openSessionWindow(f, { screenX: payload.screenX, screenY: payload.screenY });
});

/**
 * Play a chime on demand. Settings-window only: it skips the rule table because
 * the person just asked for it, but it still reports whether a sound came out.
 */
ipcMain.handle(IPC.ALERT_TEST, async (_e, kind: unknown) => {
  const k = kind === "decision" ? "decision" : "turnEnd";
  const played = await playChime(k, config.alerts.volume);
  return { ok: played, error: played ? "" : "音频不可用（提示音未能播放）" };
});

// ─── IPC: the pending-decision list ───────────────────────────────────

/** Every window's unanswered decisions — the panel is the same list everywhere. */
ipcMain.handle(IPC.GET_DECISIONS, () => decisions.list());

/**
 * Bring the window that is waiting to the front.
 *
 * Answering still happens there: pi's request, its options and its textarea live in that window's
 * session, so this is a "take me to it" and not an "answer it for me".
 */
/** Bring one window to the front. Shared by the decision list and the window board. */
function focusWindowById(windowId: number): { ok: boolean; error?: string } {
  const win = BrowserWindow.getAllWindows().find((w) => w.id === windowId);
  if (!win || win.isDestroyed()) {
    // The window is gone, so whatever listed it is stale: say so, and take its rows off both lists.
    decisions.dropWindow(windowId);
    windowStatus.remove(windowId);
    return { ok: false, error: "那个窗口已经关掉了" };
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return { ok: true };
}

ipcMain.handle(IPC.DECISIONS_FOCUS, (_e, arg: unknown) =>
  focusWindowById(Number((arg as { windowId?: unknown } | null)?.windowId ?? arg)),
);

ipcMain.handle(IPC.FOCUS_WINDOW, (_e, arg: unknown) =>
  focusWindowById(Number((arg as { windowId?: unknown } | null)?.windowId ?? arg)),
);

/** What every window is doing — the board reads the same list in every window. */
ipcMain.handle(IPC.GET_WINDOWS, () => windowStatus.list());

// ─── IPC: Config ──────────────────────────────────────────────────────

ipcMain.handle(IPC.GET_CONFIG, () => config);

ipcMain.handle(IPC.SET_CONFIG, (_e, partial: Partial<StandaloneConfig>) => {
  saveConfig({ ...config, ...partial });
  applyConfigSideEffects();
  // chatFontSize belongs here too: it is what --pi-fs-md is built from, so a size change
  // that does not broadcast leaves the slider writing a value nothing ever reads.
  if (
    partial.theme !== undefined ||
    partial.accent !== undefined ||
    partial.chatFontSize !== undefined
  )
    broadcastTheme();
  // Appearance changes are applied to the settings window IN PLACE.
  //
  // This used to close and reopen the window, which looks equivalent and is not: the click
  // that caused the change is still being handled in the window being torn down, and the
  // window object the renderer still holds is destroyed. The next interaction then lands on
  // a destroyed window — reported as "the second accent click does nothing until I leave the
  // page and come back". The e2e pass caught the same defect as "Object has been destroyed".
  if (
    (partial.theme !== undefined ||
      partial.accent !== undefined ||
      partial.chatFontSize !== undefined) &&
    settingsWindow &&
    !settingsWindow.isDestroyed()
  ) {
    const css = buildTokensCss(config.theme, config.accent, config.chatFontSize);
    const accent = String(config.accent || "").toLowerCase();
    const script =
      "(function(){" +
      "var el=document.getElementById('pi-heao-tokens');" +
      "if(!el){el=document.createElement('style');el.id='pi-heao-tokens';document.head.appendChild(el);}" +
      "el.textContent=" +
      JSON.stringify(css) +
      ";" +
      "document.querySelectorAll('#theme-group [data-theme]').forEach(function(b){" +
      "b.classList.toggle('active',b.getAttribute('data-theme')===" +
      JSON.stringify(config.theme) +
      ");});" +
      "document.querySelectorAll('#accent-swatches .swatch').forEach(function(b){" +
      "b.classList.toggle('active',String(b.getAttribute('data-accent')||'').toLowerCase()===" +
      JSON.stringify(accent) +
      ");});" +
      "var fi=document.getElementById('cfg-chatFontSize');if(fi)fi.value=" +
      JSON.stringify(String(config.chatFontSize)) +
      ";" +
      "})()";
    void settingsWindow.webContents.executeJavaScript(script).catch(() => {
      /* window may be closing; the next open renders from config */
    });
  }
  if (partial.uiLanguage !== undefined && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
    settingsWindow = null;
    openSettingsWindow();
  }
  return config;
});

/** Windows title-bar overlay colours for the current theme (it is drawn by the OS). */
function overlayColors(theme: "dark" | "light" | "system"): {
  color: string;
  symbolColor: string;
  height: number;
} {
  const light = theme === "light";
  return {
    color: light ? "#f6f7f9" : "#181818",
    symbolColor: light ? "#1c2027" : "#cccccc",
    height: 32,
  };
}

/** Push the current token CSS to every chat window (live theme switching). */
function broadcastTheme(): void {
  const css = buildTokensCss(config.theme, config.accent, config.chatFontSize);
  const payload = { type: "theme", css, theme: config.theme, accent: config.accent };
  // The chat UI lives in a <webview>, which is not a BrowserWindow and therefore
  // never appeared in getAllWindows(). Its stylesheet tokens were never delivered,
  // so every appearance setting silently did nothing in the chat pane and the chat
  // fell back to the browser default CJK face. getAllWebContents() includes webview
  // guests; "window" keeps the app chrome covered by the same loop.
  // The overlay is an OS-drawn strip; it does not read our CSS, so it has to be pushed.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && typeof win.setTitleBarOverlay === "function") {
      try {
        win.setTitleBarOverlay(overlayColors(config.theme));
      } catch {
        /* older shell */
      }
    }
  }

  for (const wc of webContents.getAllWebContents()) {
    const kind = wc.getType();
    if (!wc.isDestroyed() && (kind === "window" || kind === "webview")) {
      wc.send("pi:theme", payload);
    }
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
  await switchWorkspace(e.sender, String(dir || ""), { awaitSession: true });
  return config;
});

/**
 * Point a window at another directory. The one path every caller shares.
 *
 * Three things have to happen in this order, and they are the reason this is a function rather than
 * four copies: the choice is remembered (so new windows open where the person last worked), the
 * project's recency is bumped, and the window's session is rebound in the new directory. Only the
 * last one is slow — it starts a pi — which is why callers that are answering a UI gesture pass
 * `awaitSession: false` and let the rebind happen behind the reply (see pi:worktree-use).
 */
async function switchWorkspace(
  sender: WebContents,
  dir: string,
  opts: { awaitSession?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const target = String(dir || "").trim();
  if (!target || !existsSync(target)) return { ok: false, error: "找不到那个目录" };
  const recent = [target, ...(config.recentWorkspaces || []).filter((p) => p !== target)].slice(
    0,
    8,
  );
  saveConfig({ ...config, workspaceRoot: target, recentWorkspaces: recent });
  projects.touch(target);
  // Per-window workspace: the pi child is spawned with cwd, so the window bound
  // to this renderer has to be re-created with the new working directory.
  const win = BrowserWindow.fromWebContents(sender);
  const session = sessionFor(sender);
  // A switch that changes the workspace but not the session looks identical to a working one from the
  // outside — the config is saved either way — so say which of the two happened.
  log.info(
    `workspace switch to ${target}: window=${win?.id ?? "none"} (main ${mainWindowId ?? "none"}), session=${session ? "yes" : "no"}`,
  );
  if (win && session && win.id === mainWindowId) {
    if (opts.awaitSession) await rebindMainSession(target);
    else void rebindMainSession(target);
  } else if (win) {
    postToWindow(win, { type: "toast", text: `工作目录已切换：${target}`, kind: "success" });
  }
  return { ok: true };
}

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
  return { ok: true, theme: next, css: buildTokensCss(next, config.accent, config.chatFontSize) };
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
    // A pi terminal installs the same agent packages a chat session does, into the same prefix, so
    // it must not race one. It cannot take a turn in the spawn queue either: the TUI is interactive
    // from its first paint and prints nothing that means "past start-up" — on a fresh profile it
    // asks about project trust before it installs anything — so there is no moment to report ready
    // at. Waiting for the queue to clear costs a second when a session is starting, nothing
    // otherwise. A shell terminal starts pi's agent dir not at all, so it does not wait.
    const termKind: TerminalKind = msg?.kind === "shell" ? "shell" : "pi";
    if (termKind === "pi") {
      const queue = getSpawnQueue();
      const key = profileKey({ ...process.env, ...buildEnv(config, app.getAppPath()) });
      // Say so when there is something to wait for. A terminal that silently does not appear for a
      // minute reads as broken; the same minute with a sentence on screen reads as waiting.
      const held = queue.stats().some((entry) => entry.key === key && entry.holding);
      if (held) {
        const note = BrowserWindow.fromWebContents(sender);
        if (note && !note.isDestroyed()) {
          postToWindow(note, {
            type: "toast",
            text: "终端要等另一个 pi 启动完成（同一个 agent 包目录，不能同时装）",
            kind: "info",
          });
        }
      }
      await queue.whenIdle(key);
    }
    // The waits above can last everything from 250 ms to the queue's five-minute ceiling, and a
    // window that was closed while it waited must not get a PTY: the handle would sit in
    // `terminals` under a dead id with a live pi TUI (or shell) behind it, invisible and with no
    // way to close it before the app quits. `onData` already guards the send; this guards the
    // process.
    if (sender.isDestroyed()) {
      log.info("term-open: window closed while waiting — no terminal started");
      return { ok: false, error: "窗口已关闭，终端未启动" };
    }
    // The terminal follows the window's pi session so `pi` resumes the same chat.
    const session = sessionFor(sender);
    // A session file from the renderer is a path, and it goes straight into pi's argv — so it is
    // checked to be a real session file under the agent's session directory, the way
    // `pi:switch-session` already checks the same value. An invalid one is refused rather than
    // silently swapped for the window's own: a caller that asks for a path outside the session
    // store has a bug worth seeing (this used to be a way to hand pi any path on the machine).
    const asked = String(msg?.sessionFile ?? "").trim();
    if (asked && !isSessionFile(asked)) {
      log.warn("term-open: refused a session file outside the session store:", asked);
      return { ok: false, error: "不是 pi 的会话文件，已拒绝" };
    }
    const own = session?.sessionFile ?? "";
    const kind: TerminalKind = termKind;
    const result = createTerminal({
      kind,
      cwd: config.workspaceRoot || homedir(),
      piPath: findPiBinary(config.piPath || undefined),
      extensionArgs: buildExtensionArgs(app.getAppPath(), config),
      sessionFile: asked || (isSessionFile(own) ? own : undefined),
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
    // Between creating the PTY and recording it the window can still disappear; a handle nobody
    // can reach is a process nobody can close.
    if (sender.isDestroyed()) {
      handle.kill();
      return { ok: false, error: "窗口已关闭，终端未保留" };
    }
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

/**
 * Places the file panel refuses, wherever the workspace points.
 *
 * The panel's root defaults to the home directory, so "inside the workspace" used to mean
 * "anywhere in the profile": the chat window — the one window that renders model output and
 * is explicitly *not* allowed to touch agent config — could read `~/.pi/agent/auth.json` and
 * overwrite `~/.pi/standalone/config.json` through `pi:fs-read` / `pi:fs-write`, which is the
 * opposite of what SECURITY.md promises. Two things are being protected here:
 *
 *   - credentials and agent state: pi's own directory (sessions, snapshots, settings.json,
 *     auth.json, the app config, and the extension packages pi installs), the usual key and
 *     config directories, and `~/.gitconfig` (a git `core.sshCommand` is a command runner);
 *   - `%APPDATA%`: `userData/bridge-extracted/*.ts` is executed by every pi this app spawns
 *     (`-e <path>`), and the Startup folder lives in there too — a writable path whose content
 *     runs later is worth more to an attacker than anything it could read.
 *
 * A project's own `.pi/` (settings, mcp.json) is deliberately *not* on this list: that one is
 * the user's repository, not agent state.
 */
function protectedPaths(): string[] {
  const home = homedir();
  const roots = [
    join(home, ".pi"),
    join(home, ".ssh"),
    join(home, ".aws"),
    join(home, ".gnupg"),
    join(home, ".docker"),
    join(home, ".config"),
    join(home, ".npmrc"),
    join(home, ".git-credentials"),
    join(home, ".gitconfig"),
    app.getPath("appData"),
    app.getPath("userData"),
  ];
  return roots.filter(Boolean);
}

let protectedRoots: string[] | null = null;

/** The protected root `full` falls under, or null when it is allowed. */
function protectedHit(full: string): string | null {
  if (!protectedRoots) protectedRoots = protectedPaths();
  for (const root of protectedRoots) {
    if (isWithin(root, full)) return root;
  }
  return null;
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
  const blocked = protectedHit(dir);
  if (blocked) return { ok: false, error: `该位置受保护，不能在文件面板里浏览：${blocked}` };
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
  const blocked = protectedHit(full);
  if (blocked) return { ok: false, error: `该位置受保护，不能在文件面板里读取：${blocked}` };
  try {
    const st = await stat(full);
    if (st.size > 4 * 1024 * 1024) return { ok: false, error: "文件过大（上限 4 MB）" };
    const content = await readFile(full, "utf8");
    return { ok: true, content, path: String(relPath), size: st.size };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

/**
 * Media variant of `pi:fs-read`: a PNG or a WAV cannot go into a text editor, so this returns a
 * data URL the panel can hand to <img> / <audio> instead. Same workspace guard, same read-only
 * stance; the cap is higher because a picture is legitimately bigger than a source file, and the
 * page's CSP already allows data: for img-src and media-src, so nothing has to be loosened.
 */
const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

ipcMain.handle("pi:fs-media", async (_e, relPath: string) => {
  const full = safeWorkspacePath(workspaceRootDir(), relPath);
  if (!full) return { ok: false, error: "路径无效" };
  const blocked = protectedHit(full);
  if (blocked) return { ok: false, error: `该位置受保护，不能在文件面板里读取：${blocked}` };
  const kind = previewKindFor(relPath);
  const mime = mediaMimeFor(relPath);
  if (kind === "text" || !mime) return { ok: false, error: "不是图片或音频" };
  try {
    const st = await stat(full);
    if (!st.isFile()) return { ok: false, error: "不是文件" };
    if (st.size > MEDIA_MAX_BYTES)
      return { ok: false, error: `文件过大（上限 ${MEDIA_MAX_BYTES / 1024 / 1024} MB）` };
    const buf = await readFile(full);
    return {
      ok: true,
      kind,
      mime,
      size: st.size,
      path: String(relPath),
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
    };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

ipcMain.handle("pi:fs-write", async (_e, msg: { path?: string; content?: string }) => {
  const full = safeWorkspacePath(workspaceRootDir(), String(msg?.path || ""));
  if (!full) return { ok: false, error: "路径无效" };
  const blocked = protectedHit(full);
  if (blocked) return { ok: false, error: `该位置受保护，不能在文件面板里写入：${blocked}` };
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

ipcMain.handle(
  "pi:worktree-list",
  async (): Promise<{ ok: boolean; worktrees: unknown[]; current: string }> => {
    const cwd = workspaceRootDir();
    const worktrees = (await listWorktrees(cwd)).map((wt) => ({
      ...wt,
      // The dock labels the entry the way a person names a working copy: the branch if it is on
      // one, the directory name otherwise.
      label: wt.branch || (wt.detached ? "detached HEAD" : basename(wt.path) || wt.path),
    }));
    return { ok: true, worktrees, current: cwd };
  },
);

/**
 * Switch the workspace to another worktree of the same repository. A worktree is just a directory,
 * so nothing new has to be invented: everything that follows the workspace — the git pane, the
 * file list, the terminal, the next session — follows it, and the chat session is rebound exactly
 * the way the workspace picker rebinds it.
 */
ipcMain.handle(
  "pi:worktree-use",
  async (e, dir: unknown): Promise<{ ok: boolean; error?: string }> => {
    const target = String(dir || "").trim();
    if (!target || !existsSync(target)) return { ok: false, error: "找不到该 worktree 目录" };
    // The switch itself is done behind this reply — see switchWorkspace. The chat session is rebound
    // after it: rebinding starts a pi, and starting a pi can wait for another one to finish
    // installing the same agent packages (see spawn-queue.ts), and a pane that asked to switch
    // directories must not sit on that.
    return switchWorkspace(e.sender, target);
  },
);

// ─── IPC: Projects ────────────────────────────────────────────────────

ipcMain.handle(IPC.GET_PROJECTS, () => ({
  // `exists` rides along because the sidebar draws the row: a project whose directory is gone (an
  // unplugged drive) stays in the list and is shown greyed rather than silently disappearing.
  items: projects.list().map((p) => ({ ...p, exists: existsSync(p.path) })),
  current: config.workspaceRoot || "",
  recent: config.recentWorkspaces || [],
  groupBy: config.sidebarGroupBy || "time",
}));

/**
 * Save a directory as a project. Defaults to the window's current workspace, which is what the
 * "keep this one" button means; the native picker is for a directory nobody is in yet.
 */
ipcMain.handle(IPC.ADD_PROJECT, async (e, arg: unknown) => {
  const req = (arg || {}) as { path?: unknown; name?: unknown; pick?: unknown };
  let target = String(req.path || "").trim() || config.workspaceRoot || "";
  if (req.pick) {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const picked = await dialog.showOpenDialog(win as BrowserWindow, {
      properties: ["openDirectory"],
      defaultPath: target || homedir(),
      buttonLabel: "加为项目",
      title: "选择项目目录",
    });
    if (picked.canceled || !picked.filePaths.length) return { ok: false, canceled: true };
    target = picked.filePaths[0];
  }
  if (!target || !existsSync(target)) return { ok: false, error: "找不到那个目录" };
  const { project, added } = projects.add(target, typeof req.name === "string" ? req.name : "");
  return { ok: true, added, project };
});

ipcMain.handle(IPC.REMOVE_PROJECT, (_e, arg: unknown) => {
  const path = String((arg as { path?: unknown } | null)?.path ?? arg ?? "");
  return { ok: projects.remove(path) };
});

ipcMain.handle(IPC.RENAME_PROJECT, (_e, arg: unknown) => {
  const req = (arg || {}) as { path?: unknown; name?: unknown };
  const project = projects.rename(String(req.path || ""), String(req.name || ""));
  return project ? { ok: true, project } : { ok: false, error: "没有这个项目" };
});

/** Switch a window to a saved project — the same switch as the picker, one click shorter. */
ipcMain.handle(IPC.USE_PROJECT, async (e, arg: unknown) => {
  const path = String((arg as { path?: unknown } | null)?.path ?? arg ?? "");
  return switchWorkspace(e.sender, path);
});

ipcMain.handle(IPC.SET_SIDEBAR_GROUP_BY, (_e, value: unknown) => {
  const groupBy = value === "project" ? "project" : "time";
  if (groupBy !== config.sidebarGroupBy) saveConfig({ ...config, sidebarGroupBy: groupBy });
  return { ok: true, groupBy };
});

/**
 * Make a new working copy of this repository and start a session in it, in its own window.
 *
 * Switching a window to a worktree is `pi:worktree-use`; the reason to want a second working copy is
 * usually that the current window is busy, so the new one gets its own window, its own pi and its own
 * directory — and the window that asked keeps running. That is the whole of "dispatch": no new
 * concept, just the two pieces the app already had (a worktree, and a window with a session in it)
 * wired together in one click.
 */
ipcMain.handle(
  "pi:worktree-create",
  async (
    _e,
    arg: unknown,
  ): Promise<{ ok: boolean; error?: string; path?: string; branch?: string }> => {
    const branch = String((arg as { branch?: unknown } | null)?.branch ?? "").trim();
    if (!isSafeBranchName(branch)) {
      return {
        ok: false,
        error: "分支名不合法：不能有空格或 ~ ^ : ? * [ \\ 与 .. @{，也不能以 - 或 . 开头",
      };
    }
    const cwd = workspaceRootDir();
    const root = await git(["rev-parse", "--show-toplevel"], cwd);
    if (!root.ok) return { ok: false, error: "当前工作目录不是 git 仓库" };
    const repo = root.stdout.trim();
    const path = worktreePathFor(repo, branch);
    if (existsSync(path)) return { ok: false, error: `目标目录已存在：${path}` };
    const added = await git(["worktree", "add", "-b", branch, path, "HEAD"], repo);
    if (!added.ok) {
      const why = (added.stderr || added.stdout || "").trim().split("\n").slice(0, 3).join(" ");
      return { ok: false, error: why || "git worktree add 失败" };
    }
    // The working copy exists from here on. If the window cannot be opened (the window cap, say),
    // say that too — the branch is real, and the dropdown will list it.
    const opened = await openSessionWindow(undefined, undefined, { cwd: path, label: branch });
    if (!opened.ok) {
      return { ok: false, error: opened.error || "工作副本已创建，但新窗口没打开", path, branch };
    }
    log.info(`worktree created for ${branch} at ${path}, session window ${opened.windowId}`);
    return { ok: true, path, branch };
  },
);

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
    `pending decisions ${decisions.stats().pending} in ${decisions.stats().windows} window(s)`,
    `windows ${windowStatus.list().length} (${windowStatus.list().filter((w) => w.running).length} running)`,
    `pi start-ups ${JSON.stringify(getSpawnQueue().stats())}`,
    "",
    "config:",
    JSON.stringify(masked, null, 2),
  ].join("\n");
}

async function tailLog(lines = 200, redact = true): Promise<string> {
  try {
    const raw = await readFile(getRpcLogPath(), "utf8");
    const tail = raw.split("\n").slice(-lines).join("\n");
    return redact ? redactSecrets(tail) : tail;
  } catch (e) {
    return `（无法读取日志：${errText(e)}）`;
  }
}

ipcMain.handle("pi:diagnostics", async (_e, op: string) => {
  const action = String(op || "info");
  // Everything this returns is meant to be pasted into a public issue (SECURITY.md says so), and
  // the log carries pi's stderr and the exact command line each child was started with. The
  // config's own secrets are masked above; `redactSecrets` covers the free text.
  if (action === "info") return { ok: true, info: redactSecrets(diagnosticsInfo()) };
  if (action === "log") return { ok: true, info: await tailLog() };
  if (action === "copy") return { ok: true, info: redactSecrets(diagnosticsInfo()) };
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
    const body = `${redactSecrets(diagnosticsInfo())}\n\n===== rpc log (tail 400) =====\n${await tailLog(400)}\n`;
    await writeFile(file, body, "utf8");
    void shell.openPath(dir);
    return { ok: true, path: file };
  }
  return { ok: false, error: "未知操作" };
});

/**
 * Import a session file from elsewhere (another machine, another profile).
 *
 * Export already existed; this is the other half — the app that can write a conversation out should
 * be able to read one back in. With no `path` it asks for the file (that is the human path); the
 * path form exists so the e2e can drive the same code without a native dialog, and it is checked
 * exactly the same way.
 */
ipcMain.handle(IPC.IMPORT_SESSION, async (e, arg: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? mainWindow;
  let from = String((arg as { path?: unknown } | null)?.path ?? "").trim();
  if (!from) {
    const picked = win
      ? await dialog.showOpenDialog(win, {
          title: "导入会话",
          filters: [{ name: "pi 会话文件", extensions: ["jsonl"] }],
          properties: ["openFile"],
        })
      : await dialog.showOpenDialog({
          title: "导入会话",
          filters: [{ name: "pi 会话文件", extensions: ["jsonl"] }],
          properties: ["openFile"],
        });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true, error: "没有选择文件" };
    }
    from = picked.filePaths[0];
  }
  return await importSession({
    from,
    sessionsDir: join(PI_AGENT_DIR, "sessions"),
    fallbackCwd: workspaceRootDir(),
  });
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
      const senderWindow = BrowserWindow.fromWebContents(e.sender);
      if (msgType === "dialogResponse") {
        // Answered: stop repeating that window's alert, and take it off the list every window sees.
        if (senderWindow) {
          cancelDecisionAlerts(senderWindow.id);
          decisions.resolve(senderWindow.id, String(msg?.id ?? ""));
        }
      }
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
        // The dialog belonged to the session being left: stop reminding about it.
        if (senderWindow) {
          cancelDecisionAlerts(senderWindow.id);
          decisions.dropWindow(senderWindow.id);
        }
        await session.switchTo(file);
        // A window's title should say which session it is showing.
        if (senderWindow && !senderWindow.isDestroyed()) {
          senderWindow.setTitle(`Pi — ${basename(file, ".jsonl")}`);
          refreshWindowList();
        }
        return { ok: true };
      } else if (msgType === "newSession") {
        return await startNewSessionForWindow(senderWindow);
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

/**
 * Hand a link to the OS browser.
 *
 * `PI_NAV_NO_OPEN=1` records the intent instead of launching anything: the harnesses click a real
 * `https:` link to prove the window did not follow it, and a browser tab opening on whoever ran
 * `npm run verify` would be a side effect of measuring rather than of the app.
 */
function openExternalUrl(url: string): void {
  if (process.env.PI_NAV_NO_OPEN === "1") {
    log.info("navigation guard: PI_NAV_NO_OPEN=1, not launching a browser for", url);
    return;
  }
  void shell
    .openExternal(url)
    .catch((e) => log.warn("navigation guard: openExternal failed:", errText(e)));
}

// Every window, present and future, shows only the pages this app builds. A model-written link
// must not navigate one away: the preload is injected into every navigation, so the foreign page
// would inherit `window.pi` (see src/main/navigation.ts).
app.on("web-contents-created", (_event, contents) => {
  installNavigationGuards(contents, { openExternal: openExternalUrl });
});

function setupChineseMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "新建会话",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            void startNewSessionForWindow(mainWindow);
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
              "Chat UI: based on pi-agent-studio (MIT, JohnnyZ93), maintained in this project.",
            ].join("\n");
            const opts = {
              type: "info" as const,
              title: "关于",
              message: "Pi Heao GUI V1.3.0",
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
  setupChineseMenu();
  await createWindow();
  // Sweeping %TEMP% is a readdir plus a stat per entry, and on Windows that directory
  // can hold thousands of them. None of it is needed for first paint, so it runs after
  // the window is up — and unref'd, because housekeeping must never hold the process.
  setTimeout(() => sweepStaleTempFiles(), 4000).unref?.();
  void restoreWindowState();
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
        void startNewSessionForWindow(win);
      },
      openSettings: () => openSettingsWindow(),
      focusWindow: (id) => {
        const w = BrowserWindow.fromId(id);
        if (!w || w.isDestroyed()) return;
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      },
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      clearUnread(mainWindow.id);
      cancelDecisionAlerts(mainWindow.id);
    }
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
    // Font-size measurement, behind the same switch as the child-window diagnostics. The appearance
    // setting has never actually resized chat text, and two attempts at fixing it were ruled out
    // (setting the variable with !important cannot work — it is a custom-property declaration — and
    // injecting a later <style> did not win either). The question the code cannot answer is which
    // stylesheet the cascade actually resolves, and what the variables end up as, so this asks the
    // document. See docs/KNOWN-ISSUES.md.
    if (process.env.PI_DEBUG_WINDOW === "1") {
      const fontProbe = setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        void mainWindow.webContents
          .executeJavaScript(
            `JSON.stringify({
             rootFsMd: getComputedStyle(document.documentElement).getPropertyValue('--pi-fs-md').trim(),
             rootChatFs: getComputedStyle(document.documentElement).getPropertyValue('--chat-fs').trim(),
             msgFontSize: (() => {
               const el = document.querySelector('.text-block, .messages .msg');
               return el ? getComputedStyle(el).fontSize : null;
             })(),
             // Where the chain actually breaks. The upstream rule is :root, where
             // --chat-fs reads var(--pi-fs-md, 13px). The text measured 11px, and 11px is exactly
             // 13 * 11/13 — the fallback — so --pi-fs-md is missing at that element while it reads
             // fine at :root. Custom properties inherit, so an element in between redeclares it;
             // this names that element instead of guessing at it.
             msgChain: (() => {
               const el = document.querySelector('.text-block, .messages .msg');
               if (!el) return null;
               const names = ['--pi-fs-md', '--chat-fs', '--chat-fs-12', '--chat-fs-11'];
               const chain = [];
               for (let n = el; n; n = n.parentElement) {
                 const cs = getComputedStyle(n);
                 chain.push({
                   at:
                     n.tagName.toLowerCase() +
                     (n.id ? '#' + n.id : '') +
                     (n.className ? '.' + String(n.className).split(' ')[0] : ''),
                   vars: names.map((k) => k + '=' + cs.getPropertyValue(k).trim()).join(' '),
                 });
                 if (chain.length >= 6) break;
               }
               return chain;
             })(),
             styles: Array.from(document.querySelectorAll('style, link[rel=stylesheet]')).map((el, i) => ({
               i,
               id: el.id || '',
               chars: (el.textContent || '').length,
               mentionsChatFs: (el.textContent || '').includes('--chat-fs'),
               mentionsFsMd: (el.textContent || '').includes('--pi-fs-md'),
             })),
           })`,
          )
          .then((r) => console.error(`[main] font probe ${String(r)}`))
          .catch((e) => console.error(`[main] font probe failed: ${String(e)}`));
      }, 7000);
      fontProbe.unref();
      mainWindow.on("closed", () => clearTimeout(fontProbe));
    }
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
  saveWindowState();
  for (const session of windowSessions.values()) session.dispose();
  windowSessions.clear();
});

app.on("will-quit", () => {
  for (const id of [...terminals.keys()]) disposeTerminalFor(id);
  cancelAllDecisionAlerts();
  destroyTray();
  disposeAlerts();
  cleanupTempFiles();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
