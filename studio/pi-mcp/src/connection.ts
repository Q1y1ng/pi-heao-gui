import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { loadMergedConfig, loadMergedServers } from "./config.ts";
import { buildCacheEntry, loadMetadataCache, saveMetadataCache } from "./metadata-cache.ts";
import type {
  DiscoveredServer,
  McpConfig,
  McpConnection,
  MetadataCache,
  ServerEntry,
} from "./types.ts";

const CONNECT_TIMEOUT_MS = 30_000;

/**
 * How long one request may take before it is reported as hung.
 *
 * Only the connect used to be bounded: a server that accepted the connection and then stopped
 * answering left `callTool` unsettled forever — and that is the agent's turn, because the tool
 * never returns, so the turn never ends. A long server operation can legitimately take a while, so
 * this is generous.
 */
const CALL_TIMEOUT_MS = 120_000;

function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  if (extra) for (const [k, v] of Object.entries(extra)) env[k] = v;
  return env;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class McpSession {
  readonly cwd: string;
  readonly config: McpConfig;
  readonly metadataCache: MetadataCache | null;
  private connections = new Map<string, McpConnection>();
  private connectPromises = new Map<string, Promise<McpConnection>>();
  /** Servers this session refuses to start (see block()). */
  private blocked = new Set<string>();

  constructor(cwd: string) {
    this.cwd = cwd;
    this.config = loadMergedConfig(cwd);
    const mergedServers = loadMergedServers(cwd);
    const enabledNames = new Set(mergedServers.filter((s) => !s.entry.disabled).map((s) => s.name));
    this.metadataCache = loadMetadataCache(enabledNames);
    for (const { name, entry, source } of mergedServers) {
      this.connections.set(name, {
        name,
        entry,
        source,
        client: null,
        state: "disconnected",
      });
    }
  }

  serverNames(): string[] {
    return [...this.connections.keys()];
  }

  /** Enabled servers that came from the project's own `.pi/mcp.json`. */
  projectServerNames(): string[] {
    return [...this.connections.values()]
      .filter((c) => c.source === "project" && !c.entry.disabled && !this.blocked.has(c.name))
      .map((c) => c.name);
  }

  /**
   * Refuse a server for the rest of this session.
   *
   * Remembered rather than merely skipped at start-up: the proxy tools connect on demand, so a
   * server that was not trusted would otherwise come online the first time the model asked for one
   * of its tools.
   */
  block(name: string, reason: string): void {
    const conn = this.connections.get(name);
    if (!conn) return;
    this.blocked.add(name);
    conn.state = "error";
    conn.error = reason;
  }

  /** Names of servers that are enabled in config (not disabled). */
  enabledNames(): string[] {
    return [...this.connections.values()].filter((c) => !c.entry.disabled).map((c) => c.name);
  }

  getConnection(name: string): McpConnection | undefined {
    return this.connections.get(name);
  }

  /** All configured connections (regardless of state). */
  allConnections(): McpConnection[] {
    return [...this.connections.values()];
  }

  touch(name: string): void {
    const conn = this.connections.get(name);
    if (conn) conn.lastUsedAt = Date.now();
  }

  incrementInFlight(name: string): void {
    const conn = this.connections.get(name);
    if (conn) conn.inFlight = (conn.inFlight ?? 0) + 1;
  }

  decrementInFlight(name: string): void {
    const conn = this.connections.get(name);
    if (conn) conn.inFlight = Math.max(0, (conn.inFlight ?? 0) - 1);
  }

  /** Close the transport but keep `discovered` in memory for search. */
  async idleDisconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn || conn.state !== "connected") return;
    if ((conn.inFlight ?? 0) > 0) return;
    const client = conn.client;
    conn.client = null;
    conn.state = "idle";
    if (client) await client.close().catch(() => {});
  }

  status(): Array<{
    name: string;
    state: string;
    source: "user" | "project";
    disabled: boolean;
    error?: string;
    tools: number;
    resources: number;
    prompts: number;
  }> {
    return [...this.connections.values()].map((c) => ({
      name: c.name,
      state: c.state,
      source: c.source,
      disabled: !!c.entry.disabled,
      error: c.error,
      tools: c.discovered?.tools.length ?? 0,
      resources: c.discovered?.resources.length ?? 0,
      prompts: c.discovered?.prompts.length ?? 0,
    }));
  }

  /**
   * Kick off (non-blocking) connection of all enabled servers.
   * Calls onReady per server as it comes online, onError on failure.
   */
  init(
    onReady: (name: string, conn: McpConnection) => void,
    onError: (name: string, error: string) => void,
  ): void {
    for (const name of this.enabledNames()) {
      void this.ensureConnected(name)
        .then((conn) => onReady(name, conn))
        .catch((err) => onError(name, err instanceof Error ? err.message : String(err)));
    }
  }

  /** Connect a server (idempotent; dedups concurrent attempts). */
  async ensureConnected(name: string): Promise<McpConnection> {
    const existing = this.connections.get(name);
    if (!existing) throw new Error(`MCP server "${name}" is not configured`);
    if (this.blocked.has(name)) {
      throw new Error(existing.error || `MCP server "${name}" is not trusted in this session`);
    }
    if (existing.state === "connected" && existing.client && existing.discovered) return existing;

    const pending = this.connectPromises.get(name);
    if (pending) return pending;

    const promise = this.connectServer(name).catch((err) => {
      this.connectPromises.delete(name);
      throw err;
    });
    this.connectPromises.set(name, promise);
    return promise;
  }

  private async connectServer(name: string): Promise<McpConnection> {
    const conn = this.connections.get(name)!;
    conn.state = "connecting";
    conn.error = undefined;

    const client = new Client({ name: `pi-mcp-${name}`, version: "1.0.0" }, { capabilities: {} });
    let transport;
    try {
      transport = await this.createTransport(conn.entry, name);
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, name);
    } catch (err) {
      await client.close().catch(() => {});
      conn.state = "error";
      conn.error = err instanceof Error ? err.message : String(err);
      this.connectPromises.delete(name);
      throw err;
    }

    const discovered = await this.discover(client).catch((err) => {
      void client.close().catch(() => {});
      conn.state = "error";
      conn.error = err instanceof Error ? err.message : String(err);
      this.connectPromises.delete(name);
      throw err;
    });

    conn.client = client;
    conn.discovered = discovered;
    conn.state = "connected";
    conn.lastUsedAt = Date.now();
    this.connectPromises.delete(name);
    try {
      saveMetadataCache(name, buildCacheEntry(conn.entry, discovered));
    } catch {
      // cache write failure is non-fatal
    }
    return conn;
  }

  private async createTransport(entry: ServerEntry, name: string) {
    if (entry.command) {
      return new StdioClientTransport({
        command: entry.command,
        args: entry.args ?? [],
        env: buildEnv(entry.env),
        cwd: entry.cwd ?? this.cwd,
        stderr: "pipe",
      });
    }
    if (entry.url) {
      return this.createHttpTransport(entry, name);
    }
    throw new Error(`MCP server "${name}" must configure either "command" or "url"`);
  }

  private async createHttpTransport(entry: ServerEntry, name: string) {
    let url: URL;
    try {
      url = new URL(entry.url!);
    } catch {
      // The URL comes from a JSON file the user (or a cloned repository) wrote; say which server
      // and what the value was instead of letting a bare TypeError out of the constructor.
      throw new Error(`MCP server "${name}": url is not a valid URL: ${entry.url}`);
    }
    const headers: Record<string, string> = { ...entry.headers };
    if (entry.bearerToken) headers["Authorization"] = `Bearer ${entry.bearerToken}`;
    const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;

    const probeClient = new Client({ name: `pi-mcp-probe-${name}`, version: "1.0.0" });
    const probeTransport = new StreamableHTTPClientTransport(url, { requestInit });
    try {
      await probeClient.connect(probeTransport);
      await probeClient.close();
      return new StreamableHTTPClientTransport(url, { requestInit });
    } catch {
      await probeClient.close().catch(() => {});
      return new SSEClientTransport(url, { requestInit });
    }
  }

  private async discover(client: Client): Promise<DiscoveredServer> {
    const capabilities = client.getServerCapabilities?.();
    const tools = await this.paginate(
      (cur) => client.listTools(cur ? { cursor: cur } : undefined),
      (r) => r.tools ?? [],
    );
    const resources = capabilities?.resources
      ? await this.paginate(
          (cur) => client.listResources(cur ? { cursor: cur } : undefined),
          (r) => r.resources ?? [],
        ).catch(() => [])
      : [];
    const prompts = capabilities?.prompts
      ? await this.paginate(
          (cur) => client.listPrompts(cur ? { cursor: cur } : undefined),
          (r) => r.prompts ?? [],
        ).catch(() => [])
      : [];
    let instructions: string | undefined;
    try {
      instructions = client.getInstructions?.();
    } catch {
      instructions = undefined;
    }
    return { tools, resources, prompts, instructions };
  }

  private async paginate<R extends { nextCursor?: string }, T>(
    fetch: (cursor: string | undefined) => Promise<R>,
    extract: (r: R) => T[],
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | undefined;
    do {
      const r = await fetch(cursor);
      all.push(...extract(r));
      cursor = r.nextCursor;
    } while (cursor);
    return all;
  }

  async callTool(
    name: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const conn = await this.ensureConnected(name);
    this.touch(name);
    this.incrementInFlight(name);
    try {
      // SAFETY: the SDK's CallToolResult and the one this extension imports describe the same wire
      // shape (same SDK version, re-exported through pi); the assertion is only needed because the
      // two `content` unions are declared in different modules.
      const result = (await withTimeout(
        conn.client!.callTool({
          name: toolName,
          arguments: args,
        }),
        CALL_TIMEOUT_MS,
        `${name}.${toolName}`,
      )) as unknown as CallToolResult;
      return result;
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }

  async listResources(name: string) {
    const conn = await this.ensureConnected(name);
    this.touch(name);
    return conn.discovered?.resources ?? [];
  }

  async readResource(name: string, uri: string): Promise<ReadResourceResult> {
    const conn = await this.ensureConnected(name);
    this.touch(name);
    this.incrementInFlight(name);
    try {
      return await withTimeout(conn.client!.readResource({ uri }), CALL_TIMEOUT_MS, `${name}!read`);
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }

  async getPrompt(
    name: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<GetPromptResult> {
    const conn = await this.ensureConnected(name);
    this.touch(name);
    this.incrementInFlight(name);
    try {
      return await withTimeout(
        conn.client!.getPrompt({ name: promptName, arguments: args }),
        CALL_TIMEOUT_MS,
        `${name}!prompt`,
      );
    } finally {
      this.decrementInFlight(name);
      this.touch(name);
    }
  }

  async reconnect(name: string): Promise<McpConnection> {
    await this.disconnect(name);
    return this.ensureConnected(name);
  }

  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;
    const client = conn.client;
    conn.client = null;
    conn.discovered = undefined;
    conn.state = "disconnected";
    conn.error = undefined;
    if (client) await client.close().catch(() => {});
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((n) => this.disconnect(n)));
  }
}
