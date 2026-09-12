/**
 * RPC client for `pi --mode rpc` subprocess.
 * Ported from upstream src/chat/rpc-client.ts — pure Node, no VS Code deps.
 */
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { join } from "path";
import { randomUUID } from "crypto";
import { StringDecoder } from "string_decoder";

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
  tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
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

export interface RpcEvent { type: string; [k: string]: unknown; }

export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method: "select" | "confirm" | "input" | "editor" | "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text";
  [k: string]: unknown;
}

export interface RpcClient {
  send(command: Record<string, unknown>): void;
  request<T = unknown>(command: Record<string, unknown>): Promise<T>;
  prompt(message: string, streamingBehavior?: "steer" | "followUp", images?: RpcImage[]): Promise<void>;
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
  getEntries(): Promise<{ entries: Array<{ type: string; id: string; parentId?: string | null; timestamp?: number; message?: { role?: string; timestamp?: number; content?: unknown } & Record<string, unknown> }>; leafId: string | null }>;
  fork(entryId: string): Promise<{ text: string; cancelled: boolean }>;
  respondExtensionUi(id: string, payload: { value?: string; confirmed?: boolean; cancelled?: boolean }): void;
  dispose(): Promise<void>;
}

// ─── Implementation ───────────────────────────────────────────────────

export interface RpcClientHandlers {
  onEvent: (event: RpcEvent) => void;
  onExtensionUiRequest: (request: ExtensionUiRequest) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError: (err: Error) => void;
}

export interface CreateRpcClientOptions {
  piPath: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  handlers: RpcClientHandlers;
}

/** Windows: pi.cmd needs to go through cmd.exe */
function normalizeSpawnTarget(piPath: string, args: readonly string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command: piPath, args: [...args] };
  const lower = piPath.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", piPath, ...args] };
  }
  if (lower.endsWith(".ps1")) {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const ps = `& ${q(piPath)}` + (args.length ? " " + args.map(q).join(" ") : "");
    return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps] };
  }
  return { command: piPath, args: [...args] };
}

export async function createRpcClient(options: CreateRpcClientOptions): Promise<RpcClient> {
  const target = normalizeSpawnTarget(options.piPath, options.args);
  try {
    const logPath = join(require("os").tmpdir(), "pi-standalone-rpc.log");
    require("fs").appendFileSync(logPath, `[${new Date().toISOString()}] SPAWN: ${target.command} ${target.args.join(" ")}\n  piPath=${options.piPath} cwd=${options.cwd}\n`);
  } catch {}
  const proc: ChildProcess = spawn(target.command, target.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
    windowsHide: true,
  });

  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let disposed = false;

  const failAll = (message: string) => {
    for (const [, p] of pending) p.reject(new Error(message));
    pending.clear();
  };

  const attachJsonlReader = (stream: NodeJS.ReadableStream | null, onLine: (line: string) => void) => {
    if (!stream) return;
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      while (true) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.length > 0) onLine(line);
      }
    });
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
    let msg: unknown;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    const obj = msg as { type?: string };
    if (obj.type === "response") {
      const resp = obj as RpcResponse;
      const key = resp.id;
      const p = key !== undefined ? pending.get(String(key)) : undefined;
      if (p) {
        pending.delete(String(key));
        if (resp.success) p.resolve(resp.data);
        else p.reject(new Error(resp.error ?? `RPC command "${resp.command}" failed`));
      }
    } else if (obj.type === "extension_ui_request") {
      options.handlers.onExtensionUiRequest(obj as ExtensionUiRequest);
    } else {
      options.handlers.onEvent(obj as RpcEvent);
    }
  });

  attachJsonlReader(proc.stderr, (line) => {
    console.error("[pi-rpc-stderr]", line);
    try {
      const logPath = join(require("os").tmpdir(), "pi-standalone-rpc.log");
      require("fs").appendFileSync(logPath, `[${new Date().toISOString()}] STDERR: ${line}\n`);
    } catch {}
  });

  proc.on("error", (err) => {
    try {
      const logPath = join(require("os").tmpdir(), "pi-standalone-rpc.log");
      require("fs").appendFileSync(logPath, `[${new Date().toISOString()}] SPAWN ERROR: ${err.message}\n`);
    } catch {}
    options.handlers.onError(err);
    failAll(err.message);
  });
  proc.on("exit", (code, signal) => {
    try {
      const logPath = join(require("os").tmpdir(), "pi-standalone-rpc.log");
      require("fs").appendFileSync(logPath, `[${new Date().toISOString()}] EXIT: code=${code} signal=${signal}\n`);
    } catch {}
    failAll("Pi RPC process exited");
    options.handlers.onExit(code, signal);
  });

  const send = (command: Record<string, unknown>): void => {
    if (disposed || !proc.stdin || proc.stdin.destroyed) throw new Error("Pi RPC process is not running");
    proc.stdin.write(JSON.stringify(command) + "\n");
  };

  const request = <T>(command: Record<string, unknown>): Promise<T> => {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: (v) => resolve(v as T), reject });
      try { send({ ...command, id }); }
      catch (e) { pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  };

  return {
    send,
    request,
    prompt: (message, streamingBehavior, images) =>
      request<void>({ type: "prompt", message, ...(streamingBehavior ? { streamingBehavior } : {}), ...(images?.length ? { images } : {}) }),
    abort: () => request<void>({ type: "abort" }),
    clearQueue: () => request({ type: "clear_queue" }),
    setModel: (provider, modelId) => request<RpcModel>({ type: "set_model", provider, modelId }),
    setThinkingLevel: (level) => request<void>({ type: "set_thinking_level", level }),
    getAvailableModels: () => request<{ models: RpcModel[] }>({ type: "get_available_models" }).then(d => d.models),
    getAvailableThinkingLevels: () => request<{ levels: string[] }>({ type: "get_available_thinking_levels" }).then(d => d.levels),
    getCommands: () => request<{ commands: RpcCommand[] }>({ type: "get_commands" }).then(d => d.commands),
    getMessages: () => request<{ messages: unknown[] }>({ type: "get_messages" }).then(d => d.messages),
    getState: () => request<RpcState>({ type: "get_state" }),
    getSessionStatsFull: () => request<RpcSessionStats>({ type: "get_session_stats" }),
    compact: (ci) => request(ci ? { type: "compact", customInstructions: ci } : { type: "compact" }),
    setAutoCompaction: (enabled) => request<void>({ type: "set_auto_compaction", enabled }),
    setSessionName: (name) => request<void>({ type: "set_session_name", name }),
    newSession: () => request({ type: "new_session" }),
    switchSession: (sessionPath) => request({ type: "switch_session", sessionPath }),
    getEntries: () => request({ type: "get_entries" }),
    fork: (entryId) => request({ type: "fork", entryId }),
    respondExtensionUi: (id, payload) => {
      const resp: Record<string, unknown> = { type: "extension_ui_response", id };
      if (payload.cancelled) resp.cancelled = true;
      else if (payload.confirmed !== undefined) resp.confirmed = !!payload.confirmed;
      else if (payload.value !== undefined) resp.value = payload.value;
      else resp.cancelled = true;
      try { send(resp); } catch {}
    },
    dispose: () => {
      if (disposed) return Promise.resolve();
      disposed = true;
      failAll("Pi RPC client disposed");
      if (proc.pid !== undefined && !proc.killed) {
        if (process.platform === "win32") {
          try { spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true }); } catch {}
        }
        try { proc.kill(); } catch {}
      }
      return Promise.resolve();
    },
  };
}
