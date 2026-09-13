/**
 * Design tokens + chat-surface styling injected into the pi-chat document.
 *
 * Two layers:
 *  1. `--pi-*` tokens — the single source of truth for colour, radius, type and
 *     motion. Everything else (shell, sidebar, settings) consumes these.
 *  2. `--vscode-*` overrides — pi-chat is upstream code driven by VS Code theme
 *     variables, so re-pointing those variables is how the chat area gets the
 *     same look without patching vendored sources.
 *
 * Injected into <head> before the bundle runs; pi-chat injects its own styles at
 * runtime, so anything that must win uses !important or a token override.
 */
/**
 * Design tokens, shared by every surface (chat shell, sidebar, settings window).
 * The settings window is a separate document, so it imports this block directly
 * instead of re-declaring the palette.
 */
export type ThemeName = "dark" | "light" | "system";

interface Palette {
  bg: string;
  surface: string;
  raised: string;
  overlay: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accentHover: string;
  accentSoft: string;
  accentContrast: string;
  success: string;
  warn: string;
  danger: string;
  shadow1: string;
  shadow2: string;
  ring: string;
  scrollbar: string;
  scrollbarHover: string;
  codeBg: string;
}

/** Mix a #rrggbb colour with white (f > 0) or black (f < 0). */
function mix(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  const to = f >= 0 ? 255 : 0;
  const t = Math.abs(f);
  const ch = (shift: number): number => {
    const v = (n >> shift) & 0xff;
    return Math.round(v + (to - v) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function palette(theme: "dark" | "light", accent: string): Palette {
  const soft = withAlpha(accent, theme === "dark" ? 0.16 : 0.12);
  const ring = `0 0 0 2px ${withAlpha(accent, 0.35)}`;
  if (theme === "light") {
    return {
      bg: "#ffffff",
      surface: "#f6f7f9",
      raised: "#eef0f4",
      overlay: "#e7eaef",
      border: "#dfe3e9",
      borderStrong: "#c7ccd6",
      text: "#1c2027",
      textDim: "#5b6472",
      textFaint: "#8a93a1",
      accentHover: mix(accent, -0.12),
      accentSoft: soft,
      accentContrast: "#ffffff",
      success: "#1f9d6b",
      warn: "#b7791f",
      danger: "#d1435b",
      shadow1: "0 1px 2px rgba(16, 24, 40, 0.08)",
      shadow2: "0 8px 28px rgba(16, 24, 40, 0.12)",
      ring,
      scrollbar: "#0f172a26",
      scrollbarHover: "#0f172a40",
      codeBg: "#f2f4f7",
    };
  }
  return {
    bg: "#0e1013",
    surface: "#14171c",
    raised: "#1a1e24",
    overlay: "#1f242b",
    border: "#252a32",
    borderStrong: "#333a45",
    text: "#e7eaf0",
    textDim: "#9ba3af",
    textFaint: "#6b7381",
    accentHover: mix(accent, 0.22),
    accentSoft: soft,
    accentContrast: "#ffffff",
    success: "#35c08b",
    warn: "#e2b341",
    danger: "#f0616d",
    shadow1: "0 1px 2px rgba(0, 0, 0, 0.4)",
    shadow2: "0 6px 24px rgba(0, 0, 0, 0.35)",
    ring,
    scrollbar: "#3a414d80",
    scrollbarHover: "#4a5361cc",
    codeBg: "#0b0d10",
  };
}

/** True when the OS is in light mode (used for theme: "system"). */
export function resolveTheme(theme: ThemeName): "dark" | "light" {
  if (theme !== "system") return theme;
  try {
    // Electron's nativeTheme is optional here so this stays unit-testable.
    const electron = require("electron") as { nativeTheme?: { shouldUseDarkColors?: boolean } };
    return electron.nativeTheme?.shouldUseDarkColors === false ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Build the token block for a theme + accent colour. */
export function buildTokensCss(theme: ThemeName = "dark", accent = "#4c8dff", chatFontSize = 13): string {
  const accentColor = /^#[0-9a-f]{6}$/i.test(accent.trim()) ? accent.trim() : "#4c8dff";
  const p = palette(resolveTheme(theme), accentColor);
  // Same clamp as the settings slider, so a hand-edited config cannot blow up the layout.
  const fs = Math.min(32, Math.max(8, Math.round(chatFontSize || 13)));
  return renderTokens(p, accentColor, fs);
}

function renderTokens(p: Palette, accentColor: string, fs: number): string {
  return `
/* ── Tokens ─────────────────────────────────────────────────────────── */
:root {
  /* surfaces: app < surface < raised < overlay */
  --pi-bg: ${p.bg};
  --pi-surface: ${p.surface};
  --pi-raised: ${p.raised};
  --pi-overlay: ${p.overlay};
  --pi-border: ${p.border};
  --pi-border-strong: ${p.borderStrong};

  /* text */
  --pi-text: ${p.text};
  --pi-text-dim: ${p.textDim};
  --pi-text-faint: ${p.textFaint};

  /* accent + semantics */
  --pi-accent: ${accentColor};
  --pi-accent-hover: ${p.accentHover};
  --pi-accent-soft: ${p.accentSoft};
  --pi-success: ${p.success};
  --pi-warn: ${p.warn};
  --pi-danger: ${p.danger};

  /* geometry */
  --pi-radius-sm: 5px;
  --pi-radius: 8px;
  --pi-radius-lg: 12px;
  --pi-radius-pill: 999px;
  --pi-shadow-1: ${p.shadow1};
  --pi-shadow-2: ${p.shadow2};
  --pi-ring: ${p.ring};
  --pi-scrollbar: ${p.scrollbar};
  --pi-scrollbar-hover: ${p.scrollbarHover};
  --pi-code-bg: ${p.codeBg};

  /* type */
  --pi-font-ui: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, -apple-system,
    "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  --pi-font-mono: "Cascadia Mono", "Cascadia Code", Consolas, "Microsoft YaHei UI", "微软雅黑", monospace;
  /* --pi-fs-md is the master: the appearance slider writes config.chatFontSize and every
     other size is a ratio of it, the same calc() idiom pi-chat uses for --chat-fs-N. */
  --pi-fs-md: ${fs}px;
  --pi-fs-xs: calc(var(--pi-fs-md) * 11 / 13);
  --pi-fs-sm: calc(var(--pi-fs-md) * 12 / 13);
  --pi-fs-lg: calc(var(--pi-fs-md) * 14 / 13);

  --pi-speed: 130ms;
}

/* ── VS Code variable bridge (drives pi-chat's own CSS) ─────────────── */
:root {
  --vscode-editor-background: var(--pi-bg);
  --vscode-editor-foreground: var(--pi-text);
  --vscode-foreground: var(--pi-text);
  --vscode-descriptionForeground: var(--pi-text-dim);
  --vscode-widget-border: var(--pi-border);
  --vscode-panel-border: var(--pi-border);
  --vscode-input-background: var(--pi-raised);
  --vscode-input-foreground: var(--pi-text);
  --vscode-input-border: var(--pi-border-strong);
  --vscode-input-placeholderForeground: var(--pi-text-faint);
  --vscode-button-background: var(--pi-accent);
  --vscode-button-foreground: ${p.accentContrast};
  --vscode-button-hoverBackground: var(--pi-accent-hover);
  --vscode-button-secondaryBackground: var(--pi-overlay);
  --vscode-button-secondaryForeground: var(--pi-text);
  --vscode-dropdown-background: var(--pi-overlay);
  --vscode-dropdown-foreground: var(--pi-text);
  --vscode-dropdown-border: var(--pi-border-strong);
  --vscode-list-hoverBackground: var(--pi-raised);
  --vscode-list-activeSelectionBackground: var(--pi-accent-soft);
  --vscode-list-activeSelectionForeground: ${p.text};
  --vscode-badge-background: var(--pi-overlay);
  --vscode-badge-foreground: var(--pi-text);
  --vscode-scrollbarSlider-background: ${p.scrollbar};
  --vscode-scrollbarSlider-hoverBackground: ${p.scrollbarHover};
  --vscode-focusBorder: var(--pi-accent);
  --vscode-errorForeground: var(--pi-danger);
  --vscode-warningForeground: var(--pi-warn);
  --vscode-textLink-foreground: var(--pi-accent);
  --vscode-textLink-activeForeground: var(--pi-accent-hover);
  --vscode-editorWidget-background: var(--pi-raised);
  --vscode-editorWidget-foreground: var(--pi-text);
  --vscode-editorWidget-border: var(--pi-border-strong);
  --vscode-menu-background: var(--pi-overlay);
  --vscode-menu-foreground: var(--pi-text);
  --vscode-menu-selectionBackground: var(--pi-accent-soft);
  --vscode-menu-selectionForeground: ${p.text};
  --vscode-sideBar-background: var(--pi-surface);
  --vscode-sideBar-foreground: var(--pi-text);
  --vscode-sideBar-border: var(--pi-border);
  --vscode-panel-background: var(--pi-surface);
  --vscode-peekViewResult-background: var(--pi-surface);
  --vscode-font-family: var(--pi-font-ui);
  --vscode-font-size: var(--pi-fs-md);
}

`;
}

export const THEME_BODY = `
/* ── Base ───────────────────────────────────────────────────────────── */
html,
body,
body * {
  font-family: var(--pi-font-ui);
}

/* Long sessions: skip style/layout/paint for messages outside the viewport.
   Measured on a 4.8 MB session: ~140 blocks, renderer side ~1.5 s of the 12 s
   load (pi's own parse + transfer is the rest), so this is a modest but free
   win, and it keeps very long chats scrollable. */
.msg {
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;
}
.msg.pi-hit-flash { content-visibility: visible; }
html,
body {
  background: var(--pi-bg) !important;  color: var(--pi-text) !important;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  letter-spacing: 0.005em;
}
::selection {
  background: rgba(76, 141, 255, 0.32);
}

/* pi-chat's own drag bars are replaced by our title bar */
.toolbar {
  -webkit-app-region: drag;
}
.toolbar button,
.toolbar .icon-btn,
.toolbar select,
.toolbar input {
  -webkit-app-region: no-drag;
}

/* Draggable strips: the sidebar header row and the collapsed strip.
   Everything else in the sidebar must stay no-drag — any element inside a drag
   region stops receiving mouse events, which is what once made every session
   row unclickable. */
#pi-sidebar-header {
  -webkit-app-region: drag;
}
#pi-sidebar-header button {
  -webkit-app-region: no-drag;
}
#pi-sidebar-collapsed {
  -webkit-app-region: drag;
}
#pi-sidebar-collapsed button {
  -webkit-app-region: no-drag;
}
#pi-sidebar,
#pi-sidebar .pi-sidebar-inner,
#pi-session-list,
#pi-session-list *,
.pi-session-item,
#pi-session-filter,
#pi-sidebar button,
#pi-sidebar input {
  -webkit-app-region: no-drag;
}

/* ── Chat surfaces ──────────────────────────────────────────────────── */
.app,
.messages,
.messages-inner {
  background: var(--pi-bg) !important;
  color: var(--pi-text) !important;
}
.messages {
  padding-top: 6px;
}

/* code */
pre,
code,
kbd,
samp {
  font-family: var(--pi-font-mono) !important;
  font-variant-ligatures: none;
}
code {
  background: var(--pi-raised) !important;
  color: #e3c9a0 !important;
  border: 1px solid var(--pi-border) !important;
  border-radius: var(--pi-radius-sm) !important;
  padding: 0.1em 0.38em !important;
  font-size: 0.9em !important;
}
pre {
  background: #12151a !important;
  border: 1px solid var(--pi-border) !important;
  border-radius: var(--pi-radius) !important;
  padding: 12px 14px !important;
  box-shadow: var(--pi-shadow-1);
}
pre code {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  color: #d7dbe2 !important;
}
kbd {
  background: var(--pi-overlay) !important;
  color: var(--pi-text) !important;
  border: 1px solid var(--pi-border-strong) !important;
  border-bottom-width: 2px !important;
  border-radius: var(--pi-radius-sm) !important;
  padding: 1px 6px !important;
  font-size: var(--pi-fs-xs) !important;
}
a {
  color: var(--pi-accent) !important;
  text-decoration-color: rgba(76, 141, 255, 0.4);
  text-underline-offset: 2px;
}
a:hover {
  color: var(--pi-accent-hover) !important;
}
blockquote {
  border-left: 2px solid var(--pi-border-strong) !important;
  color: var(--pi-text-dim) !important;
  margin: 8px 0 !important;
  padding: 2px 0 2px 12px !important;
}
table {
  border-collapse: collapse !important;
  border: 1px solid var(--pi-border) !important;
  border-radius: var(--pi-radius) !important;
  overflow: hidden;
  margin: 10px 0 !important;
}
th,
td {
  border: 1px solid var(--pi-border) !important;
  padding: 6px 10px !important;
}
th {
  background: var(--pi-raised) !important;
  font-weight: 600 !important;
}
hr {
  border: none !important;
  border-top: 1px solid var(--pi-border) !important;
  margin: 14px 0 !important;
}

/* message rhythm */
.msg-user,
.msg-assistant,
.message {
  color: var(--pi-text) !important;
}
.role,
.msg-role,
.timestamp,
.time {
  color: var(--pi-text-faint) !important;
  font-size: var(--pi-fs-xs) !important;
}
.empty,
.empty-line,
.empty-hint {
  color: var(--pi-text-dim) !important;
}
.empty-accent {
  color: var(--pi-accent) !important;
}

/* thinking blocks read as a quiet aside */
.thinking,
.thinking-block,
details.thinking {
  background: var(--pi-surface) !important;
  border: 1px solid var(--pi-border) !important;
  border-radius: var(--pi-radius) !important;
  color: var(--pi-text-dim) !important;
  padding: 8px 12px !important;
}

/* ── Composer ───────────────────────────────────────────────────────── */
.composer-box,
.composer {
  background: var(--pi-surface) !important;
  border: 1px solid var(--pi-border) !important;
  border-radius: var(--pi-radius-lg) !important;
  box-shadow: var(--pi-shadow-1);
  transition: border-color var(--pi-speed), box-shadow var(--pi-speed);
}
.composer-box:focus-within,
.composer:focus-within {
  border-color: var(--pi-accent) !important;
  box-shadow: var(--pi-ring);
}
.composer-input,
.composer-input * {
  color: var(--pi-text) !important;
  caret-color: var(--pi-accent);
}
.composer-input:empty::before,
.composer-input[data-empty="true"]::before {
  color: var(--pi-text-faint) !important;
}
.composer-toolbar,
.composer .toolbar,
.composer-footer {
  border-top: 1px solid var(--pi-border) !important;
  background: transparent !important;
  color: var(--pi-text-dim) !important;
}
.composer-toolbar button,
.composer .toolbar button {
  border-radius: var(--pi-radius-sm) !important;
  transition: background var(--pi-speed), color var(--pi-speed);
}
.composer-toolbar button:hover,
.composer .toolbar button:hover {
  background: var(--pi-overlay) !important;
  color: var(--pi-text) !important;
}
.send-btn,
#send-btn,
.composer .send {
  background: var(--pi-accent) !important;
  color: #fff !important;
  border-radius: var(--pi-radius) !important;
  transition: background var(--pi-speed), transform var(--pi-speed);
}
.send-btn:hover,
#send-btn:hover,
.composer .send:hover {
  background: var(--pi-accent-hover) !important;
}

/* pi-chat paints the user bubble with --vscode-button-background, which we map
   to the accent — a wall of saturated blue. Use a tinted surface instead. */
.user-bubble {
  background: linear-gradient(180deg, rgba(76, 141, 255, 0.17), rgba(76, 141, 255, 0.1)) !important;
  color: var(--pi-text) !important;
  border: 1px solid rgba(76, 141, 255, 0.34) !important;
  border-radius: var(--pi-radius) !important;
  box-shadow: var(--pi-shadow-1);
}
.user-bubble code {
  background: rgba(0, 0, 0, 0.28) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  color: #e8d7b6 !important;
}
.msg {
  padding: 2px 0 !important;
}
.msg + .msg {
  margin-top: 8px;
}
.msg.assistant .md,
.msg.assistant .bubble {
  line-height: 1.62;
  letter-spacing: 0.012em;
}
.msg h1,
.msg h2,
.msg h3 {
  color: #f2f4f8 !important;
  margin: 14px 0 6px !important;
  line-height: 1.35;
}
.msg h1 {
  font-size: 1.25em !important;
}
.msg h2 {
  font-size: 1.14em !important;
}
.msg h3 {
  font-size: 1.05em !important;
}
.msg ul,
.msg ol {
  padding-left: 1.35em !important;
  margin: 6px 0 !important;
}
.msg li {
  margin: 3px 0 !important;
}
.turn-head,
.turn-header {
  color: var(--pi-text-faint) !important;
}

/* ── Popups ─────────────────────────────────────────────────────────── */
.model-popup,
.autocomplete,
.info-panel,
.widget,
.widget-card,
.modal,
.overlay > div {
  background: var(--pi-overlay) !important;
  border: 1px solid var(--pi-border-strong) !important;
  border-radius: var(--pi-radius) !important;
  box-shadow: var(--pi-shadow-2) !important;
  color: var(--pi-text) !important;
}
.model-trigger,
.model-popup,
.model-search,
.model-list,
.select-borderless,
.permission-select,
.thinking-select,
select {
  color: var(--pi-text) !important;
}
select option {
  background: var(--pi-overlay) !important;
  color: var(--pi-text) !important;
}
.autocomplete .item:hover,
.model-list .item:hover,
.model-list [role="option"]:hover {
  background: var(--pi-raised) !important;
}
.queue-item {
  background: var(--pi-surface) !important;
  border: 1px solid var(--pi-border) !important;
  border-radius: var(--pi-radius-sm) !important;
  color: var(--pi-text-dim) !important;
}
.toast {
  background: var(--pi-overlay) !important;
  border: 1px solid var(--pi-border-strong) !important;
  border-radius: var(--pi-radius) !important;
  color: var(--pi-text) !important;
  box-shadow: var(--pi-shadow-2) !important;
}
.timeline-rail {
  color: var(--pi-text-faint) !important;
}
.ctx-ring-track {
  stroke: var(--pi-border-strong) !important;
}
.ctx-ring-prog {
  stroke: var(--pi-accent) !important;
}
.overlay {
  background: rgba(6, 8, 11, 0.62) !important;
}

/* ── Scrollbars ─────────────────────────────────────────────────────── */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--pi-scrollbar);
  border: 2px solid transparent;
  background-clip: content-box;
  border-radius: var(--pi-radius-pill);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--pi-scrollbar-hover);
  background-clip: content-box;
}
</style>
`;

// Default (dark) token block, used by the settings window which imports it directly.
export const TOKENS_CSS = buildTokensCss("dark", "#4c8dff");

/**
 * Full theme block for a theme + accent. The token element has its own id so a
 * live theme switch only has to replace that one element (pi:theme channel).
 */
export function buildThemeCss(theme: ThemeName = "dark", accent = "#4c8dff", chatFontSize = 13): string {
  return `<style id="pi-heao-tokens">${buildTokensCss(theme, accent, chatFontSize)}</style>
<style id="pi-heao-theme">${THEME_BODY}</style>`;
}

export const THEME_CSS = `<style id="pi-heao-tokens">${TOKENS_CSS}</style>
<style id="pi-heao-theme">${THEME_BODY}</style>`;
