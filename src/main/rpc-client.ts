/**
 * RPC client for `pi --mode rpc` subprocess.
 * Ported from upstream src/chat/rpc-client.ts — pure Node, no VS Code deps.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join, dirname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { appendFile } from "node:fs/promises";
import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { log, errText } from "./log";

// ─── Types (subset of upstream chat-types.ts) ─────────────────────────

export interface RpcModel {
  id: string;
  name?: string;
  provider: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: Record<string, unknown>;
}

export interface RpcContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface RpcSessionStats {
  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  cost?: number;
  contextUsage?: RpcContextUsage | null;
}

export interface RpcState {
  model: RpcModel | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
  pendingMessageCount?: number;
  autoCompactionEnabled?: boolean;
}

export interface RpcCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
  location?: string;
  path?: string;
}

export interface RpcResponse {
  id?: string | number;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface RpcImage {
  type: "image";
  data: string;
  mimeType: string;
}

export interface RpcEvent {
  type: string;
  [k: string]: unknown;
}

export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text";
  [k: string]: unknown;
}

export interface RpcClient {
  send(command: Record<string, unknown>): void;
  request<T = unknown>(command: Record<string, unknown>): Promise<T>;
  prompt(
    message: string,
    streamingBehavior?: "steer" | "followUp",
    images?: RpcImage[],
  ): Promise<void>;
  abort(): Promise<void>;
  clearQueue(): Promise<{ steering: string[]; followUp: string[] }>;
  setModel(provider: string, modelId: string): Promise<RpcModel>;
  setThinkingLevel(level: string): Promise<void>;
  getAvailableModels(): Promise<RpcModel[]>;
  getAvailableThinkingLevels(): Promise<string[]>;
  getCommands(): Promise<RpcCommand[]>;
  getMessages(): Promise<unknown[]>;
  getState(): Promise<RpcState>;
  getSessionStatsFull(): Promise<RpcSessionStats>;
  compact(customInstructions?: string): Promise<{ summary?: string; tokensBefore?: number }>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  setSessionName(name: string): Promise<void>;
  newSession(): Promise<{ cancelled: boolean }>;
  switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
  getEntries(): Promise<{
    entries: Array<{
      type: string;
      id: string;
      parentId?: string | null;
      timestamp?: number;
      message?: {
        role?: string;
        timestamp?: number;
        content?: unknown;
      } & Record<string, unknown>;
    }>;
    leafId: string | null;
  }>;
  fork(entryId: string): Promise<{ text: string; cancelled: boolean }>;
  respondExtensionUi(
    id: string,
    payload: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void;
  dispose(): Promise<void>;
}

// ─── Implementation ───────────────────────────────────────────────────

export interface RpcClientHandlers {
  onEvent: (event: RpcEvent) => void;
  onExtensionUiRequest: (request: ExtensionUiRequest) => void;
  /**
   * pi exited. The last lines it printed on stderr come along: a start-up failure explains itself
   * there and nowhere else the person can see.
   */
  onExit: (
    code: number | null,
    signal: NodeJS.Signals | null,
    stderrTail: readonly string[],
  ) => void;
  onError: (err: Error) => void;
}

export interface CreateRpcClientOptions {
  piPath: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  handlers: RpcClientHandlers;
  /**
   * Called once, on pi's first line of stdout. The session sends a cheap request the moment pi is
   * spawned and pi answers only after its start-up work is behind it — measured at +70.9 s with 11
   * agent packages to install and +1.0 s with none — so this is the earliest honest "past
   * start-up" signal available. The spawn queue uses it to let the next pi start; nothing else
   * depends on it.
   */
  onReady?: () => void;
}

// ─── Diagnostics log (async, rotated — never blocks the main process) ──

const LOG_PATH = join(tmpdir(), "pi-standalone-rpc.log");

/** Path of the rotated RPC log, for the diagnostics panel. */
export function getRpcLogPath(): string {
  return LOG_PATH;
}

/** How many lines of pi's stderr the exit handler gets to see. */
export const STDERR_TAIL_LINES = 6;
const STDERR_TAIL_CHARS = 400;
const EXIT_MESSAGE_LINES = 3;
const EXIT_MESSAGE_CHARS = 300;

/**
 * What the app says when pi exits on its own.
 *
 * pi prints the reason for a failed start-up — an agent package that would not install, a config it
 * cannot read — on stderr and then exits 1. The banner used to carry the exit code alone, which no
 * one can act on, while that output went to a rotating file in %TEMP% that only the diagnostics
 * bundle mentions. `code === 1` with nothing after it is also exactly what a force-kill looks like
 * on Windows (this app's own close/reload path calls `taskkill /T /F`), so the code alone is not
 * even evidence that something went wrong.
 */
