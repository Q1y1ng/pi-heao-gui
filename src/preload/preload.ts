import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge for pi-standalone (CHAT window).
 * Exposes window.pi with:
 * - postMessage(msg): renderer -> main (maps msg.type to IPC channel)
 * - onMessage(fn): main -> renderer (single listener, receives all messages)
 * - invoke(channel, ...args): direct IPC invoke, restricted to INVOKE_ALLOWED
 * - getPathForFile(file): Electron >=32 dropped File.path; use webUtils instead
 *
 * SECURITY: this preload is loaded into the window that renders untrusted
 * agent/tool output. It must never expose the settings-only channels
 * (pi:read-agent-files / pi:write-agent-files / pi:set-config / pi:get-config).
 * Those live in preload-settings.ts.
 */

// Renderer -> main: message types allowed over postMessage
const typeToChannel: Record<string, string> = {
  webviewReady: "pi:webview-ready",
  prompt: "pi:prompt",
  abort: "pi:abort",
  clearQueue: "pi:clear-queue",
  pickResource: "pi:pick-resource",
  setModel: "pi:set-model",
  setThinking: "pi:set-thinking",
  setSessionName: "pi:set-session-name",
  newSession: "pi:new-session",
  switchSession: "pi:switch-session",
  dialogResponse: "pi:dialog-response",
  copy: "pi:copy",
  openFile: "pi:open-file",
  searchFiles: "pi:search-files",
  appendInput: "pi:append-input",
  fork: "pi:fork",
  revert: "pi:revert",
  reload: "pi:reload",
  todoClear: "pi:todo-clear",
  mcpOpen: "pi:mcp-open",
  mcpAction: "pi:mcp-action",
  setPermission: "pi:set-permission",
  btwAbort: "pi:btw-abort",
  rewindAccept: "pi:rewind-accept",
  rewindAcceptFile: "pi:rewind-accept-file",
  rewindRevert: "pi:rewind-revert",
  rewindRevertFile: "pi:rewind-revert-file",
  rewindDiff: "pi:rewind-diff",
  toggleFavorite: "pi:toggle-favorite",
  openSettings: "pi:open-settings",
  listSessions: "pi:list-sessions",
};

/**
 * Channels the chat renderer may call through window.pi.invoke().
 * Everything else is rejected — no settings/auth/config access from here.
 */
const INVOKE_ALLOWED = new Set<string>([
  "pi:copy",
  "pi:open-file",
  "pi:pick-resource",
  "pi:search-files",
  "pi:worktree-list",
  "pi:worktree-use",
  "pi:append-input",
  "pi:rewind-diff",
  "pi:open-settings",
  "pi:list-sessions",
  "pi:switch-session",
  "pi:toggle-pin",
  "pi:open-session-window",
  "pi:pick-workspace",
  "pi:set-workspace",
  "pi:export-conversation",
  "pi:session-op",
  "pi:list-archived",
  "pi:search-sessions",
  "pi:get-stats",
  "pi:get-commands",
  "pi:show-diff",
  "pi:diagnostics",
  "pi:set-theme",
  "pi:term-open",
  "pi:term-input",
  "pi:term-resize",
  "pi:term-close",
  "pi:fs-tree",
  "pi:fs-read",
  "pi:fs-write",
  "pi:git-info",
  "pi:git-commit-message",
]);

// Main -> renderer channels that should be forwarded as MessageEvents
const forwardChannels = [
  "pi:state",
  "pi:models",
  "pi:enabled-models",
  "pi:thinking-levels",
  "pi:commands",
  "pi:messages",
  "pi:event",
  "pi:dialog",
  "pi:picked-resources",
  "pi:context-usage",
  "pi:widget",
  "pi:toast",
  "pi:info-panel",
  "pi:btw-abort-ready",
  "pi:error",
  "pi:prefill-input",
  "pi:append-input",
  "pi:session-info",
  "pi:permission-mode",
  "pi:files",
  "pi:sessions-list",
  "pi:streaming",
  "pi:token-stats",
  "pi:token-metrics",
  "pi:first-token",
  "pi:live-stats",
  "pi:turn-stats",
  "pi:stats",
  "pi:mcp-status",
  "pi:theme",
  "pi:search-progress",
  "pi:term-data",
  "pi:term-exit",
];

let messageListener: ((msg: unknown) => void) | null = null;
let termDataListener: ((msg: { data?: string }) => void) | null = null;
let termExitListener: ((msg: { code?: number }) => void) | null = null;
let loginRequestListener: ((msg: { provider?: string }) => void) | null = null;

// The dock re-initialises on every terminal restart, and `ipcRenderer.on`
// appends. Storing the handler and registering the channel once avoids stacking
// a fresh listener per restart for the life of the window.
ipcRenderer.on("pi:term-data", (_e, data) => termDataListener?.(data));
ipcRenderer.on("pi:term-exit", (_e, data) => termExitListener?.(data));
ipcRenderer.on("pi:login-request", (_e, data) => loginRequestListener?.(data));

// Set up forwarding: all main->renderer messages go to the single listener
for (const ch of forwardChannels) {
  ipcRenderer.on(ch, (_e, data) => {
    if (messageListener) messageListener(data);
  });
}

/** Electron >= 32 removed File.path; the only supported way is webUtils in preload. */
function getPathForFile(file: unknown): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webUtils } = require("electron");
    if (webUtils && typeof webUtils.getPathForFile === "function") {
      const p = webUtils.getPathForFile(file as File);
      if (p) return p;
    }
  } catch {
    /* webUtils unavailable — fall through */
  }
  const legacy = (file as { path?: string } | null)?.path;
  return typeof legacy === "string" ? legacy : "";
}

contextBridge.exposeInMainWorld("pi", {
  postMessage(msg: { type: string; [k: string]: unknown }) {
    const channel = typeToChannel[msg?.type];
    if (channel) {
      ipcRenderer.invoke(channel, msg);
    } else {
      console.warn("[pi-preload] unknown message type:", msg?.type);
    }
  },
  onMessage(fn: (msg: unknown) => void) {
    messageListener = fn;
  },
  /**
   * Terminal stream, kept on its own channel: pi-chat owns the single
   * onMessage listener, so the dock cannot share it. This extra registration is
   * additive and invisible to upstream code.
   */
  onTermData(fn: (msg: { data?: string }) => void) {
    termDataListener = fn;
  },
  onTermExit(fn: (msg: { code?: number }) => void) {
    termExitListener = fn;
  },
  /** Settings asks the chat window to start a provider login in its terminal. */
  onLoginRequest(fn: (msg: { provider?: string }) => void) {
    loginRequestListener = fn;
  },
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!INVOKE_ALLOWED.has(channel)) {
      console.error("[pi-preload] blocked channel:", channel);
      return Promise.reject(new Error(`blocked channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  getPathForFile,
});
