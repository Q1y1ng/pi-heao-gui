import { app, BrowserWindow, ipcMain, clipboard, dialog, shell } from "electron";
import { join, resolve, sep, isAbsolute } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { StandaloneConfig, DEFAULT_CONFIG, IPC } from "../shared/types";
import { buildChatHtml } from "./chat-adapter";
import { createChatSession, type ChatSession } from "./chat-session";
import { buildSettingsHtml } from "./settings-window";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let chatSession: ChatSession | null = null;

// ─── Config ───────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".pi", "standalone");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function loadConfig(): StandaloneConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      return { ...DEFAULT_CONFIG, ...raw };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: StandaloneConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

let config = loadConfig();

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

// ─── Settings window ──────────────────────────────────────────────────

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 720,
    height: 640,
    title: "Pi Standalone 设置",
    backgroundColor: "#1e1e1e",
    parent: mainWindow ?? undefined,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const tmp = join(app.getPath("temp"), "pi-standalone-settings.html");
  writeFileSync(tmp, buildSettingsHtml(), "utf8");
  settingsWindow.loadFile(tmp);
  settingsWindow.on("closed", () => { settingsWindow = null; });
}

// ─── Window ───────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "Pi Standalone GUI",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Try to load pi-chat with shim + config injection
  const chatHtml = buildChatHtml(app.getAppPath(), config);
  if (chatHtml) {
    // Write to a temp file and load it (loadURL with data: has CSP issues)
    const tmpHtml = join(app.getPath("temp"), "pi-standalone-chat.html");
    writeFileSync(tmpHtml, chatHtml, "utf8");
    await mainWindow.loadFile(tmpHtml);
  } else {
    // Fallback placeholder — try dist first (packaged), then src (dev)
    const candidates = [
      join(app.getAppPath(), "dist", "renderer", "index.html"),
      join(app.getAppPath(), "src", "renderer", "index.html"),
    ];
    for (const p of candidates) {
      if (existsSync(p)) { await mainWindow.loadFile(p); break; }
    }
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (chatSession) {
      chatSession.dispose();
      chatSession = null;
    }
  });
}

// ─── IPC: Config ──────────────────────────────────────────────────────

ipcMain.handle(IPC.GET_CONFIG, () => config);

ipcMain.handle(IPC.SET_CONFIG, (_e, partial: Partial<StandaloneConfig>) => {
  config = { ...config, ...partial };
  saveConfig(config);
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
    auth: readPiFile("auth.json") || "{}",
  };
});

ipcMain.handle("pi:write-agent-files", (_e, data: { append?: string; override?: string; settings?: string }) => {
  if (data.append !== undefined) writePiFile("APPEND_SYSTEM.md", data.append);
  if (data.override !== undefined) writePiFile("SYSTEM.md", data.override);
  if (data.settings !== undefined) {
    const s = data.settings.trim();
    if (s) {
      try { JSON.parse(s); } catch (e) {
        return { ok: false, error: "settings.json 不是有效 JSON: " + (e instanceof Error ? e.message : String(e)) };
      }
    }
    writePiFile("settings.json", data.settings);
  }
  return { ok: true };
});

ipcMain.handle("pi:get-env-info", () => {
  const { readdirSync, statSync, readFileSync: rf } = require("fs");
  // Local extensions
  let extensions: string[] = [];
  try {
    const extDir = join(PI_AGENT_DIR, "extensions");
    if (existsSync(extDir)) {
      extensions = readdirSync(extDir).filter((f: string) => f.endsWith(".ts") || f.endsWith(".js") || f.includes(".disabled"));
    }
  } catch {}
  // Skills
  let skills: Array<{ name: string; description: string }> = [];
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
  let p = String(filePath ?? "");
  if (!p) return;
  if (!isAbsolute(p) && config.workspaceRoot) p = resolve(config.workspaceRoot, p);
  shell.openPath(p);
});

ipcMain.handle(IPC.PICK_RESOURCE, async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "openDirectory", "multiSelections"],
    defaultPath: config.workspaceRoot || homedir(),
    buttonLabel: "Add",
    title: "Add file or folder to prompt",
  });
  if (result.canceled) return [];
  const base = config.workspaceRoot || homedir();
  return result.filePaths.map((p) => {
    if (p.startsWith(base + sep) || p === base) return p === base ? "." : p.slice(base.length + 1);
    return p;
  });
});