export function formatExitReason(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail: readonly string[] = [],
): string {
  const how = code != null ? ` (code ${code})` : signal ? ` (killed by ${signal})` : "";
  const head = `Pi process exited${how}. Click reload or send a message to restart.`;
  const lines = stderrTail
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)
    .slice(-EXIT_MESSAGE_LINES)
    .map((line) =>
      line.length > EXIT_MESSAGE_CHARS ? `${line.slice(0, EXIT_MESSAGE_CHARS)}…` : line,
    );
  return lines.length ? `${head}\n\n${lines.join("\n")}` : head;
}
const LOG_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Ceiling on one unterminated JSONL line. Requests and responses can be large
 * (a file read, a long message), but a peer that never sends a newline would
 * otherwise grow the reader's buffer until the process dies.
 */
const MAX_LINE_BYTES = 32 * 1024 * 1024;
let logBytes = -1;
let logWriteErrors = 0;

function rpcLog(line: string): void {
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  void (async () => {
    try {
      if (logBytes < 0) {
        try {
          logBytes = statSync(LOG_PATH).size;
        } catch {
          logBytes = 0;
        }
      }
      if (logBytes > LOG_MAX_BYTES) {
        renameSync(LOG_PATH, `${LOG_PATH}.1`);
        logBytes = 0;
      }
      logBytes += Buffer.byteLength(entry);
      await appendFile(LOG_PATH, entry);
    } catch (e) {
      if (logWriteErrors++ < 3) log.warn("rpc log write failed:", errText(e));
    }
  })();
}

/** Characters that cmd.exe interprets — never let these ride along raw. */
const CMD_METACHARS = /[&|<>^()%!"\r\n]/;

/**
 * Resolve the real command behind a Windows npm shim.
 *
 * npm/nvm/pnpm generate a .cmd wrapper whose last lines do roughly:
 *   SET "_prog=<node.exe|node>"
 *   "%_prog%" "...\some-package\dist\cli.js" %*
 * Spawning that wrapper through cmd.exe makes every argument a command-injection
 * surface (Node's escaping is MSVCRT-style and does not quote `&`), so we parse
 * the shim and invoke node with the script directly.
 */
export function resolveWindowsShim(
  shimPath: string,
  args: readonly string[],
): { command: string; args: string[] } | null {
  let text: string;
  try {
    text = readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const dir = dirname(shimPath);

  // Expand %~dp0% / %dp0% and collect `SET "VAR=VALUE"` assignments.
  const vars = new Map<string, string>();
  let expanded = text.replace(/%~dp0%?|%dp0%/gi, dir);
  const setRe = /^\s*SET\s+"?([A-Za-z_][A-Za-z0-9_]*)=(.*?)"?\s*$/gim;
  for (const setMatch of expanded.matchAll(setRe)) {
    vars.set(setMatch[1].toLowerCase(), setMatch[2]);
  }
  for (let pass = 0; pass < 3; pass++) {
    expanded = expanded.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => {
      const v = vars.get(name.toLowerCase());
      return v === undefined ? whole : v;
    });
  }

  // Preferred shape: "<node>" "<script>"
  let nodeExe = "";
  let script = "";
  const pairRe = /"([^"\r\n]*?node(?:\.exe)?)"\s+"([^"\r\n]+\.(?:js|cjs|mjs))"/gi;
  for (const pair of expanded.matchAll(pairRe)) {
    nodeExe = pair[1];
    script = pair[2];
  }

  // Fallback shape (npm shims use %_prog%): last script path + resolved node
  if (!script) {
    const scriptRe = /"([^"\r\n]+\.(?:js|cjs|mjs))"/gi;
    const scripts = [...expanded.matchAll(scriptRe)].map((match) => match[1]);
    if (scripts.length) {
      script = scripts.at(-1) ?? "";
      const prog = vars.get("_prog") || vars.get("node_exe") || "";
      nodeExe = prog && isAbsolute(prog) && existsSync(prog) ? prog : "node";
    }
  }

  if (!script || !existsSync(script)) return null;
  const command =
    nodeExe && isAbsolute(nodeExe) ? (existsSync(nodeExe) ? nodeExe : "node") : "node";
  return { command, args: [script, ...args] };
}

/**
 * Windows can only run .cmd/.bat/.ps1 through a shell. Resolve the underlying
 * node script instead (safe); if that fails, only fall back to cmd.exe when no
 * argument could break out of the command line.
 */
