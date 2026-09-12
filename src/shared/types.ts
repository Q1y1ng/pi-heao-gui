/** Shared types between main, preload, and renderer. */

export interface StandaloneConfig {
  piPath: string;
  language: "auto" | "en" | "zh-cn";
  env: Record<string, string>;
  args: string[];
  disabledTools: string[];
  permissionMode: "AskForApproval" | "FullAccess";
  dangerousPatterns: string[];
  mcpEnabled: boolean;
  mcpIdleTimeout: number;
  chatFontSize: number;
  chatSendShortcut: "enter" | "ctrlEnter";
  chatMermaidTheme: string;
  chatBackgroundImage: string;
  chatBackgroundOpacity: number;
  rpcTrace: boolean;
  workspaceRoot: string;
  pinnedSessions: string[];
}

export const DEFAULT_CONFIG: StandaloneConfig = {
  piPath: "",
  language: "auto",
  env: {},
  args: [],
  disabledTools: [],
  permissionMode: "AskForApproval",
  dangerousPatterns: [],
  mcpEnabled: true,
  mcpIdleTimeout: 10,
  chatFontSize: 13,
  chatSendShortcut: "enter",
  chatMermaidTheme: "default",
  chatBackgroundImage: "",
  chatBackgroundOpacity: 1,
  rpcTrace: false,
  workspaceRoot: "",
  pinnedSessions: [],
};

/** ChatHost abstraction — replaces vscode.Disposable with a plain unsubscribe fn. */
export interface ChatHost {
  postMessage(msg: unknown): void;
  onDidReceiveMessage(listener: (msg: unknown) => void): () => void;
  onDidDispose(listener: () => void): () => void;
  updateTitle?(running: boolean, sessionName?: string): void;
}

/** IPC channel names. */
export const IPC = {
  // renderer -> main
  WEBVIEW_READY: "pi:webview-ready",
  PROMPT: "pi:prompt",
  ABORT: "pi:abort",
  CLEAR_QUEUE: "pi:clear-queue",
  PICK_RESOURCE: "pi:pick-resource",
  SET_MODEL: "pi:set-model",
  SET_THINKING: "pi:set-thinking",
  SET_SESSION_NAME: "pi:set-session-name",
  NEW_SESSION: "pi:new-session",
  SWITCH_SESSION: "pi:switch-session",
  LIST_SESSIONS: "pi:list-sessions",
  DIALOG_RESPONSE: "pi:dialog-response",
  COPY: "pi:copy",
  OPEN_FILE: "pi:open-file",
  SEARCH_FILES: "pi:search-files",
  FORK: "pi:fork",
  REVERT: "pi:revert",
  RELOAD: "pi:reload",
  TODO_CLEAR: "pi:todo-clear",
  MCP_OPEN: "pi:mcp-open",
  MCP_ACTION: "pi:mcp-action",
  SET_PERMISSION: "pi:set-permission",
  BTW_ABORT: "pi:btw-abort",
  REWIND_ACCEPT: "pi:rewind-accept",
  REWIND_ACCEPT_FILE: "pi:rewind-accept-file",
  REWIND_REVERT: "pi:rewind-revert",
  REWIND_REVERT_FILE: "pi:rewind-revert-file",
  REWIND_DIFF: "pi:rewind-diff",
  TOGGLE_FAVORITE: "pi:toggle-favorite",
  GET_CONFIG: "pi:get-config",
  SET_CONFIG: "pi:set-config",
  OPEN_SETTINGS: "pi:open-settings",
  // main -> renderer
  STATE: "pi:state",
  MODELS: "pi:models",
  ENABLED_MODELS: "pi:enabled-models",
  THINKING_LEVELS: "pi:thinking-levels",
  COMMANDS: "pi:commands",
  MESSAGES: "pi:messages",
  EVENT: "pi:event",
  DIALOG: "pi:dialog",
  PICKED_RESOURCES: "pi:picked-resources",
  CONTEXT_USAGE: "pi:context-usage",
  WIDGET: "pi:widget",
  TOAST: "pi:toast",
  INFO_PANEL: "pi:info-panel",
  BTW_ABORT_READY: "pi:btw-abort-ready",
  ERROR: "pi:error",
  PREFILL_INPUT: "pi:prefill-input",
  APPEND_INPUT: "pi:append-input",
  SESSION_INFO: "pi:session-info",
  PERMISSION_MODE: "pi:permission-mode",
  FILES: "pi:files",
  SESSIONS_LIST: "pi:sessions-list",
  STREAMING: "pi:streaming",
  MCP_STATUS: "pi:mcp-status",
} as const;
