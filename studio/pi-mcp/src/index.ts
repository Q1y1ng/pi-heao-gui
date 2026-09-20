import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { McpSession } from "./connection.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getProjectMcpPath } from "./config.ts";
import type { McpConnection } from "./types.ts";
import { registerMcpCommand } from "./commands.ts";
import { registerServerPrompts } from "./prompts.ts";
import { registerDirectToolsFromCache, registerServerTools } from "./tools.ts";
import { registerProxyTools } from "./proxy-tools.ts";
import { startIdleManager, stopIdleManager } from "./idle.ts";

/**
 * Where a project's trust decision is remembered, and how long the question waits.
 *
 * A project's `.pi/mcp.json` is a *command line*: every server in it is started with this user's
 * privileges the moment a session opens in that directory. pi's own project-trust gate covers
 * `settings.json`, `extensions`, `skills`, `prompts`, `themes` and the system-prompt files — but
 * **not** `mcp.json` — so opening a cloned repository used to be enough to run whatever that file
 * asked for, with no question. The decision is remembered per directory and keyed by the file's
 * hash, so editing (or pulling) the file asks again.
 */
const TRUST_FILE_NAME = "mcp-project-trust.json";
const TRUST_PROMPT_TIMEOUT_MS = 120_000;

function trustFilePath(): string {
  return join(getAgentDir(), TRUST_FILE_NAME);
}

function trustKey(cwd: string): string {
  const resolved = resolve(cwd);
  // Windows paths are case-insensitive, and `E:\\AI\\Repo` and `e:\\ai\\repo` are one directory.
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function projectMcpHash(cwd: string): string {
  try {
    return createHash("sha256").update(readFileSync(getProjectMcpPath(cwd))).digest("hex");
  } catch {
    return "";
  }
}

function readTrustStore(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(trustFilePath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function rememberTrust(cwd: string, hash: string): void {
  const store = readTrustStore();
  store[trustKey(cwd)] = hash;
  const path = trustFilePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    // Temp + rename: a half-written trust file would silently forget every decision in it.
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
  } catch {
    // Not fatal: the servers are trusted for this session either way, it just asks again next time.
  }
}

/** The user's answer, or undefined when nobody answered in time (which means "no"). */
async function askProjectTrust(
  ctx: ExtensionContext,
  cwd: string,
  names: string[],
): Promise<string | undefined> {
  const title =
    `此项目的 .pi/mcp.json 想启动 ${names.length} 个 MCP 服务器（以你的权限执行）：\n\n` +
    names.map((n) => `  · ${n}`).join("\n") +
    `\n\n目录：${cwd}\n信任后 pi 会在每次打开这个项目时自动启动它们；文件改变会重新询问。`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      ctx.ui.select(title, ["信任并记住", "本次信任", "不信任"]),
      new Promise<undefined>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(undefined), TRUST_PROMPT_TIMEOUT_MS);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
    return answer === undefined ? undefined : String(answer);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ask before a project's own MCP servers run, then connect everything that is allowed.
 *
 * Deliberately not awaited by the `session_start` handler: the question travels over the session's
 * UI channel, and pi does not read that channel until its start-up work is behind it — awaiting it
 * here would be a start-up waiting on an answer that cannot be read yet.
 */
async function trustThenInit(
  session: McpSession,
  ctx: ExtensionContext,
  ensureServerRegistered: (conn: McpConnection) => void,
): Promise<void> {
  const projectServers = session.projectServerNames();
  if (projectServers.length > 0) {
    const hash = projectMcpHash(session.cwd);
    const remembered = hash ? readTrustStore()[trustKey(session.cwd)] : undefined;
    if (!hash || remembered !== hash) {
      const answer = await askProjectTrust(ctx, session.cwd, projectServers);
      if (answer === "信任并记住") rememberTrust(session.cwd, hash);
      if (answer !== "信任并记住" && answer !== "本次信任") {
        for (const name of projectServers) {
          session.block(
            name,
            `项目级 MCP 服务器未获信任（${getProjectMcpPath(session.cwd)}）`,
          );
        }
        ctx.ui.notify(
          answer === undefined
            ? `未在 ${Math.round(TRUST_PROMPT_TIMEOUT_MS / 1000)} 秒内回答，本次不加载项目级 MCP 服务器：${projectServers.join("、")}`
            : `已跳过项目级 MCP 服务器：${projectServers.join("、")}`,
          "warning",
        );
      }
    }
  }

  if (session.serverNames().length > 0) {
    session.init(
      (name, conn) => {
        ensureServerRegistered(conn);
        const tools = conn.discovered?.tools.length ?? 0;
        ctx.ui.notify(`MCP ${name}: connected (${tools} tools)`, "info");
      },
      (name, error) => {
        ctx.ui.notify(`MCP ${name}: failed to connect - ${error}`, "warning");
      },
    );
  }
  startIdleManager(session);
}

/** pi 0.83+ runtime API (not yet in type defs). */
type UnregisterApi = { unregisterTool?: (name: string) => void };

let currentSession: McpSession | null = null;
const registeredServers = new Set<string>();
let commandRegistered = false;

export default function (pi: ExtensionAPI) {
  const getSession = () => currentSession;

  function ensureServerRegistered(conn: McpConnection): void {
    // Hot-update pinned direct tools from the live discovery (unregisters the
    // cache-registered set first). Servers without directTools register none.
    registerServerTools(pi, getSession, conn);
    if (!registeredServers.has(conn.name)) {
      registerServerPrompts(pi, getSession, conn);
      registeredServers.add(conn.name);
    }
  }

  if (!commandRegistered) {
    registerMcpCommand(pi, getSession, ensureServerRegistered);
    commandRegistered = true;
  }

  pi.on("session_start", async (_event, ctx) => {
    await cleanupSession(pi);
    const session = new McpSession(ctx.cwd);
    currentSession = session;

    // Register the two proxy tools once (module-level dedup inside).
    registerProxyTools(pi, getSession);

    // Register pinned direct tools from disk cache, before any connection.
    registerDirectToolsFromCache(pi, getSession, session);

    // Not awaited: it may ask the person a question, and the answer arrives over a channel pi only
    // reads once start-up is finished (see trustThenInit).
    void trustThenInit(session, ctx, ensureServerRegistered);
  });

  pi.on("session_shutdown", async () => {
    stopIdleManager();
    await cleanupSession(pi);
    currentSession = null;
  });
}

/** Unregister a session's direct tools (avoid orphans across session switches) and disconnect. */
function cleanupSession(pi: ExtensionAPI): Promise<void> {
  const session = currentSession;
  if (!session) return Promise.resolve();
  const api = pi as ExtensionAPI & UnregisterApi;
  for (const conn of session.allConnections()) {
    for (const name of conn.registeredToolNames ?? []) {
      api.unregisterTool?.(name);
    }
  }
  return session.disconnectAll();
}