export function resolveSpawnTarget(
  piPath: string,
  args: readonly string[],
): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command: piPath, args: [...args] };
  const lower = piPath.toLowerCase();

  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    const resolved = resolveWindowsShim(piPath, args);
    if (resolved) return resolved;
    const unsafe = args.find((a) => CMD_METACHARS.test(a));
    if (unsafe !== undefined) {
      throw new Error(
        `无法安全启动 ${piPath}：参数包含 cmd.exe 特殊字符（${JSON.stringify(unsafe)}）。` +
          `请在设置 → 常规 里把「pi 可执行文件路径」指向同目录下的 node.exe 对应的 cli.js，或安装 pi.exe。`,
      );
    }
    return { command: "cmd.exe", args: ["/d", "/s", "/c", piPath, ...args] };
  }

  if (lower.endsWith(".ps1")) {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const ps = `& ${q(piPath)}${args.length ? ` ${args.map(q).join(" ")}` : ""}`;
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
    };
  }

  return { command: piPath, args: [...args] };
}

/**
 * Kill a child process **and everything it spawned**.
 *
 * `proc.kill()` signals the process we spawned, and on Windows that is often not the process doing
 * the work: an npm shim runs through `cmd.exe` (`resolveSpawnTarget`), so killing the shell leaves
 * the `node`/`npm` grandchild running — still writing into the agent prefix, still holding the
 * files a later start-up needs. `taskkill /T` walks the tree, which is why the RPC client's own
 * teardown has always used it. Exported so the one-shot CLI runner cannot drift back to the
 * half-kill it had (see pi-cli.ts).
 *
 * Only a process that is actually alive is signalled: a recycled PID would make `/F` kill an
 * unrelated program, which is worse than leaving a zombie.
 */
export function killProcessTree(proc: {
  pid?: number;
  killed?: boolean;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  kill: (signal?: NodeJS.Signals) => boolean;
}): void {
  const pid = proc.pid;
  const alive = proc.exitCode === null && !proc.signalCode && !proc.killed;
  if (!alive || pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } catch (e) {
      log.warn("taskkill failed:", errText(e));
    }
  }
  try {
    proc.kill();
  } catch (e) {
    log.warn("kill failed:", errText(e));
  }
}

