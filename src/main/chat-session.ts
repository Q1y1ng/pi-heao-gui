/**
 * Chat session controller for Electron.
 * Ported from upstream src/chat/chat-session.ts — VS Code deps replaced with Electron equivalents.
 */
import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve, isAbsolute, relative, sep } from "path";
import { createRpcClient, type RpcClient, type RpcEvent, type ExtensionUiRequest, type RpcImage, type RpcState, type RpcModel } from "./rpc-client";
import type { StandaloneConfig } from "../shared/types";
import { getRealBridgeDir } from "./bridge-extract";

// ─── Builtin commands (from upstream builtin-commands.ts) ─────────────

const BUILTIN_CMDS: Array<{ name: string; description: string; source: "builtin" }> = [
  { name: "compact", description: "Compact the conversation", source: "builtin" },
  { name: "autocompact", description: "Toggle auto-compaction", source: "builtin" },
  { name: "session", description: "Show session stats", source: "builtin" },
  { name: "name", description: "Rename session", source: "builtin" },
  { name: "clear", description: "Start new session", source: "builtin" },
  { name: "new", description: "Start new session", source: "builtin" },
  { name: "reload", description: "Reload session", source: "builtin" },
];

function mergeBuiltinCommands(cmds: Array<{ name: string; description?: string; source: string }>) {
  const map = new Map<string, unknown>();
  for (const c of cmds) map.set(c.name, c);
  for (const b of BUILTIN_CMDS) if (!map.has(b.name)) map.set(b.name, b);
  return [...map.values()];
}

function parseBuiltin(message: string): { name: string; args: string } | null {
  if (!message.startsWith("/")) return null;
  const spaceIdx = message.indexOf(" ");
  const name = spaceIdx === -1 ? message.slice(1) : message.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? "" : message.slice(spaceIdx + 1).trim();
  const known = BUILTIN_CMDS.find(c => c.name === name);
  return known ? { name, args } : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let t = "";
  for (const block of content) {
    if (typeof block === "string") t += block;
    else if (block && typeof block === "object" && (block as any).type === "text" && typeof (block as any).text === "string")
      t += (t ? "\n" : "") + (block as any).text;
  }
  return t;
}

function shortenHome(p: string): string {
  const home = homedir();
  if (home && (p === home || p.startsWith(home + sep))) return "~" + p.slice(home.length);
  return p;
}

// ─── Find pi binary ───────────────────────────────────────────────────

function findPiBinary(customPath?: string): string {
  if (customPath && existsSync(customPath)) return customPath;
  // Try common locations
  const npmGlobal = join(process.env.APPDATA || "", "npm", "pi.cmd");
  if (process.platform === "win32" && existsSync(npmGlobal)) return npmGlobal;
  // Fallback to PATH
  return "pi";
}

function buildExtensionArgs(appPath: string, config: StandaloneConfig): string[] {
  const bridgeDir = getRealBridgeDir(appPath);
  const extensions = [
    "todo.ts",
    "questionnaire.ts",
    "btw.ts",
    "permission-gate.ts",
    "rewind-code.ts",
  ];
  const args: string[] = [];
  for (const ext of extensions) {
    const p = join(bridgeDir, ext);
    if (existsSync(p)) {
      args.push("-e", p);
    }
  }
  // subagent directory
  const subagentDir = join(bridgeDir, "subagent");
  if (existsSync(join(subagentDir, "index.ts"))) {
    args.push("-e", join(subagentDir, "index.ts"));
  }
  // mcp
  if (config.mcpEnabled) {
    const mcpPath = join(bridgeDir, "mcp", "index.js");
    if (existsSync(mcpPath)) {
      args.push("-e", mcpPath);
    }
  }
  return args;
}

