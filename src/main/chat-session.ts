/**
 * Chat session controller for Electron.
 * Ported from upstream src/chat/chat-session.ts — VS Code deps replaced with Electron equivalents.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import {
  createRpcClient,
  formatExitReason,
  type RpcClient,
  type ExtensionUiRequest,
  type RpcImage,
} from "./rpc-client";
import type { StandaloneConfig } from "../shared/types";
import { getRealBridgeDir } from "./bridge-extract";
import { StatsCollector, type UsageLike, type StatsSnapshot } from "./stats";
import type { StoredSessionStats } from "./stats-store";
import { log, errText } from "./log";
import { getSpawnQueue, profileKey } from "./spawn-queue";

/**
 * Pause before the one retry of a failed start-up. Long enough for a just-killed pi to let go of
 * whatever it held, short enough that a person reads it as "it took a moment", not as a hang.
 */
const STARTUP_RETRY_DELAY_MS = 1500;

// ─── Builtin commands (from upstream builtin-commands.ts) ─────────────

const BUILTIN_CMDS: Array<{
  name: string;
  description: string;
  source: "builtin";
}> = [
  {
    name: "compact",
    description: "Compact the conversation",
    source: "builtin",
  },
  {
    name: "autocompact",
    description: "Toggle auto-compaction",
    source: "builtin",
  },
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
  const known = BUILTIN_CMDS.find((c) => c.name === name);
  return known ? { name, args } : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let t = "";
  for (const block of content) {
    if (typeof block === "string") t += block;
    else if (
      block &&
      typeof block === "object" &&
      (block as any).type === "text" &&
      typeof (block as any).text === "string"
    )
      t += (t ? "\n" : "") + (block as any).text;
  }
  return t;
}

function shortenHome(p: string): string {
  const home = homedir();
  if (home && (p === home || p.startsWith(home + sep))) return `~${p.slice(home.length)}`;
  return p;
}

/** First-token latency / throughput / cost for the last finished turn. */
interface TokenMetrics {
  firstTokenMs?: number;
  durationMs?: number;
  tokensPerSec?: number;
  outputTokens?: number;
  cost?: number;
}

/**
 * Best-effort calls must never surface as a hard failure, but they must not
 * disappear either — a silent catch here is how "the UI just does nothing" bugs start.
 */
function warnBestEffort(what: string, e: unknown): void {
  log.warn(`chat-session ${what} failed:`, errText(e));
}

// ─── Find pi binary ───────────────────────────────────────────────────

