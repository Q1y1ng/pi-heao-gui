import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge for pi-standalone.
 * Exposes window.pi with:
 * - postMessage(msg): renderer -> main (maps msg.type to IPC channel)
 * - onMessage(fn): main -> renderer (single listener, receives all messages)
 * - invoke(channel, ...args): direct IPC invoke for non-chat operations
 */

// Renderer -> main: map message type to IPC channel
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

// Main -> renderer channels that should be forwarded as MessageEvents
const forwardChannels = [
  "pi:state", "pi:models", "pi:enabled-models", "pi:thinking-levels",
  "pi:commands", "pi:messages", "pi:event", "pi:dialog", "pi:picked-resources",
  "pi:context-usage", "pi:widget", "pi:toast", "pi:info-panel", "pi:btw-abort-ready",
  "pi:error", "pi:prefill-input", "pi:append-input", "pi:session-info",
  "pi:permission-mode", "pi:files", "pi:sessions-list", "pi:streaming",
  "pi:token-stats", "pi:token-metrics", "pi:first-token",
];

let messageListener: ((msg: unknown) => void) | null = null;

// Set up forwarding: all main->renderer messages go to the single listener
for (const ch of forwardChannels) {
  ipcRenderer.on(ch, (_e, data) => {
    if (messageListener) messageListener(data);
  });
}

contextBridge.exposeInMainWorld("pi", {
  postMessage(msg: { type: string; [k: string]: unknown }) {
    const channel = typeToChannel[msg.type];
    if (channel) {
      ipcRenderer.invoke(channel, msg);
    } else {
      console.warn("[pi-preload] unknown message type:", msg.type);
    }
  },
  onMessage(fn: (msg: unknown) => void) {
    messageListener = fn;
  },
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return ipcRenderer.invoke(channel, ...args);
  },
});