ipcMain.handle(IPC.SEARCH_FILES, async (_e, query: string) => {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q || !config.workspaceRoot) return [];
  const { readdirSync, statSync } = await import("fs");
  const results: string[] = [];
  const maxResults = 80;
  const maxDepth = 6;
  const skipDirs = new Set(["node_modules", ".git", ".vscode", ".idea", "dist", "build", "__pycache__", ".next", ".cache"]);

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || results.length >= maxResults) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.startsWith(".") && entry !== ".env") continue;
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (entry.toLowerCase().includes(q)) {
        results.push(full.startsWith(config.workspaceRoot + sep) ? full.slice(config.workspaceRoot.length + 1) : full);
      }
    }
  }
  walk(config.workspaceRoot, 0);
  return results;
});

// ─── IPC: Sessions list ───────────────────────────────────────────────

ipcMain.handle(IPC.LIST_SESSIONS, async () => {
  const sessionsDir = join(homedir(), ".pi", "agent", "sessions");
  if (!existsSync(sessionsDir)) return [];
  const { readdirSync, readFileSync: rf, statSync } = await import("fs");
  const sessions: Array<{ file: string; name: string; mtime: number; sessionId: string }> = [];

  function scanDir(dir: string): void {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { scanDir(full); continue; }
      if (!entry.endsWith(".jsonl")) continue;
      try {
        const content = rf(full, "utf8");
        const lines = content.split("\n").filter(Boolean);
        let name = "";
        let sessionId = "";
        // 1) Look for session_info (usually last line)
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
          try {
            const obj = JSON.parse(lines[i]);
            if (obj.type === "session_info" && obj.name) {
              name = String(obj.name);
              sessionId = obj.id ? String(obj.id) : sessionId;
              break;
            }
            if (obj.type === "session" && obj.id && !sessionId) sessionId = String(obj.id);
          } catch {}
        }
        // 2) Fallback: first user message as preview
        if (!name) {
          for (let i = 0; i < Math.min(lines.length, 40); i++) {
            try {
              const obj = JSON.parse(lines[i]);
              if (obj.type === "message" && obj.message?.role === "user") {
                const c = obj.message.content;
                let text = "";
                if (typeof c === "string") text = c;
                else if (Array.isArray(c)) {
                  for (const b of c) {
                    if (b && typeof b === "object" && b.type === "text" && typeof b.text === "string") {
                      text = b.text;
                      break;
                    }
                  }
                }
                text = text.replace(/\s+/g, " ").trim();
                if (text) {
                  name = text.length > 36 ? text.slice(0, 36) + "…" : text;
                  break;
                }
              }
            } catch {}
          }
        }
        // 3) Last resort: friendly timestamp
        if (!name) {
          const ts = entry.replace(/\.jsonl$/, "").split("_")[0];
          name = ts.replace(/T/, " ").replace(/-\d+Z$/, "").slice(0, 16) || "未命名会话";
        }
        sessions.push({ file: full, name, mtime: st.mtimeMs, sessionId });
      } catch {}
    }
  }
  scanDir(sessionsDir);
  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions;
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
  ipcMain.handle(channel, async (_e, msg: Record<string, unknown>) => {
    if (!chatSession) return;
    if (msgType === "switchSession" && msg?.sessionFile) {
      await chatSession.switchTo(String(msg.sessionFile));
    } else if (msgType === "newSession") {
      await chatSession.newSession();
    } else {
      await chatSession.handleMessage({ ...msg, type: msgType });
    }
  });
}

// rewindDiff: open file in system (no VS Code diff available)
ipcMain.handle(IPC.REWIND_DIFF, async (_e, msg: { absPath?: string }) => {
  if (msg?.absPath) shell.openPath(String(msg.absPath));
});

// ─── Boot ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await createWindow();

  // Create chat session after window is ready
  if (mainWindow) {
    try {
      chatSession = (await createChatSession({
        appPath: app.getAppPath(),
        config,
        host: {
          postToRenderer: (msg) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              // Determine which IPC channel to use based on msg.type
              const typeToChannel: Record<string, string> = {
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
              };
              const channel = typeToChannel[(msg as any).type];
              if (channel) {
                mainWindow.webContents.send(channel, msg);
              } else {
                console.warn("[main] unknown msg type for renderer:", (msg as any).type);
              }
            }
          },
        },
      })) ?? null;
      console.log("[main] chat session created");
    } catch (e) {
      console.error("[main] failed to create chat session:", e);
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