function buildEnv(config: StandaloneConfig, appPath: string): Record<string, string> {
  const bridgeDir = getRealBridgeDir(appPath);
  const env: Record<string, string> = {
    PI_VSCODE_STATUS_BAR: "0",
    PI_VSCODE_DISABLED_TOOLS: JSON.stringify(config.disabledTools || []),
    PI_VSCODE_PERMISSION: JSON.stringify({ mode: config.permissionMode, patterns: config.dangerousPatterns || [] }),
    PI_VSCODE_MCP_IDLE_TIMEOUT: String(config.mcpIdleTimeout ?? 10),
    PI_VSCODE_BUILTIN_AGENTS_DIR: join(bridgeDir, "agents"),
    // No bridge — extensions that need it will no-op
  };
  return { ...config.env, ...env };
}

// ─── Session ──────────────────────────────────────────────────────────

export interface ChatSessionHost {
  postToRenderer(msg: unknown): void;
}

export interface ChatSession {
  rpc: RpcClient;
  sessionFile?: string;
  streaming: boolean;
  handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void>;
  switchTo(sessionFile: string): Promise<void>;
  newSession(): Promise<void>;
  dispose(): void;
}

export async function createChatSession(opts: {
  appPath: string;
  config: StandaloneConfig;
  host: ChatSessionHost;
  sessionFile?: string;
  cwd?: string;
}): Promise<ChatSession | undefined> {
  const piPath = findPiBinary(opts.config.piPath || undefined);
  const cwd = opts.cwd || opts.config.workspaceRoot || process.cwd();
  const extArgs = buildExtensionArgs(opts.appPath, opts.config);
  const env = buildEnv(opts.config, opts.appPath);

  let sessionFile = opts.sessionFile;
  let sessionName: string | undefined;
  let streaming = false;
  let sessionDisposed = false;
  let rpcAlive = false;
  let rpc: RpcClient;

  const post = (msg: unknown) => { if (!sessionDisposed) opts.host.postToRenderer(msg); };

  function updateStreaming(running: boolean) {
    streaming = running;
    post({ type: "streaming", running });
  }

  async function sendContextUsage() {
    if (sessionDisposed) return;
    try {
      const stats = await rpc.getSessionStatsFull();
      if (!sessionDisposed) post({ type: "contextUsage", usage: stats.contextUsage ?? null, cost: stats.cost });
    } catch {}
  }

  async function sendSessionInfo() {
    if (sessionDisposed) return;
    let label = "";
    if (cwd) {
      label = shortenHome(cwd);
      if (sessionName) label += ` • ${sessionName}`;
    } else if (sessionName) {
      label = sessionName;
    }
    post({ type: "sessionInfo", label, sessionFile: sessionFile ?? null });
  }

  async function hydrate() {
    try {
      const [st, models, levels, cmds] = await Promise.all([
        rpc.getState(),
        rpc.getAvailableModels(),
        rpc.getAvailableThinkingLevels(),
        rpc.getCommands(),
      ]);
      sessionName = st.sessionName;
      sessionFile = st.sessionFile;
      post({ type: "state", state: st });
      post({ type: "permissionMode", mode: opts.config.permissionMode });
      post({ type: "models", models });
      post({ type: "thinkingLevels", levels });
      post({ type: "commands", commands: mergeBuiltinCommands(cmds) });
      await sendSessionInfo();
      const messages = await rpc.getMessages();
      post({ type: "messages", messages });
      if (st.isStreaming) {
        streaming = true;
        post({ type: "event", event: { type: "agent_start" } });
      }
      void sendContextUsage();
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  function handleExtUiRequest(req: ExtensionUiRequest) {
    if (req.method === "select" || req.method === "confirm" || req.method === "input" || req.method === "editor") {
      post({ type: "dialog", request: req });
    } else if (req.method === "setWidget") {
      post({ type: "widget", widgetKey: req.widgetKey, widgetLines: req.widgetLines });
    } else if (req.method === "notify") {
      const message = String(req.message ?? "");
      if (message.startsWith("__mcp_status__")) {
        try {
          const servers = JSON.parse(message.slice("__mcp_status__".length));
          post({ type: "mcpStatus", servers });
        } catch {}
        return;
      }
      const t = req.notifyType as string | undefined;
      const kind = t === "error" ? "error" : t === "success" ? "success" : "info";
      post({ type: "toast", text: message, kind });
    }
  }

  async function handleBuiltin(message: string): Promise<boolean> {
    const parsed = parseBuiltin(message);
    if (!parsed) return false;
    const { name, args } = parsed;
    try {
      switch (name) {
        case "compact":
          await rpc.compact(args || undefined).catch(() => {});
          break;
        case "autocompact": {
          const a = (args || "toggle").toLowerCase();
          let enabled: boolean;
          if (a === "on") enabled = true;
          else if (a === "off") enabled = false;
          else { const st = await rpc.getState(); enabled = !st.autoCompactionEnabled; }
          await rpc.setAutoCompaction(enabled);
          post({ type: "toast", text: enabled ? "Auto-compaction enabled." : "Auto-compaction disabled." });
          break;
        }
        case "session": {
          const stats = await rpc.getSessionStatsFull();
          const lines = ["| Field | Value |", "|---|---|"];
          if (stats.sessionId) lines.push(`| Session ID | \`${stats.sessionId}\` |`);
          if (stats.sessionFile) lines.push(`| Session file | \`${stats.sessionFile}\` |`);
          lines.push(`| Messages | ${stats.totalMessages ?? 0} |`);
          if (stats.cost != null) lines.push(`| Cost | $${stats.cost.toFixed(4)} |`);
          post({ type: "infoPanel", title: "Session stats", markdown: lines.join("\n") });
          break;
        }
        case "name":
          if (!args) { post({ type: "toast", text: "Usage: /name <name>" }); break; }
          await rpc.setSessionName(args);
          sessionName = args;
          const st = await rpc.getState();
          sessionFile = st.sessionFile;
          post({ type: "state", state: st });
          await sendSessionInfo();
          post({ type: "toast", text: `Session name set: ${args}`, kind: "success" });
          break;
        case "clear":
        case "new":
          await rpc.newSession();
          await hydrate();
          post({ type: "toast", text: "Started new session.", kind: "success" });
          break;
        case "reload":
          await reloadSession();
          break;
      }
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  async function reloadSession() {
    if (streaming) return;
    if (!sessionFile && rpcAlive) {
      post({ type: "toast", text: "This session has not been saved yet.", kind: "error" });
      return;
    }
    try {
      if (rpcAlive) await rpc.dispose();
      rpcAlive = false;
      rpc = await bootRpc(sessionFile);
      rpcAlive = true;
      await hydrate();
      post({ type: "toast", text: "Session reloaded", kind: "success" });
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleMessage(msg: { type: string; [k: string]: unknown }) {
    if (sessionDisposed) return;
    switch (msg.type) {
      case "webviewReady":
        void hydrate();
        break;
      case "prompt":
        try {
          if (await handleBuiltin(String(msg.message ?? ""))) break;
          await rpc.prompt(
            String(msg.message ?? ""),
            msg.streamingBehavior as "steer" | "followUp" | undefined,
            msg.images as RpcImage[] | undefined,
          );
        } catch (e) {
          post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      case "abort":
        try { await rpc.abort(); } catch {}
        break;
      case "clearQueue":
        try {
          await rpc.clearQueue();
          post({ type: "event", event: { type: "queue_update", steering: [], followUp: [] } });
        } catch {}
        break;
      case "setModel":
        try {
          await rpc.setModel(String(msg.provider ?? ""), String(msg.modelId ?? ""));
          const st = await rpc.getState();
          post({ type: "state", state: st });
          const levels = await rpc.getAvailableThinkingLevels();
          post({ type: "thinkingLevels", levels });
          void sendContextUsage();
        } catch (e) {
          post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      case "setThinking":
        try {
          await rpc.setThinkingLevel(String(msg.level ?? ""));
          const st = await rpc.getState();
          post({ type: "state", state: st });
        } catch {}
        break;
      case "setSessionName":
        try {
          const name = String(msg.name ?? "");
          await rpc.setSessionName(name);
          sessionName = name;
          const st = await rpc.getState();
          sessionFile = st.sessionFile;
          post({ type: "state", state: st });
          await sendSessionInfo();
          post({ type: "toast", text: `Session name set: ${name}`, kind: "success" });
        } catch (e) {
          post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      case "fork":
        try {
          if (streaming) { post({ type: "toast", text: "Stop the agent before forking.", kind: "error" }); break; }
          const entriesData = await rpc.getEntries();
          const entry = entriesData.entries.find(e => e.type === "message" && e.message?.role === "user" && e.message?.timestamp === msg.ts);
          if (!entry) { post({ type: "toast", text: "Could not locate that message to fork from.", kind: "error" }); break; }
          const forkResult = await rpc.fork(entry.id);
          if (forkResult.cancelled) { post({ type: "toast", text: "Fork cancelled." }); break; }
          const rSt = await rpc.getState();
          sessionFile = rSt.sessionFile;
          post({ type: "state", state: rSt });
          const rMsgs = await rpc.getMessages();
          post({ type: "messages", messages: rMsgs });
          void sendContextUsage();
          post({ type: "toast", text: "Forked from selected message.", kind: "success" });
        } catch (e) {
          post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      case "revert":
        try {
          if (streaming) { post({ type: "toast", text: "Stop the agent before reverting.", kind: "error" }); break; }
          const revEntries = await rpc.getEntries();
          const revEntry = revEntries.entries.find(e => e.type === "message" && e.message?.role === "user" && e.message?.timestamp === msg.ts);
          if (!revEntry) { post({ type: "toast", text: "Could not locate that message to revert to.", kind: "error" }); break; }
          const revText = messageText(revEntry.message?.content);
          const beforeLeaf = revEntries.leafId;
          await rpc.prompt(`/pi-vscode-tree ${revEntry.id}`);
          const afterEntries = await rpc.getEntries();
          if (afterEntries.leafId === beforeLeaf) break;
          const revSt = await rpc.getState();
          sessionFile = revSt.sessionFile;
          post({ type: "state", state: revSt });
          const revMsgs = await rpc.getMessages();
          post({ type: "messages", messages: revMsgs });
          if (revText) post({ type: "prefillInput", text: revText });
          void sendContextUsage();
          post({ type: "toast", text: "Reverted to selected message.", kind: "success" });
        } catch (e) {
          post({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
        break;
      case "dialogResponse":
        rpc.respondExtensionUi(String(msg.id ?? ""), {
          value: msg.value as string | undefined,
          confirmed: msg.confirmed as boolean | undefined,
          cancelled: msg.cancelled as boolean | undefined,
        });
        break;
      case "reload":
        void reloadSession();
        break;
      case "todoClear":
        void rpc.prompt("/todo-clear", streaming ? "steer" : undefined).catch(() => {});
        break;
      case "mcpOpen":
        void rpc.prompt("/mcp status", streaming ? "steer" : undefined).catch(() => {});
        break;
      case "mcpAction": {
        const action = String(msg.action ?? "status");
        const server = String(msg.server ?? "");
        void rpc.prompt(`/mcp ${action}${server ? " " + server : ""}`, streaming ? "steer" : undefined).catch(() => {});
        break;
      }
      case "setPermission":
        void rpc.prompt(`/permission ${String(msg.mode ?? "")}`, streaming ? "steer" : undefined).catch(() => {});
        break;
      case "btwAbort":
        rpc.respondExtensionUi(String(msg.id ?? ""), { confirmed: true });
        break;
      case "toggleFavorite":
        // Re-fetch models so UI updates; actual persistence is in settings
        try {
          const models = await rpc.getAvailableModels();
          post({ type: "models", models });
        } catch {}
        break;
      case "rewindAccept":
        if (!streaming) void rpc.prompt("/rewind-accept").catch(() => {});
        break;
      case "rewindAcceptFile":
        if (!streaming) void rpc.prompt(`/rewind-accept-file ${msg.id}`).catch(() => {});
        break;
      case "rewindRevert":
        if (!streaming) void rpc.prompt("/rewind-revert").catch(() => {});
        break;
      case "rewindRevertFile":
        if (!streaming) void rpc.prompt(`/rewind-revert-file ${msg.id}`).catch(() => {});
        break;
      // searchFiles / pickResource / copy / openFile are handled in main.ts via IPC directly
    }
  }

  async function switchTo(file: string) {
    if (streaming) { post({ type: "toast", text: "Stop the agent before switching sessions.", kind: "error" }); return; }
    try {
      await rpc.switchSession(file);
      const st = await rpc.getState();
      sessionFile = st.sessionFile;
      post({ type: "state", state: st });
      const messages = await rpc.getMessages();
      post({ type: "messages", messages });
      void sendContextUsage();
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function newSession() {
    if (streaming) { post({ type: "toast", text: "Stop the agent before starting a new session.", kind: "error" }); return; }
    try {
      await rpc.newSession();
      await hydrate();
      post({ type: "toast", text: "Started new session.", kind: "success" });
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Boot RPC
  let rpcGeneration = 0;

  async function bootRpc(sessionFileForSpawn?: string): Promise<RpcClient> {
    const gen = ++rpcGeneration;
    const args = [
      ...extArgs,
      "--mode", "rpc",
      ...(sessionFileForSpawn ? ["--session", sessionFileForSpawn] : []),
      ...(opts.config.args || []),
    ];
    return createRpcClient({
      piPath,
      args,
      env,
      cwd,
      handlers: {
        onEvent: (event) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          if (event.type === "agent_start") updateStreaming(true);
          else if (event.type === "agent_settled") updateStreaming(false);
          post({ type: "event", event });
          if (event.type === "agent_settled") {
            if (!sessionFile) {
              void rpc.getState().then(s => {
                sessionFile = s.sessionFile;
                sessionName = s.sessionName;
                void sendSessionInfo();
              }).catch(() => {});
            }
            void rpc.getCommands().then(cmds => {
              post({ type: "commands", commands: mergeBuiltinCommands(cmds) });
            }).catch(() => {});
            void sendContextUsage();
          } else if (event.type === "message_end") {
            void sendContextUsage();
          }
        },
        onExtensionUiRequest: (req) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          handleExtUiRequest(req);
        },
        onExit: (code) => {
          if (gen !== rpcGeneration) return;
          updateStreaming(false);
          rpcAlive = false;
          // Do NOT set sessionDisposed — allow reload/recovery
          post({ type: "error", message: "Pi process exited" + (code != null ? ` (code ${code})` : "") + ". Click reload or send a message to restart." });
        },
        onError: (err) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          post({ type: "error", message: err.message });
        },
      },
    });
  }

  rpc = await bootRpc(sessionFile);
  rpcAlive = true;

  // Hydrate immediately so UI gets state/models even if webviewReady already fired
  void hydrate();

  return {
    get rpc() { return rpc; },
    get sessionFile() { return sessionFile; },
    get streaming() { return streaming; },
    handleMessage: async (msg) => {
      // Auto-reload if process died and user tries to interact
      if (!rpcAlive && !sessionDisposed && msg.type !== "webviewReady") {
        await reloadSession();
      }
      await handleMessage(msg);
    },
    switchTo,
    newSession,
    dispose() {
      if (sessionDisposed) return;
      sessionDisposed = true;
      void rpc.dispose();
    },
  };
}