export function findPiBinary(customPath?: string): string {
  if (customPath && existsSync(customPath)) return customPath;
  // npm global install location (Windows default)
  const isWin = process.platform === "win32";
  const npmGlobal = join(process.env.APPDATA || "", "npm", isWin ? "pi.cmd" : "pi");
  if (process.env.APPDATA && existsSync(npmGlobal)) return npmGlobal;
  // Search PATH ourselves: on Windows CreateProcess does not expand PATHEXT, so
  // spawning a bare "pi" only works when a real pi.exe exists.
  const exts = isWin ? [".exe", ".cmd", ".bat", ".ps1", ""] : [""];
  const dirs = (process.env.PATH || "").split(isWin ? ";" : ":");
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `pi${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "pi";
}

export function buildExtensionArgs(appPath: string, config: StandaloneConfig): string[] {
  const bridgeDir = getRealBridgeDir(appPath);
  const extensions = [
    "todo.ts",
    "questionnaire.ts",
    "btw.ts",
    "permission-gate.ts",
    "rewind-code.ts",
  ];
  const args: string[] = [];
  const missing: string[] = [];
  for (const ext of extensions) {
    const p = join(bridgeDir, ext);
    if (existsSync(p)) {
      args.push("-e", p);
    } else {
      missing.push(ext);
    }
  }
  // subagent directory
  const subagentDir = join(bridgeDir, "subagent");
  if (existsSync(join(subagentDir, "index.ts"))) {
    args.push("-e", join(subagentDir, "index.ts"));
  } else {
    missing.push("subagent/index.ts");
  }
  // mcp
  if (config.mcpEnabled) {
    const mcpPath = join(bridgeDir, "mcp", "index.js");
    if (existsSync(mcpPath)) {
      args.push("-e", mcpPath);
    } else {
      missing.push("mcp/index.js");
    }
  }
  if (missing.length) {
    // Degrading silently is the wrong failure mode: a build that lost the bridge
    // directory would run without todo, permission-gate or rewind and never say
    // so. Say so.
    console.error(
      `[pi-heao] 扩展未挂载: ${missing.join(", ")}（bridge 目录: ${bridgeDir}）—— 相关功能将不可用`,
    );
  }
  return args;
}

export function buildEnv(config: StandaloneConfig, appPath: string): Record<string, string> {
  const bridgeDir = getRealBridgeDir(appPath);
  const env: Record<string, string> = {
    PI_VSCODE_STATUS_BAR: "0",
    PI_VSCODE_DISABLED_TOOLS: JSON.stringify(config.disabledTools || []),
    PI_VSCODE_PERMISSION: JSON.stringify({
      mode: config.permissionMode,
      patterns: config.dangerousPatterns || [],
    }),
    PI_VSCODE_MCP_IDLE_TIMEOUT: String(config.mcpIdleTimeout ?? 10),
    PI_VSCODE_BUILTIN_AGENTS_DIR: join(bridgeDir, "agents"),
    // Where this process's bridge extensions live. The subagent extension spawns a second pi,
    // and a subagent that does not mount the gate has no permission prompts at all — so it
    // needs a way to find the sibling extension without guessing (see subagent/index.ts).
    PI_VSCODE_BRIDGE_DIR: bridgeDir,
    // No bridge — extensions that need it will no-op
  };
  return { ...config.env, ...env };
}

// ─── Session ──────────────────────────────────────────────────────────

export interface ChatSessionHost {
  postToRenderer(msg: unknown): void;
  /** Persist per-session telemetry (turns + per-day spend). */
  saveStats?(sessionFile: string | undefined, data: StoredSessionStats): void;
  loadStats?(sessionFile: string): StoredSessionStats | undefined;
  /** Toggle a favourite model; returns the updated list as "provider/modelId". */
  toggleFavorite?(provider: string, modelId: string): string[];
  /** Favourite models, used to seed the model picker after a restart. */
  getFavorites?(): string[];
}

export interface ChatSession {
  rpc: RpcClient;
  sessionFile?: string;
  streaming: boolean;
  handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void>;
  switchTo(sessionFile: string): Promise<void>;
  newSession(): Promise<void>;
  /** Rename this session via pi (mirrors the /name command). */
  renameCurrent(name: string): Promise<{ ok: boolean; error?: string }>;
  /** Telemetry for this session: TTFT, throughput, cache hit rate, spend. */
  statsSnapshot(): StatsSnapshot & { sessionFile: string; cwd: string };
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
  // Prefer explicit workspace; never fall back to process.cwd() (portable exe = temp dir)
  const cwd = opts.cwd || opts.config.workspaceRoot || homedir();
  const extArgs = buildExtensionArgs(opts.appPath, opts.config);
  const env = buildEnv(opts.config, opts.appPath);

  let sessionFile = opts.sessionFile;
  let sessionName: string | undefined;
  let streaming = false;
  let sessionDisposed = false;
  let rpcAlive = false;
  let rpc: RpcClient;

  // Token metrics tracking
  let promptSentAt = 0;
  // Per-session telemetry: first-token latency, decode speed, cache hit rate,
  // reasoning tokens, per-day cost. Replaces the old ad-hoc firstTokenAt/lastMetrics
  // pair, which measured "settled minus first event" instead of real decode time.
  const collector = new StatsCollector();
  let collectorSessionFile = "";
  let lastUsage: UsageLike | undefined;
  let lastLivePost = 0;
  let lastMetrics: TokenMetrics = {};
  let budgetWarnDay = "";
  let budgetWarnMonth = "";

  function monthKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}`;
  }

  const post = (msg: unknown) => {
    if (!sessionDisposed) opts.host.postToRenderer(msg);
  };

  function updateStreaming(running: boolean) {
    streaming = running;
    post({ type: "streaming", running });
  }

  async function sendContextUsage() {
    if (sessionDisposed) return;
    try {
      const stats = await rpc.getSessionStatsFull();
      if (!sessionDisposed) {
        post({
          type: "contextUsage",
          usage: stats.contextUsage ?? null,
          cost: stats.cost,
        });
        // Also send token totals
        post({
          type: "tokenStats",
          tokens: stats.tokens ?? null,
          cost: stats.cost ?? null,
        });
      }
    } catch (e) {
      warnBestEffort("context usage", e);
    }
  }

  function sendTokenMetrics() {
    if (sessionDisposed) return;
    const last = collector.last();
    lastMetrics = {
      firstTokenMs: last?.ttftMs ?? undefined,
      durationMs: last ? last.endedAt - last.startedAt : undefined,
      tokensPerSec: last?.tps ?? undefined,
      outputTokens: last?.outputTokens,
      cost: last?.cost,
    };
    post({ type: "tokenMetrics", metrics: lastMetrics });
  }

  /** Full telemetry snapshot (aggregate + per-turn + today/month spend). */
  function statsSnapshot(): StatsSnapshot & { sessionFile: string; cwd: string } {
    return { ...collector.snapshot(Date.now()), sessionFile: sessionFile ?? "", cwd };
  }

  /** Warn once when the configured daily/monthly budget is crossed. */
  function checkBudget(turn: { cost: number }): void {
    const now = Date.now();
    const daily = opts.config.budgetDailyUsd ?? 0;
    const monthly = opts.config.budgetMonthlyUsd ?? 0;
    if (
      daily > 0 &&
      collector.costToday(now) >= daily &&
      budgetWarnDay !== new Date(now).toDateString()
    ) {
      budgetWarnDay = new Date(now).toDateString();
      post({
        type: "toast",
        text: `今日花费 $${collector.costToday(now).toFixed(3)} 已超出预算 $${daily.toFixed(2)}`,
        kind: "error",
      });
    }
    if (monthly > 0 && collector.costMonth(now) >= monthly && budgetWarnMonth !== monthKey(now)) {
      budgetWarnMonth = monthKey(now);
      post({
        type: "toast",
        text: `本月花费 $${collector.costMonth(now).toFixed(3)} 已超出预算 $${monthly.toFixed(2)}`,
        kind: "error",
      });
    }
    void turn;
  }

  function persistStats(): void {
    if (!sessionFile || sessionFile === collectorSessionFile) {
      opts.host.saveStats?.(sessionFile, collector.toJSON());
      return;
    }
    collectorSessionFile = sessionFile;
    opts.host.saveStats?.(sessionFile, collector.toJSON());
  }

  /** Load persisted telemetry for a session so totals survive app restarts. */
  function loadStatsFor(file: string): void {
    collectorSessionFile = file;
    const stored = opts.host.loadStats?.(file);
    if (stored) collector.load(stored);
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
      if (sessionFile) loadStatsFor(sessionFile);
      post({ type: "state", state: st });
      post({ type: "permissionMode", mode: opts.config.permissionMode });
      post({ type: "models", models });
      // Restore the starred models from config (pi-chat keeps them in UI state).
      const favourites = opts.host.getFavorites?.() ?? [];
      post({ type: "enabledModels", keys: favourites.map((k) => k.toLowerCase()) });
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
      // While a failed start-up is being retried, an error about the pi that is already being
      // replaced is noise: the retry hydrates again, and reports itself if it fails too.
      if (retryingStartup) return;
      post({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function handleExtUiRequest(req: ExtensionUiRequest) {
    const id = String(req.id ?? "");
    if (
      req.method === "select" ||
      req.method === "confirm" ||
      req.method === "input" ||
      req.method === "editor"
    ) {
      // Answered later, from the dialog, by the person using the app.
      post({ type: "dialog", request: req });
      return;
    }
    if (req.method === "setWidget") {
      post({
        type: "widget",
        widgetKey: req.widgetKey,
        widgetLines: req.widgetLines,
      });
    } else if (req.method === "notify") {
      const message = String(req.message ?? "");
      if (message.startsWith("__mcp_status__")) {
        try {
          const servers = JSON.parse(message.slice("__mcp_status__".length));
          post({ type: "mcpStatus", servers });
        } catch (e) {
          warnBestEffort("mcp status parse", e);
        }
      } else {
        const t = req.notifyType as string | undefined;
        const kind = t === "error" ? "error" : t === "success" ? "success" : "info";
        post({ type: "toast", text: message, kind });
      }
    }
    // setStatus / setTitle / set_editor_text carry text for a host chrome this
    // app does not have; it is accepted and answered rather than rendered.

    // Answer every non-interactive request. pi's extension call does not resolve
    // until the host replies, so a request the app merely displays — a widget, a
    // notification, a status line — holds the agent loop open. A typical package
    // set emits dozens per turn, and the visible symptom was a turn that stopped
    // after its first tool call.
    //
    // The payload matters: respondExtensionUi turns a missing `value` into
    // `cancelled`, so an empty object would answer "cancelled" to what is really
    // an acknowledgement.
    if (id) rpc.respondExtensionUi(id, { value: "" });
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
          else {
            const st = await rpc.getState();
            enabled = !st.autoCompactionEnabled;
          }
          await rpc.setAutoCompaction(enabled);
          post({
            type: "toast",
            text: enabled ? "Auto-compaction enabled." : "Auto-compaction disabled.",
          });
          break;
        }
        case "session": {
          const stats = await rpc.getSessionStatsFull();
          const lines = ["| Field | Value |", "|---|---|"];
          if (stats.sessionId) lines.push(`| Session ID | \`${stats.sessionId}\` |`);
          if (stats.sessionFile) lines.push(`| Session file | \`${stats.sessionFile}\` |`);
          lines.push(`| Messages | ${stats.totalMessages ?? 0} |`);
          if (stats.cost != null) lines.push(`| Cost | $${stats.cost.toFixed(4)} |`);
          post({
            type: "infoPanel",
            title: "Session stats",
            markdown: lines.join("\n"),
          });
          break;
        }
        case "name": {
          if (!args) {
            post({ type: "toast", text: "Usage: /name <name>" });
            break;
          }
          await rpc.setSessionName(args);
          sessionName = args;
          const st = await rpc.getState();
          sessionFile = st.sessionFile;
          post({ type: "state", state: st });
          await sendSessionInfo();
          post({
            type: "toast",
            text: `Session name set: ${args}`,
            kind: "success",
          });
          break;
        }
        case "clear":
        case "new":
          await rpc.newSession();
          await hydrate();
          post({
            type: "toast",
            text: "Started new session.",
            kind: "success",
          });
          break;
        case "reload":
          await reloadSession();
          break;
      }
    } catch (e) {
      post({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return true;
  }

  /**
   * One reload at a time, and everyone who asked waits for the same one.
   *
   * `handleMessage` calls this whenever `rpcAlive` is false — and IPC handlers are not serialised,
   * so two messages arriving while pi is gone both found `rpcAlive === false` and both started a
   * start-up. The second `bootRpc` overwrote the `rpc` reference without disposing the first
   * client: one pi stayed alive for the life of the machine (it is not in `windowSessions`, so
   * nothing else can reach it), and both wrote the same session file. Returning early instead
   * would trade that for the other failure — a message sent with a disposed client. So the callers
   * share the promise.
   */
  let reloadInFlight: Promise<void> | null = null;

  function reloadSession(): Promise<void> {
    if (reloadInFlight) return reloadInFlight;
    if (streaming) return Promise.resolve();
    if (!sessionFile && rpcAlive) {
      post({
        type: "toast",
        text: "This session has not been saved yet.",
        kind: "error",
      });
      return Promise.resolve();
    }
    reloadInFlight = (async () => {
      try {
        if (rpcAlive) await rpc.dispose();
        rpcAlive = false;
        const client = await bootRpc(sessionFile);
        // The window can close while a start-up is in flight; a client that arrives after that is
        // exactly the orphan this function must not create.
        if (sessionDisposed) {
          void client.dispose();
          return;
        }
        await hydrate();
        post({ type: "toast", text: "Session reloaded", kind: "success" });
      } catch (e) {
        post({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      } finally {
        reloadInFlight = null;
      }
    })();
    return reloadInFlight;
  }

  async function dispatchMessage(msg: { type: string; [k: string]: unknown }) {
    if (sessionDisposed) return;
    switch (msg.type) {
      case "webviewReady":
        // The first sessionInfo can be posted before the titlebar script has wired its
        // listener, and the title then stays on its empty placeholder for the whole session.
        // Re-announcing on ready closes that race.
        //
        // Three more announcements close the other half of it. The app mounts asynchronously and
        // its listener is not attached for the whole of that window — it is still not attached
        // when it sends webviewReady — so a single push, or a short one, can land while nobody is
        // listening: measured as a child window that sometimes opened with the right title and an
        // empty conversation, rendering between 6s and 10s when it worked and never when it did
        // not, and still failing under the load of the debug probes at 600ms and 1800ms. The
        // schedule below covers the slow end; hydrate() is idempotent, and every timer is unref'd
        // and gives up on a disposed session.
        void sendSessionInfo();
        void hydrate();
        for (const delay of [600, 1800, 5000, 12000]) {
          setTimeout(() => {
            if (sessionDisposed) return;
            void sendSessionInfo();
            void hydrate();
          }, delay).unref();
        }
        break;
      case "prompt":
        try {
          if (await handleBuiltin(String(msg.message ?? ""))) break;
          promptSentAt = Date.now();
          lastUsage = undefined;
          collector.beginTurn(promptSentAt);
          await rpc.prompt(
            String(msg.message ?? ""),
            msg.streamingBehavior as "steer" | "followUp" | undefined,
            msg.images as RpcImage[] | undefined,
          );
        } catch (e) {
          post({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "abort":
        try {
          await rpc.abort();
        } catch (e) {
          warnBestEffort("abort", e);
        }
        break;
      case "clearQueue":
        try {
          await rpc.clearQueue();
          post({
            type: "event",
            event: { type: "queue_update", steering: [], followUp: [] },
          });
        } catch (e) {
          warnBestEffort("clear queue", e);
        }
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
          post({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "setThinking":
        try {
          await rpc.setThinkingLevel(String(msg.level ?? ""));
          const st = await rpc.getState();
          post({ type: "state", state: st });
        } catch (e) {
          warnBestEffort("set thinking level", e);
        }
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
          post({
            type: "toast",
            text: `Session name set: ${name}`,
            kind: "success",
          });
        } catch (e) {
          post({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "fork":
        try {
          if (streaming) {
            post({
              type: "toast",
              text: "Stop the agent before forking.",
              kind: "error",
            });
            break;
          }
          const entriesData = await rpc.getEntries();
          const entry = entriesData.entries.find(
            (e) =>
              e.type === "message" && e.message?.role === "user" && e.message?.timestamp === msg.ts,
          );
          if (!entry) {
            post({
              type: "toast",
              text: "Could not locate that message to fork from.",
              kind: "error",
            });
            break;
          }
          const forkResult = await rpc.fork(entry.id);
          if (forkResult.cancelled) {
            post({ type: "toast", text: "Fork cancelled." });
            break;
          }
          const rSt = await rpc.getState();
          sessionFile = rSt.sessionFile;
          post({ type: "state", state: rSt });
          const rMsgs = await rpc.getMessages();
          post({ type: "messages", messages: rMsgs });
          void sendContextUsage();
          post({
            type: "toast",
            text: "Forked from selected message.",
            kind: "success",
          });
        } catch (e) {
          post({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      case "revert":
        try {
          if (streaming) {
            post({
              type: "toast",
              text: "Stop the agent before reverting.",
              kind: "error",
            });
            break;
          }
          const revEntries = await rpc.getEntries();
          const revEntry = revEntries.entries.find(
            (e) =>
              e.type === "message" && e.message?.role === "user" && e.message?.timestamp === msg.ts,
          );
          if (!revEntry) {
            post({
              type: "toast",
              text: "Could not locate that message to revert to.",
              kind: "error",
            });
            break;
          }
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
          post({
            type: "toast",
            text: "Reverted to selected message.",
            kind: "success",
          });
        } catch (e) {
          post({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
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
        void rpc
          .prompt(`/mcp ${action}${server ? ` ${server}` : ""}`, streaming ? "steer" : undefined)
          .catch(() => {});
        break;
      }
      case "setPermission":
        void rpc
          .prompt(`/permission ${String(msg.mode ?? "")}`, streaming ? "steer" : undefined)
          .catch(() => {});
        break;
      case "btwAbort":
        rpc.respondExtensionUi(String(msg.id ?? ""), { confirmed: true });
        break;
      case "toggleFavorite":
        // pi-chat owns the starred keys in its own UI state; persist them here so
        // the stars survive a restart (see the enabledModels post in hydrate).
        try {
          const provider = String(msg.provider ?? "");
          const modelId = String(msg.modelId ?? "");
          const keys = opts.host.toggleFavorite?.(provider, modelId);
          if (keys) post({ type: "enabledModels", keys: keys.map((k) => k.toLowerCase()) });
          const models = await rpc.getAvailableModels();
          post({ type: "models", models });
        } catch (e) {
          warnBestEffort("refresh models", e);
        }
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

  /** Rename the current session through pi (so pi's own state sees it too). */
  async function renameCurrent(name: string): Promise<{ ok: boolean; error?: string }> {
    const clean = name
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 120);
    if (!clean) return { ok: false, error: "名称不能为空" };
    try {
      await rpc.setSessionName(clean);
      sessionName = clean;
      const st = await rpc.getState();
      sessionFile = st.sessionFile;
      post({ type: "state", state: st });
      await sendSessionInfo();
      return { ok: true };
    } catch (e) {
      warnBestEffort("rename", e);
      return { ok: false, error: errText(e) };
    }
  }

  async function switchTo(file: string) {
    if (streaming) {
      post({
        type: "toast",
        text: "Stop the agent before switching sessions.",
        kind: "error",
      });
      return;
    }
    try {
      await rpc.switchSession(file);
      const st = await rpc.getState();
      sessionFile = st.sessionFile;
      // Telemetry is per session: swap in the stored turns for the new file.
      if (sessionFile) loadStatsFor(sessionFile);
      post({ type: "state", state: st });
      post({ type: "stats", stats: statsSnapshot() });
      const messages = await rpc.getMessages();
      post({ type: "messages", messages });
      void sendContextUsage();
    } catch (e) {
      post({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function newSession() {
    if (streaming) {
      post({
        type: "toast",
        text: "Stop the agent before starting a new session.",
        kind: "error",
      });
      return;
    }
    try {
      await rpc.newSession();
      await hydrate();
      post({ type: "toast", text: "Started new session.", kind: "success" });
    } catch (e) {
      post({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Boot RPC
  let rpcGeneration = 0;
  /** Whether a start-up that died before it was ready has already had its one retry. */
  let startupRetried = false;
  /** A failed start-up is being retried: an error about the pi already being replaced is noise. */
  let retryingStartup = false;

  /**
   * Start pi, waiting for the spawn queue if another start-up is already installing the same agent
   * packages (see spawn-queue.ts).
   *
   * Returns as soon as pi is spawned — the session has to be in the window while a start-up finishes,
   * and on a profile whose packages still have to be installed that is a minute or more (measured:
   * +70.9 s warm, past +170 s cold). pi reads stdin only once it is ready, so a message sent during
   * that window is answered late rather than lost.
   */
  async function bootRpc(sessionFileForSpawn?: string): Promise<RpcClient> {
    const spawnKey = profileKey({ ...process.env, ...env });
    let released = true;
    const releaseSpawn = () => {
      if (released) return;
      released = true;
      getSpawnQueue().release(spawnKey);
    };

    await getSpawnQueue().acquire(spawnKey);
    released = false;
    try {
      const client = await spawnRpc(sessionFileForSpawn, releaseSpawn, (err) => {
        // A start-up that never became usable must not hold the queue until its ceiling, and it is
        // the one failure worth another try (see retryStartup).
        releaseSpawn();
        void retryStartup(err, sessionFileForSpawn);
      });
      rpc = client;
      rpcAlive = true;
      return client;
    } catch (e) {
      releaseSpawn();
      throw e;
    }
  }

  /**
   * The one retry of a start-up that died before it was ready.
   *
   * A start-up can fail for a reason that does not repeat — a transient npm or filesystem error, a
   * lock held by a pi that was just killed — and the person used to get a red banner and had to
   * reload by hand. It cannot become a crash loop: a failure *after* start-up never reaches here,
   * and a second start-up failure reports itself as before.
   */
  async function retryStartup(reason: unknown, sessionFileForSpawn?: string): Promise<void> {
    if (startupRetried || sessionDisposed) {
      // The retry is spent (or there is nothing left to retry for). Keep the shape the app already
      // knows how to recover from: the session stays in the window, the banner says why pi went, and
      // the next message — or a reload — starts it again.
      if (!sessionDisposed) post({ type: "error", message: errText(reason) });
      return;
    }
    startupRetried = true;
    retryingStartup = true;
    log.warn("pi exited during start-up; retrying once:", errText(reason));
    await new Promise((resolve) => setTimeout(resolve, STARTUP_RETRY_DELAY_MS));
    try {
      if (sessionDisposed) return;
      await bootRpc(sessionFileForSpawn);
      await hydrate();
      post({ type: "toast", text: "Session restarted", kind: "success" });
    } catch (e) {
      rpcAlive = false;
      post({ type: "error", message: errText(e) });
    } finally {
      retryingStartup = false;
    }
  }

  /**
   * One pi child, plus the one thing `createRpcClient` cannot tell us: whether it is still there.
   *
   * `createRpcClient` hands back the client as soon as the process is spawned — the line that means
   * "past start-up" is a minute or more away on a profile whose agent packages are still to be
   * `createRpcClient` hands back the client as soon as the process is spawned — the line that means
   * "past start-up" is a minute or more away on a profile whose agent packages are still to be
   * installed. `onReady` fires on the first line pi writes, and `onStartupFailure` fires instead if
   * pi exits (or cannot be spawned) before that — which is what lets the caller retry a start-up that
   * failed, instead of showing a banner and leaving it there.
   */
  function spawnRpc(
    sessionFileForSpawn: string | undefined,
    onReady: () => void,
    onStartupFailure: (err: Error) => void,
  ): Promise<RpcClient> {
    const gen = ++rpcGeneration;
    const args = [
      ...extArgs,
      "--mode",
      "rpc",
      ...(sessionFileForSpawn ? ["--session", sessionFileForSpawn] : []),
      ...(opts.config.args || []),
    ];
    let readyReported = false;
    const client = createRpcClient({
      piPath,
      args,
      env,
      cwd,
      onReady: () => {
        readyReported = true;
        onReady();
      },
      handlers: {
        onEvent: (event) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          const now = Date.now();
          if (event.type === "agent_start") {
            updateStreaming(true);
          } else if (event.type === "message_update") {
            const wire = event as { usage?: UsageLike };
            if (wire.usage) lastUsage = wire.usage;
            collector.onDelta(now, wire.usage);
            // live readout while streaming (throttled: deltas arrive per token)
            if (now - lastLivePost > 200) {
              lastLivePost = now;
              const live = collector.live(now);
              if (live) post({ type: "liveStats", live });
            }
          } else if (event.type === "tool_execution_end") {
            collector.onToolCall();
          } else if (event.type === "turn_end" || event.type === "message_end") {
            const wire = event as { usage?: UsageLike; stopReason?: string };
            if (wire.usage) lastUsage = wire.usage;
          } else if (event.type === "agent_settled") {
            updateStreaming(false);
            const turn = collector.endTurn(now, { usage: lastUsage });
            if (turn) {
              post({ type: "turnStats", turn, stats: statsSnapshot() });
              sendTokenMetrics();
              persistStats();
              checkBudget(turn);
            }
            promptSentAt = 0;
            lastUsage = undefined;
          }
          post({ type: "event", event });
          if (event.type === "agent_settled") {
            if (!sessionFile) {
              void rpc
                .getState()
                .then((s) => {
                  sessionFile = s.sessionFile;
                  sessionName = s.sessionName;
                  void sendSessionInfo();
                })
                .catch(() => {});
            }
            void rpc
              .getCommands()
              .then((cmds) => {
                post({
                  type: "commands",
                  commands: mergeBuiltinCommands(cmds),
                });
              })
              .catch(() => {});
            void sendContextUsage();
          } else if (event.type === "message_end") {
            void sendContextUsage();
          }
        },
        onExtensionUiRequest: (req) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          handleExtUiRequest(req);
        },
        onExit: (code, signal, stderrTail) => {
          if (gen !== rpcGeneration) return;
          updateStreaming(false);
          rpcAlive = false;
          // A pi that never got as far as printing anything is a start-up that failed, and the
          // caller may retry it. A pi that dies later is the person's business: "code 1" on its own
          // is both unactionable and, on Windows, what a force-kill looks like — so the message
          // carries the tail of what pi printed before it went.
          if (!readyReported) {
            onStartupFailure(new Error(formatExitReason(code, signal, stderrTail)));
            return;
          }
          post({ type: "error", message: formatExitReason(code, signal, stderrTail) });
        },
        onError: (err) => {
          if (gen !== rpcGeneration || sessionDisposed) return;
          // A spawn that never started is the same failure as an early exit.
          if (!readyReported) {
            onStartupFailure(err);
            return;
          }
          post({ type: "error", message: err.message });
        },
      },
    });
    // Provoke that first line. pi does not read stdin until its start-up work is behind it, which
    // is what makes the answer to this cheap request an honest "past start-up": measured with the
    // 11 agent packages of a real profile against an empty prefix, a request written at +1.0 s was
    // answered at +70.9 s — after the last `npm install` — and with nothing to install at +1.0 s.
    // Waiting for an extension's own event instead would never report ready on a profile with no
    // packages (pi prints nothing at all there), and that start-up would hold the spawn queue for
    // its whole ceiling.
    void client
      .then((c) => c.getState())
      .catch(() => {
        // A start-up that dies here is reported through `onStartupFailure`.
      });
    return client;
  }

  rpc = await bootRpc(sessionFile);

  // Hydrate immediately so UI gets state/models even if webviewReady already fired
  void hydrate();

  return {
    get rpc() {
      return rpc;
    },
    get sessionFile() {
      return sessionFile;
    },
    get streaming() {
      return streaming;
    },
    handleMessage: async (msg) => {
      // Auto-reload if process died and user tries to interact
      if (!rpcAlive && !sessionDisposed && msg.type !== "webviewReady") {
        await reloadSession();
      }
      await dispatchMessage(msg);
    },
    switchTo,
    newSession,
    renameCurrent,
    statsSnapshot,
    dispose() {
      if (sessionDisposed) return;
      sessionDisposed = true;
      void rpc.dispose();
    },
  };
}
