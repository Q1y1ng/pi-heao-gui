/** Shared types between main, preload, and renderer. */

/** Desktop alerts. The rules that read these fields live in src/main/alerts.ts. */
export interface AlertSettings {
  /** Master switch for every sound this app makes on its own. */
  enabled: boolean;
  /**
   * "chime" = the synthesized arpeggio (our own sound, toast silenced),
   * "system" = the notification's own sound, "off" = silent.
   */
  sound: "chime" | "system" | "off";
  /** Chime level, 0–1. */
  volume: number;
  /** Sound when a turn finishes in a window that is not focused. */
  onTurnEnd: boolean;
  /** Sound when the agent needs a decision (permission, elevation, confirmation). */
  onApproval: boolean;
  /** Minimum gap between two sounds, so several sessions cannot stack up. */
  minIntervalMs: number;
}

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
  /** "dark" | "light" | "system" — drives the --pi-* token palette. */
  theme: "dark" | "light" | "system";
  /** Accent colour as #rrggbb (buttons, focus ring, active row). */
  accent: string;
  /** Favourited models as "provider/modelId", shown first in the picker. */
  favoriteModels: string[];
  /** Soft spend limits in USD; 0 disables the warning. */
  budgetDailyUsd: number;
  budgetMonthlyUsd: number;
  /** Launch the app when the user logs in. */
  openAtLogin: boolean;
  /** Sidebar: also list archived sessions. */
  showArchived: boolean;
  /** Reopen the session windows that were open when the app last quit. */
  restoreWindows: boolean;
  /** Check GitHub releases for a newer build in the background (packaged runs). */
  autoCheckUpdates: boolean;
  /** Most-recently used workspaces (per-window workspace switcher). */
  recentWorkspaces: string[];
  /** Language of the app's own UI (chat UI has its own upstream locales). */
  uiLanguage: "auto" | "zh-cn" | "en";
  /** App version whose first-run guidance was already shown (empty = never). */
  lastOnboardedVersion: string;
  /** Language for generated commit messages (upstream: pi-agent-studio.commitLanguage). */
  commitLanguage: string;
  /** Override for the commit-message system prompt (empty = upstream default). */
  commitMessagePrompt: string;
  /** Desktop alert settings (sound on turn end / when a decision is needed). */
  alerts: AlertSettings;
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
  theme: "dark",
  accent: "#4c8dff",
  favoriteModels: [],
  budgetDailyUsd: 0,
  budgetMonthlyUsd: 0,
  openAtLogin: false,
  showArchived: false,
  restoreWindows: true,
  autoCheckUpdates: true,
  recentWorkspaces: [],
  uiLanguage: "auto",
  lastOnboardedVersion: "",
  commitLanguage: "English",
  commitMessagePrompt: "",
  alerts: {
    enabled: true,
    sound: "chime",
    volume: 0.6,
    onTurnEnd: true,
    onApproval: true,
    minIntervalMs: 1500,
  },
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
  /** Settings window only: play an alert sound on demand (the "试听" buttons). */
  ALERT_TEST: "pi:alert-test",
  /** The decisions nobody has answered yet — every window's, not just this one's. */
  GET_DECISIONS: "pi:get-decisions",
  /** Bring the window that is waiting for an answer to the front. */
  DECISIONS_FOCUS: "pi:decisions-focus",
  /** Make a new working copy of this repository and open a session window in it. */
  WORKTREE_CREATE: "pi:worktree-create",
  /** Copy a session file into this profile — the other half of export. */
  IMPORT_SESSION: "pi:import-session",
  /** What every window is doing (the board). */
  GET_WINDOWS: "pi:get-windows",
  /** Bring any window to the front (the decision list and the board both use it). */
  FOCUS_WINDOW: "pi:focus-window",
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
  /** Pushed to every window whenever the pending-decision list changes. */
  DECISIONS: "pi:decisions",
  /** Pushed to every window whenever the window board changes. */
  WINDOW_STATUS: "pi:window-status",
} as const;