export async function createRpcClient(options: CreateRpcClientOptions): Promise<RpcClient> {
  const target = resolveSpawnTarget(options.piPath, options.args);
  rpcLog(
    `SPAWN: ${target.command} ${target.args.join(" ")}\n  piPath=${options.piPath} cwd=${options.cwd}`,
  );
  const proc: ChildProcess = spawn(target.command, target.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
    windowsHide: true,
  });

  const pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer?: NodeJS.Timeout;
    }
  >();
  let disposed = false;
  let reportedReady = false;

  const failAll = (message: string) => {
    for (const [, p] of pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pending.clear();
  };

  const attachJsonlReader = (
    stream: NodeJS.ReadableStream | null,
    onLine: (line: string) => void,
  ) => {
    if (!stream) return;
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      if (buffer.length > MAX_LINE_BYTES) {
        // Refuse rather than accumulate: the protocol is desynchronised, so
        // pending requests are failed and this stream stops being read.
        buffer = "";
        stream.removeListener("data", onData);
        failAll(
          `pi 输出的单行超过 ${Math.round(MAX_LINE_BYTES / 1024 / 1024)} MB，协议已失步，连接已中止`,
        );
        return;
      }
      while (true) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length > 0) onLine(line);
      }
    };
    stream.on("data", onData);
    stream.on("end", () => {
      buffer += decoder.end();
      if (buffer.length > 0) {
        let line = buffer;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length > 0) onLine(line);
      }
    });
  };

  attachJsonlReader(proc.stdout, (line) => {
    // First line means pi is up and its start-up work is behind it (see onReady).
    if (!reportedReady) {
      reportedReady = true;
      options.onReady?.();
    }
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const obj = msg as { type?: string };
    if (obj.type === "response") {
      const resp = obj as RpcResponse;
      const key = resp.id;
      const p = key === undefined ? undefined : pending.get(String(key));
      if (p) {
        pending.delete(String(key));
        if (p.timer) clearTimeout(p.timer);
        if (resp.success) p.resolve(resp.data);
        else p.reject(new Error(resp.error ?? `RPC command "${resp.command}" failed`));
      }
    } else if (obj.type === "extension_ui_request") {
      options.handlers.onExtensionUiRequest(obj as ExtensionUiRequest);
    } else {
      options.handlers.onEvent(obj as RpcEvent);
    }
  });

  // Keep the tail of pi's stderr: a failed start-up prints its reason here and then exits, and the
  // exit handler is the only place that can put that reason in front of a person.
  const stderrTail: string[] = [];
  attachJsonlReader(proc.stderr, (line) => {
    log.error("pi-rpc-stderr:", line);
    rpcLog(`STDERR: ${line}`);
    const text = String(line ?? "").trim();
    if (!text) return;
    stderrTail.push(text.slice(0, STDERR_TAIL_CHARS));
    if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
  });

  proc.on("error", (err) => {
    rpcLog(`SPAWN ERROR: ${err.message}`);
    options.handlers.onError(err);
    failAll(err.message);
  });
  // A write to a pi that has just died raises EPIPE on the pipe itself, not on the process — an
  // unhandled 'error' there is an uncaught exception in the main process. The request that was being
  // written fails through the exit handler below, which is where the reason for it lives.
  proc.stdin?.on("error", (err) => {
    rpcLog(`STDIN ERROR: ${err.message}`);
  });
  proc.on("exit", (code, signal) => {
    rpcLog(`EXIT: code=${code} signal=${signal}`);
    // Nothing can be written to it any more; say so before failing what was in flight.
    try {
      proc.stdin?.destroy();
    } catch {
      /* already gone */
    }
    // The handler runs first, and synchronously: a start-up that died before it was ready is
    // decided there (retry, or say why), and it has to have decided before the requests in flight
    // are failed — those failures are what a person sees, and a start-up that is already being
    // retried should not paint an error about itself on the way out.
    options.handlers.onExit(code, signal, stderrTail.slice());
    failAll("Pi RPC process exited");
  });

  const send = (command: Record<string, unknown>): void => {
    if (disposed || !proc.stdin || proc.stdin.destroyed)
      throw new Error("Pi RPC process is not running");
    proc.stdin.write(`${JSON.stringify(command)}\n`);
  };

  const DEFAULT_TIMEOUT_MS = 120_000;
  const TIMEOUT_BY_TYPE: Record<string, number> = {
    prompt: 0, // streaming: completion is signalled by events, not by this response
    compact: 1_800_000,
  };

  const request = <T>(command: Record<string, unknown>): Promise<T> => {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const type = String(command.type ?? "command");
      const timeoutMs = TIMEOUT_BY_TYPE[type] ?? DEFAULT_TIMEOUT_MS;
      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`RPC "${type}" 超时（${Math.round(timeoutMs / 1000)}s 无响应）`));
        }, timeoutMs);
        timer.unref?.();
      }
      pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      try {
        send({ ...command, id });
      } catch (e) {
        pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  };

  return {
    send,
    request,
    prompt: (message, streamingBehavior, images) =>
      request<void>({
        type: "prompt",
        message,
        ...(streamingBehavior ? { streamingBehavior } : {}),
        ...(images?.length ? { images } : {}),
      }),
    abort: () => request<void>({ type: "abort" }),
    clearQueue: () => request({ type: "clear_queue" }),
    setModel: (provider, modelId) => request<RpcModel>({ type: "set_model", provider, modelId }),
    setThinkingLevel: (level) => request<void>({ type: "set_thinking_level", level }),
    getAvailableModels: () =>
      request<{ models: RpcModel[] }>({ type: "get_available_models" }).then((d) => d.models),
    getAvailableThinkingLevels: () =>
      request<{ levels: string[] }>({
        type: "get_available_thinking_levels",
      }).then((d) => d.levels),
    getCommands: () =>
      request<{ commands: RpcCommand[] }>({ type: "get_commands" }).then((d) => d.commands),
    getMessages: () =>
      request<{ messages: unknown[] }>({ type: "get_messages" }).then((d) => d.messages),
    getState: () => request<RpcState>({ type: "get_state" }),
    getSessionStatsFull: () => request<RpcSessionStats>({ type: "get_session_stats" }),
    compact: (ci) =>
      request(ci ? { type: "compact", customInstructions: ci } : { type: "compact" }),
    setAutoCompaction: (enabled) => request<void>({ type: "set_auto_compaction", enabled }),
    setSessionName: (name) => request<void>({ type: "set_session_name", name }),
    newSession: () => request({ type: "new_session" }),
    switchSession: (sessionPath) => request({ type: "switch_session", sessionPath }),
    getEntries: () => request({ type: "get_entries" }),
    fork: (entryId) => request({ type: "fork", entryId }),
    respondExtensionUi: (id, payload) => {
      const resp: Record<string, unknown> = {
        type: "extension_ui_response",
        id,
      };
      if (payload.cancelled) resp.cancelled = true;
      else if (payload.confirmed !== undefined) resp.confirmed = !!payload.confirmed;
      else if (payload.value === undefined) resp.cancelled = true;
      else resp.value = payload.value;
      try {
        send(resp);
      } catch (e) {
        log.warn("failed to answer extension UI request:", errText(e));
      }
    },
    dispose: () => {
      if (disposed) return Promise.resolve();
      disposed = true;
      failAll("Pi RPC client disposed");
      killProcessTree(proc);
      return Promise.resolve();
    },
  };
}
