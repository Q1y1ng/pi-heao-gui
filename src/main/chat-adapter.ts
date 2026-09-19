/**
 * Electron adapter for pi-chat webview.
 * Reads the built single-file HTML, injects acquireVsCodeApi shim + config globals.
 * Also injects a full-window shell: custom title bar + sidebar + main content area.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import type { StandaloneConfig } from "../shared/types";
import { SIDEBAR_HTML, SIDEBAR_SCRIPT } from "./sidebar";
import { DOCK_HTML, DOCK_CSS, DOCK_SCRIPT } from "./dock";
import { STATS_HTML, STATS_SCRIPT, STATS_CSS } from "./stats-panel";
import { DECISIONS_HTML, DECISIONS_SCRIPT, DECISIONS_CSS } from "./decisions-panel";
import { WINDOWS_HTML, WINDOWS_SCRIPT, WINDOWS_CSS } from "./windows-panel";
import { PALETTE_HTML, PALETTE_SCRIPT, PALETTE_CSS } from "./palette";
import { buildThemeCss } from "./theme";

const BG_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/** Escape for embedding inside a double-quoted JS string in the generated HTML. */
function escJs(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\u003c");
}

/**
 * JSON that is safe to embed inside a <script> block: JSON.stringify does not
 * escape `<`, so a config value containing `</script>` would close the block.
 */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * CSP for the generated chat document.
 * The UI is a single inline module (vite single-file build), so 'unsafe-inline'
 * is required for script/style; everything else is pinned to this document plus
 * data:/blob: assets. No remote script, and no remote exfiltration channel.
 */
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; form-action 'none'; base-uri 'none'; frame-src 'none';">`;

/**
 * Vendored UI libraries for the dock (xterm.js, CodeMirror + modes) are UMD
 * builds copied into dist/renderer/vendor by scripts/copy-assets.mjs. They get
 * inlined as plain tags: no bundler, no network, CSP stays remote-free.
 * Missing files degrade the dock rather than breaking the chat window.
 * (Newlines are built with fromCharCode so this file needs no escape layers.)
 */
let vendorCache: { js: string; css: string } | null = null;

const VENDOR_JS = [
  "xterm.js",
  "addon-fit.js",
  "codemirror.js",
  // Rust's mode is written against the simple-mode addon; without it the mode
  // throws "CodeMirror.defineSimpleMode is not a function" in the renderer.
  "addon-mode-simple.js",
  "mode-javascript.js",
  "mode-xml.js",
  "mode-css.js",
  "mode-markdown.js",
  "mode-python.js",
  "mode-shell.js",
  "mode-yaml.js",
  "mode-rust.js",
  "mode-go.js",
];
const VENDOR_CSS = ["xterm.css", "codemirror.css"];

function vendorAssets(): { js: string; css: string } {
  if (vendorCache) return vendorCache;
  const NL = String.fromCharCode(10);
  const dir = join(__dirname, "..", "renderer", "vendor");
  const read = (file: string): string => {
    try {
      return readFileSync(join(dir, file), "utf8");
    } catch {
      return "";
    }
  };
  const wrap = (tag: string, src: string): string => `<${tag}>${NL}${src}${NL}</${tag}>`;
  const js = VENDOR_JS.map(read)
    .filter((src) => src.length > 0)
    .map((src) => wrap("script", src))
    .join(NL);
  const css = VENDOR_CSS.map(read)
    .filter((src) => src.length > 0)
    .map((src) => wrap("style", src))
    .join(NL);
  vendorCache = { js, css };
  return vendorCache;
}

function resolveBgDataUrl(path?: string): string {
  if (!path || !isAbsolute(path)) return "";
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size === 0 || st.size > 10 * 1024 * 1024) return "";
    const mime = BG_MIME[extname(path).toLowerCase()];
    if (!mime) return "";
    const buf = readFileSync(path);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

/**
 * The acquireVsCodeApi shim: routes postMessage through window.pi (preload bridge).
 * Dispatches main->renderer messages as window MessageEvents so pi-chat's listener works.
 */
const SHIM_SCRIPT = `
<script>
(function() {
  var _state = null;
  window.acquireVsCodeApi = function() {
    return {
      postMessage: function(msg) {
        if (window.pi && window.pi.postMessage) {
          window.pi.postMessage(msg);
        } else {
          console.warn("[pi-shim] window.pi not available for postMessage", msg && msg.type);
        }
      },
      getState: function() { return _state; },
      setState: function(s) { _state = s; }
    };
  };
  function setupBridge() {
    if (window.pi && window.pi.onMessage) {
      window.pi.onMessage(function(data) {
        // Nothing downstream applied a live theme. buildThemeCss() writes the tokens into
        // <style id="pi-heao-tokens"> at window creation and its own comment says a live
        // switch "only has to replace that one element" — but no code ever did, and pi-chat
        // does not listen for theme messages either, so every appearance change after startup
        // landed in a document that ignored it. The applier belongs here, next to the bridge
        // that delivers the message: it runs before the page sees the event and replaces the
        // element by the id the theme builder chose.
        if (data && data.type === 'theme' && typeof data.css === 'string') {
          var tokens = document.getElementById('pi-heao-tokens');
          if (!tokens) {
            tokens = document.createElement('style');
            tokens.id = 'pi-heao-tokens';
            document.head.appendChild(tokens);
          }
          tokens.textContent = data.css;
          // pi-chat sets --chat-fs INLINE when it boots, from window.__PI_FONTSIZE__ (see
          // studio/pi-chat/src/main.ts), and an inline custom property beats every stylesheet — so
          // the copy that won the cascade was the one written once at load and never again.
          // Measured: --pi-fs-md followed a size change into this document (16px -> 24px) while
          // --chat-fs stayed at 16px and the message text stayed with it. Re-pointing that inline
          // copy at the master makes it follow the sheet just replaced, which is what the upstream's
          // own :root rule does. The fallback keeps the text readable if the master is ever absent.
          document.documentElement.style.setProperty('--chat-fs', 'var(--pi-fs-md, 13px)');
        }
        window.dispatchEvent(new MessageEvent('message', { data: data }));
      });
      console.log("[pi-shim] bridge ready");
    } else {
      setTimeout(setupBridge, 50);
    }
  }
  setupBridge();
})();
</script>
`;

/** Inline SVG icons — no CDN */
function svgIcon(paths: string, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICONS = {
  plus: `<path d="M12 5v14M5 12h14"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0A1.7 1.7 0 0 0 16.9 6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z"/>`,
  history: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`,
  refresh: `<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>`,
  panel: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>`,
  folder: `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>`,
  star: `<path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9Z"/>`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>`,
  external: `<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M19 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>`,
  terminal: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M12 15h5"/>`,
  bell: `<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>`,
  windows: `<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>`,
};

/**
 * The pending-decision button. In both shells: a decision raised in a child window still has to be
 * findable from the window the person is actually looking at.
 */
const WINDOWS_BUTTON = `<button class="pi-icon-btn pi-windows-btn" id="pi-windows-btn" title="窗口总览" aria-label="窗口总览">${svgIcon(ICONS.windows)}</button>`;

const DECISIONS_BUTTON = `<button class="pi-icon-btn pi-decisions-btn" id="pi-decisions-btn" title="待你处理" aria-label="待你处理">${svgIcon(ICONS.bell)}<span class="pi-decisions-badge" id="pi-decisions-badge" hidden></span></button>`;

const CHROME_CSS = `
<style id="pi-standalone-chrome">
/* Shell chrome. Colours come from the --pi-* tokens defined in theme.ts. */
html, body {
  overflow: hidden !important;
  height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  background: var(--pi-bg, #0e1013) !important;
}

#pi-shell {
  display: flex !important;
  flex-direction: column !important;
  height: 100vh !important;
  width: 100vw !important;
  overflow: hidden !important;
  background: var(--pi-bg, #0e1013);
}

/* ── Title bar ── */
.pi-titlebar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  /* The Windows title-bar overlay (minimise / maximise / close) is drawn on top
     of the window, ~138px wide for three buttons. Without this reservation our
     own right-hand buttons sit underneath it and cannot be clicked. */
  padding: 0 148px 0 12px;
  background: linear-gradient(180deg, var(--pi-surface, #14171c), var(--pi-raised, #12141a));
  border-bottom: 1px solid var(--pi-border, #252a32);
  -webkit-app-region: drag;
  user-select: none;
  z-index: 1000;
  position: relative;
}
.pi-tb-left {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.pi-tb-logo {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: #0b0b0b;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding-bottom: 1px;
  box-sizing: border-box;
  flex-shrink: 0;
}
.pi-tb-app {
  font-size: var(--pi-fs-md, 13px);
  font-weight: 600;
  color: var(--pi-text, #e7eaf0);
  letter-spacing: 0.1px;
  white-space: nowrap;
}
/* Author mark: present but deliberately quiet. */
.pi-tb-brand {
  font-size: 9.5px;
  /* Was #464c56: in the dark theme that is 2.2:1 on the title bar, i.e. invisible. Measured
     by the e2e contrast pass. Tokens switch; this value did not. */
  color: var(--pi-text-faint);
  letter-spacing: 0.35px;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
  padding-top: 2px;
}
.pi-tb-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  gap: 8px;
  padding: 0 8px;
}
.pi-tb-title {
  font-size: var(--pi-fs-sm, 12px);
  color: var(--pi-text-dim, #9ba3af);
  max-width: 70%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: center;
}
.pi-tb-title.is-empty::before {
  content: "未打开会话";
  color: var(--pi-text-faint, #6b7381);
}

/* metrics: quiet chips, tabular figures */
.pi-tb-stats {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
.pi-stat {
  font-size: var(--pi-fs-xs, 11px);
  color: var(--pi-text-faint, #6b7381);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  padding: 2px 7px;
  border-radius: var(--pi-radius-pill, 999px);
  transition: background var(--pi-speed, 130ms), color var(--pi-speed, 130ms);
}
.pi-stat:empty {
  display: none;
}
.pi-stat:not(:empty):hover {
  background: var(--pi-raised, #1a1e24);
  color: var(--pi-text, #e7eaf0);
}
.pi-stat.pi-stat-active { color: var(--pi-success, #35c08b); }
.pi-stat.pi-stat-warn { color: var(--pi-warn, #e2b341); }
.pi-stat.pi-stat-err { color: var(--pi-danger, #f0616d); }

.pi-tb-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
.pi-tb-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border-radius: var(--pi-radius, 8px);
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.pi-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--pi-radius-sm, 5px);
  background: transparent;
  color: var(--pi-text-dim, #9ba3af);
  cursor: pointer;
  padding: 0;
  -webkit-app-region: no-drag;
  transition: color var(--pi-speed, 130ms), background var(--pi-speed, 130ms);
}
.pi-icon-btn:hover {
  color: var(--pi-text, #e7eaf0);
  background: rgba(255, 255, 255, 0.08);
}
.pi-icon-btn:active {
  background: rgba(255, 255, 255, 0.13);
}
.pi-icon-btn:focus-visible {
  outline: none;
  box-shadow: var(--pi-ring, 0 0 0 2px rgba(76, 141, 255, 0.35));
}
.pi-icon-btn svg {
  display: block;
  pointer-events: none;
}
.pi-tb-sep {
  width: 1px;
  height: 18px;
  background: var(--pi-border, #252a32);
  margin: 0 2px;
}

/* ── Body: sidebar + main ── */
.pi-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  background: var(--pi-bg, #0e1013);
}

#pi-sidebar {
  width: 268px;
  min-width: 216px;
  max-width: 420px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--pi-border, #252a32);
  background: var(--pi-surface, #14171c);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

#pi-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--pi-bg, #0e1013);
  position: relative;
}

/* Reparented pi-chat content fills the main area */
#pi-main > * {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/* Hide pi-chat's own toolbar — our title bar replaces it.
   Elements stay in DOM so JS handlers (refresh/mcp/settings) keep working. */
#pi-main .toolbar {
  display: none !important;
}

/* Center pi-chat .app nicely in main area */
#pi-main .app {
  max-width: 900px !important;
  margin: 0 auto !important;
  width: 100% !important;
  padding: 0 18px !important;
}

/* ── Session list layout only — the visuals live in sidebar.ts ── */
#pi-sidebar {
  pointer-events: auto !important;
}
#pi-session-list {
  pointer-events: auto !important;
}
.pi-session-item {
  cursor: pointer !important;
  pointer-events: auto !important;
  user-select: none !important;
}
</style>
`;

/**
 * CSS has to be wrapped in a <style> element before it goes into <head>: a bare
 * text node there is invalid, so the parser implicitly closes </head> and the
 * stylesheet ends up as body text (which the shell then moves into #pi-main).
 */
function styleTag(id: string, css: string): string {
  // The DOM id is namespaced: the panels' own wrappers already carry ids like
  // "pi-palette" and "pi-dock", and a duplicate id makes getElementById hand
  // back this <style> element instead — which silently disabled Ctrl+K.
  return `<style id="pi-style-${id.replace(/^pi-/, "")}">${css}</style>`;
}

import { t, resolveUiLang, translateFragment, type UiLang } from "./i18n";

/**
 * The stripped shell a dragged-out session window uses: a drag bar with the session
 * name, and the chat. Nothing else.
 *
 * The main window stays the control centre — session list, dock, palette — because
 * those are exactly the parts that make a window heavy and busy. A window opened
 * from one row of that list is a place to watch and drive that one session, so it
 * keeps only the hooks the re-parent script and the title bar need: #pi-shell,
 * #pi-titlebar, #pi-title-text and the empty #pi-main the chat is moved into.
 */
function buildMinimalChromeHtml(lang: UiLang): string {
  return `
<div id="pi-shell" class="pi-shell-minimal">
  <header class="pi-titlebar" id="pi-titlebar">
    <div class="pi-tb-center">
      <span class="pi-tb-title is-empty" id="pi-title-text" title="${t("tb.currentSession", lang)}"></span>
    </div>
    <div class="pi-tb-right">
      <div class="pi-tb-actions">${WINDOWS_BUTTON}${DECISIONS_BUTTON}</div>
    </div>
  </header>
  <div class="pi-body">
    <div id="pi-main"></div>
  </div>
</div>
`;
}

/**
 * The one thing a stripped window still needs from the message stream: the session
 * name for its title bar. The sidebar script normally does this, and there is no
 * sidebar here.
 */
const MINIMAL_TITLE_SCRIPT = `<script>
(function () {
  function setTitle(label) {
    var el = document.getElementById('pi-title-text');
    if (!el) return;
    el.textContent = label || '';
    if (label) el.classList.remove('is-empty');
    else el.classList.add('is-empty');
  }
  // The preload's onMessage is a SINGLE listener (see preload.ts), and the shim already holds
  // it, re-dispatching everything as a window "message" event — which is exactly what the
  // vendored chat app listens to. Registering on that channel from here replaced the shim, so
  // the app received nothing at all: the window opened with the correct title and an empty
  // conversation, and no error was ever logged. Listen for the forwarded event instead.
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (msg && msg.type === 'sessionInfo') setTitle(msg.label);
  });
  console.log('[pi-chrome] minimal title bridge ready');
})();
</script>`;

function buildChromeHtml(lang: UiLang): string {
  return `
<div id="pi-shell">
  <header class="pi-titlebar" id="pi-titlebar">
    <div class="pi-tb-left">
      <div class="pi-tb-logo" aria-hidden="true">π</div>
      <span class="pi-tb-app">Pi Heao GUI</span>
      <span class="pi-tb-brand" title="Pi Heao GUI V1.3.0 — made by HEAOZIE">made by HEAOZIE</span>
    </div>
    <div class="pi-tb-center">
      <span class="pi-tb-title is-empty" id="pi-title-text" title="${t("tb.currentSession", lang)}"></span>
    </div>
    <div class="pi-tb-stats" id="pi-token-stats" title="${t("tb.tokenUsage", lang)}">
      <span class="pi-stat" id="pi-stat-ctx" title="${t("tb.context", lang)}"></span>
      <span class="pi-stat" id="pi-stat-ft" title="${t("tb.ttft", lang)}"></span>
      <span class="pi-stat" id="pi-stat-tps" title="${t("tb.tps", lang)}"></span>
      <span class="pi-stat" id="pi-stat-cost" title="${t("tb.cost", lang)}"></span>
    </div>
    <div class="pi-tb-right">
      <div class="pi-tb-actions">
        <button class="pi-icon-btn" id="pi-tb-new" title="${t("tb.newHint", lang)}" aria-label="${t("tb.new", lang)}">${svgIcon(ICONS.plus)}</button>
        <button class="pi-icon-btn" id="pi-dock-toggle" title="${t("tb.dockHint", lang)}" aria-label="${t("tb.openDock", lang)}">${svgIcon(ICONS.terminal)}</button>
        <button class="pi-icon-btn" id="pi-tb-history" title="${t("tb.history", lang)}" aria-label="${t("tb.historyLabel", lang)}">${svgIcon(ICONS.history)}</button>
        <button class="pi-icon-btn" id="pi-tb-search" title="${t("tb.search", lang)}" aria-label="${t("tb.searchLabel", lang)}">${svgIcon(ICONS.search)}</button>
        <button class="pi-icon-btn" id="pi-tb-refresh" title="${t("tb.refresh", lang)}" aria-label="${t("tb.refresh", lang)}">${svgIcon(ICONS.refresh)}</button>
        <button class="pi-icon-btn" id="pi-tb-export" title="${t("tb.export", lang)}" aria-label="${t("tb.exportLabel", lang)}">${svgIcon(ICONS.download)}</button>
        ${WINDOWS_BUTTON}
        ${DECISIONS_BUTTON}
        <span class="pi-tb-sep" aria-hidden="true"></span>
        <button class="pi-icon-btn" id="pi-tb-settings" title="${t("tb.settings", lang)}" aria-label="${t("tb.settingsLabel", lang)}">${svgIcon(ICONS.gear)}</button>
      </div>
    </div>
  </header>
  <div class="pi-body">
    <div id="pi-sidebar-collapsed" style="
      display:none;flex-direction:column;align-items:center;padding-top:8px;gap:4px;
      width:42px;flex-shrink:0;background:var(--pi-surface,#14171c);border-right:1px solid var(--pi-border,#252a32);
    ">
      <button id="pi-sidebar-expand" title="${t("tb.expandSidebar", lang)}" aria-label="${t("tb.expandSidebar", lang)}" style="
        background:none;border:none;color:var(--pi-text-dim,#9ba3af);cursor:pointer;padding:6px;
        border-radius:6px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;
      ">${svgIcon(ICONS.panel)}</button>
      <div style="width:18px;height:1px;background:var(--pi-border,#252a32);margin:4px 0;"></div>
      <button id="pi-new-session-mini" title="${t("tb.new", lang)}" aria-label="${t("tb.new", lang)}" style="
        background:none;border:none;color:var(--pi-text-dim,#9ba3af);cursor:pointer;padding:6px;
        border-radius:6px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;
      ">${svgIcon(ICONS.plus)}</button>
      <div style="flex:1;"></div>
      <button id="pi-open-settings-mini" title="设置" aria-label="设置" style="
        background:none;border:none;color:var(--pi-text-dim,#9ba3af);cursor:pointer;padding:6px;
        border-radius:6px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;
        margin-bottom:10px;
      ">${svgIcon(ICONS.gear)}</button>
    </div>
    <aside id="pi-sidebar">
${SIDEBAR_HTML}
    </aside>
${STATS_HTML}
${DECISIONS_HTML}
${WINDOWS_HTML}
${PALETTE_HTML}
    <div id="pi-main">
${DOCK_HTML}
    </div>
  </div>
</div>
`;
}

/**
 * Make paste undoable with Ctrl+Z.
 *
 * The composer is a contenteditable div, and the vendored paste handler calls
 * preventDefault() and then re-renders its contents from a string. That insert
 * never touches the browser's native undo stack, so Ctrl+Z cannot take a pasted
 * block back — while ordinary typing, which the browser edits itself, undoes
 * fine. This listens in the capture phase to get the event first, and hands the
 * text to document.execCommand('insertText'), which IS a native edit: it becomes
 * a single undo entry, and it fires an input event, so the upstream handling
 * (token discovery for @paths, autosizing, the send-button state) still runs.
 *
 * Two escape hatches, both deliberate: a paste carrying files is left entirely
 * alone, because that path turns images into attachments, and if the edit cannot
 * be performed the event is not cancelled, so the original handler still does
 * its job instead of the paste being swallowed.
 */
const PASTE_UNDO_SCRIPT = `
<script>
(function() {
  var composer = document.getElementById('input');
  if (!composer) return;
  composer.addEventListener('paste', function(e) {
    var dt = e.clipboardData;
    if (!dt) return;
    if (dt.items) {
      for (var i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind === 'file') return;
      }
    }
    var text = dt.getData('text/plain');
    if (!text) return;
    if (document.activeElement !== composer) composer.focus();
    var ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (err) {
      ok = false;
    }
    if (!ok) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
})();
</script>`;

const REPARENT_SCRIPT = `
<script>
(function() {
  function wrap() {
    var shell = document.getElementById('pi-shell');
    var main = document.getElementById('pi-main');
    if (!shell || !main) return;
    // Move original body children (except shell, scripts, styles, links) into #pi-main
    var nodes = Array.prototype.slice.call(document.body.childNodes);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === shell) continue;
      if (n.nodeType === 1) {
        var tag = n.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') continue;
      }
      if (n.nodeType === 3 && !n.textContent.trim()) continue;
      main.appendChild(n);
    }
    // The center title is filled from sessionInfo/state messages (see TOKENS_SCRIPT)
    document.title = 'Pi Heao GUI';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wrap);
  } else {
    wrap();
  }
})();
</script>
`;

const TITLEBAR_SCRIPT = `
<script>
(function() {
  function wire() {
    function $(id) { return document.getElementById(id); }
    var btnNew = $('pi-tb-new');
    var btnHistory = $('pi-tb-history');
    var btnSearch = $('pi-tb-search');
    var btnRefresh = $('pi-tb-refresh');
    var btnExport = $('pi-tb-export');
    var btnSettings = $('pi-tb-settings');
    if (btnNew) btnNew.onclick = function() {
      if (window.pi) window.pi.postMessage({ type: 'newSession' });
    };
    if (btnRefresh) btnRefresh.onclick = function() {
      // Click pi-chat's hidden refresh button
      var rb = document.getElementById('refresh-btn');
      if (rb) rb.click();
      else if (window.pi) window.pi.postMessage({ type: 'reload' });
    };
    if (btnHistory) btnHistory.onclick = function() {
      var list = $('pi-session-list');
      if (list) {
        var first = list.querySelector('.pi-session-item');
        if (first) first.click();
      }
    };
    if (btnSearch) btnSearch.onclick = function() {
      var q = $('pi-session-filter');
      if (q) { q.focus(); q.select(); }
    };
    if (btnExport) btnExport.onclick = function() {
      if (!window.pi) return;
      window.pi.invoke('pi:export-conversation').then(function(path) {
        if (path) {
          var toast = document.getElementById('toast');
          if (toast) {
            toast.textContent = '已导出到: ' + path;
            toast.className = 'toast show success';
            setTimeout(function() { toast.className = 'toast'; }, 3000);
          }
        }
      });
    };
    if (btnSettings) btnSettings.onclick = function() {
      if (window.pi) window.pi.invoke('pi:open-settings');
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        var k = e.key.toLowerCase();
        if (k === 'n') { e.preventDefault(); if (btnNew) btnNew.click(); }
        if (k === 'f') { e.preventDefault(); if (btnSearch) btnSearch.click(); }
        if (k === 'h') { e.preventDefault(); if (btnHistory) btnHistory.click(); }
        if (k === ',') { e.preventDefault(); if (btnSettings) btnSettings.click(); }
        if (k === 'b') {
          e.preventDefault();
          var t = $('pi-sidebar-toggle');
          var x = $('pi-sidebar-expand');
          var sb = $('pi-sidebar');
          if (sb && sb.style.display === 'none') { if (x) x.click(); }
          else if (t) t.click();
        }
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
</script>
`;

const TOKENS_SCRIPT = `
<script>
(function() {
  function fmtMs(ms) {
    if (ms == null) return '';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }
  function fmtNum(n) {
    if (n == null) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function setStat(id, text, cls) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'pi-stat' + (cls ? ' ' + cls : '');
  }
  function setTitle(text) {
    var el = document.getElementById('pi-title-text');
    if (!el) return;
    var v = (text || '').trim();
    if (v) {
      el.textContent = v;
      el.classList.remove('is-empty');
    } else {
      el.textContent = '';
      el.classList.add('is-empty');
    }
  }

  function onMsg(data) {
    if (!data) return;
    // session name / workspace label pushed by chat-session
    if (data.type === 'sessionInfo') {
      setTitle(data.label || '');
    } else if (data.type === 'state') {
      var st = data.state || {};
      if (st.sessionName) setTitle(st.sessionName);
    }
    if (data.type === 'contextUsage' && data.usage) {
      var u = data.usage;
      var pct = u.percent != null ? Math.round(u.percent) : null;
      var tok = u.tokens != null ? fmtNum(u.tokens) : null;
      var ctxText = '';
      if (pct != null) ctxText = pct + '%';
      else if (tok) ctxText = tok;
      if (ctxText) {
        var cls = pct != null && pct > 80 ? 'pi-stat-warn' : '';
        setStat('pi-stat-ctx', ctxText, cls);
      }
    }
    if (data.type === 'tokenStats' && data.tokens) {
      var t = data.tokens;
      var total = t.total || ((t.input || 0) + (t.output || 0));
      if (total) setStat('pi-stat-ctx', fmtNum(total) + ' tok', '');
      if (data.cost != null) setStat('pi-stat-cost', '$' + Number(data.cost).toFixed(3), '');
    }
    if (data.type === 'firstToken' && data.ms != null) {
      setStat('pi-stat-ft', '⏱ ' + fmtMs(data.ms), 'pi-stat-active');
    }
    if (data.type === 'tokenMetrics' && data.metrics) {
      var m = data.metrics;
      if (m.firstTokenMs != null) setStat('pi-stat-ft', '⏱ ' + fmtMs(m.firstTokenMs), '');
      if (m.tokensPerSec != null) setStat('pi-stat-tps', m.tokensPerSec + ' t/s', 'pi-stat-active');
      if (m.cost != null) setStat('pi-stat-cost', '$' + Number(m.cost).toFixed(3), '');
      // Fade active highlight after 3s
      setTimeout(function() {
        var ft = document.getElementById('pi-stat-ft');
        var tps = document.getElementById('pi-stat-tps');
        if (ft) ft.classList.remove('pi-stat-active');
        if (tps) tps.classList.remove('pi-stat-active');
      }, 3000);
    }
    if (data.type === 'streaming' && data.running) {
      setStat('pi-stat-ft', '…', 'pi-stat-active');
      setStat('pi-stat-tps', '', '');
    }
  }
  function setup() {
    if (window.pi && window.pi.onMessage) {
      // Chain with existing listener
      var prev = null;
      // The shim already registered a listener; we piggyback via window message events
      window.addEventListener('message', function(e) { onMsg(e.data); });
      // Also try direct onMessage if available (won't override shim since shim already set)
    } else {
      setTimeout(setup, 100);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
</script>
`;

export function buildChatHtml(
  appPath: string,
  config: StandaloneConfig,
  opts: { minimal?: boolean } = {},
): string | null {
  const minimal = opts.minimal === true;
  const candidates = [
    join(appPath, "studio", "packages", "pi-chat", "dist", "pi-chat-0.0.0.html"),
    join(appPath, "studio", "pi-chat", "dist", "index.html"),
    join(appPath, "app.asar", "studio", "packages", "pi-chat", "dist", "pi-chat-0.0.0.html"),
    join(appPath, "app.asar", "studio", "pi-chat", "dist", "index.html"),
  ];
  let src: string | null = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      src = p;
      break;
    }
  }
  if (!src) return null;

  let html = readFileSync(src, "utf8");

  // Replace placeholders
  const home = homedir();
  const sepChar = process.platform === "win32" ? "\\" : "/";
  const bgDataUrl = resolveBgDataUrl(config.chatBackgroundImage);

  html = html.split("PI_HOME_PLACEHOLDER").join(escJs(home));
  html = html.split("PI_SEP_PLACEHOLDER").join(escJs(sepChar));
  html = html.split("PI_WORKSPACE_PLACEHOLDER").join(escJs(config.workspaceRoot || ""));
  html = html.split("PI_FONTSIZE_PLACEHOLDER").join(String(config.chatFontSize || 13));
  html = html
    .split("PI_LANG_PLACEHOLDER")
    .join(escJs(config.language === "auto" ? "zh-cn" : config.language));
  html = html
    .split("PI_MERMAID_THEME_PLACEHOLDER")
    .join(escJs(config.chatMermaidTheme || "default"));
  html = html.split("PI_BG_IMAGE_PLACEHOLDER").join(escJs(bgDataUrl));
  html = html.split("PI_BG_OPACITY_PLACEHOLDER").join(String(config.chatBackgroundOpacity ?? 1));
  html = html.split("PI_SENDSHORTCUT_PLACEHOLDER").join(escJs(config.chatSendShortcut || "enter"));

  // Only window.__PI_HOME__ is read by the UI. The whole config used to be
  // injected here too — nothing consumed it, and it wrote the user's `env` map
  // (potentially API keys) into the generated temp document for no reason.
  const configScript = `<script>window.__PI_HOME__ = ${safeJson(home)};</script>`;

  // Inject THEME_CSS + SHIM into <head>
  const lines = html.split("\n");
  let headLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "</head>") {
      headLineIdx = i;
      break;
    }
  }
  if (headLineIdx !== -1) {
    // A stripped window carries none of the panels, so it does not pay for their CSS. The
    // pending-decision panel is the exception: it is the one panel whose subject is *other*
    // windows, so a stripped child carries it (and its button) too.
    const panelCss = minimal
      ? [styleTag("pi-decisions", DECISIONS_CSS), styleTag("pi-windows", WINDOWS_CSS)]
      : [
          styleTag("pi-stats", STATS_CSS),
          styleTag("pi-decisions", DECISIONS_CSS),
          styleTag("pi-windows", WINDOWS_CSS),
          styleTag("pi-palette", PALETTE_CSS),
          styleTag("pi-dock-css", DOCK_CSS),
        ];
    lines.splice(
      headLineIdx,
      0,
      buildThemeCss(config.theme, config.accent, config.chatFontSize),
      CHROME_CSS,
      ...panelCss,
      vendorAssets().css,
      SHIM_SCRIPT,
      configScript,
    );
  } else {
    // fallback: inject before last </body>
    const bodyIdx = html.lastIndexOf("</body>");
    if (bodyIdx !== -1) {
      html =
        html.slice(0, bodyIdx) +
        buildThemeCss(config.theme, config.accent, config.chatFontSize) +
        CHROME_CSS +
        styleTag("pi-stats", STATS_CSS) +
        styleTag("pi-decisions", DECISIONS_CSS) +
        styleTag("pi-windows", WINDOWS_CSS) +
        styleTag("pi-palette", PALETTE_CSS) +
        styleTag("pi-dock-css", DOCK_CSS) +
        vendorAssets().css +
        SHIM_SCRIPT +
        configScript +
        html.slice(bodyIdx);
    }
  }
  html = lines.join("\n");

  // CSP must be the first element inside <head> — a policy declared after the
  // bundled module script would not apply to it.
  const headLines = html.split("\n");
  let headOpenIdx = -1;
  for (let i = 0; i < headLines.length; i++) {
    if (/^<head(\s|>|$)/i.test(headLines[i].trim())) {
      headOpenIdx = i;
      break;
    }
  }
  if (headOpenIdx !== -1) {
    headLines.splice(headOpenIdx + 1, 0, CSP_META);
    html = headLines.join("\n");
  } else {
    html = `${CSP_META}\n${html}`;
  }

  // Inject shell right after structural <body>
  const allLines = html.split("\n");
  let bodyOpenIdx = -1;
  for (let i = 0; i < allLines.length; i++) {
    const t = allLines[i].trim();
    if (t === "<body>" || /^<body\s[^>]*>$/.test(t)) {
      bodyOpenIdx = i;
      break;
    }
  }
  const lang = resolveUiLang(config.uiLanguage ?? "auto");
  // Our injected fragments are translated by exact phrase substitution; the
  // vendored upstream bundle is left untouched.
  const T = (fragment: string): string => translateFragment(fragment, lang);
  const chromeHtml = T(minimal ? buildMinimalChromeHtml(lang) : buildChromeHtml(lang));
  if (bodyOpenIdx !== -1) {
    allLines.splice(bodyOpenIdx + 1, 0, chromeHtml);
  } else {
    // fallback: prepend after first <body...> occurrence via regex
    html = allLines.join("\n");
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${chromeHtml}`);
    allLines.length = 0;
    allLines.push(...html.split("\n"));
  }

  // Inject re-parent + sidebar script before structural </body>
  for (let i = allLines.length - 1; i >= 0; i--) {
    if (allLines[i].trim() === "</body>") {
      // The stripped shell keeps only what the chat itself needs: re-parent and
      // paste undo, plus its own title bridge. Sidebar, dock, palette, token stats
      // and titlebar wiring all drive controls it does not have — and their
      // timers are the kind of thing that later shows up as idle CPU.
      const chromeScripts = minimal
        ? [T(MINIMAL_TITLE_SCRIPT), T(DECISIONS_SCRIPT), T(WINDOWS_SCRIPT)]
        : [
            T(SIDEBAR_SCRIPT),
            T(TITLEBAR_SCRIPT),
            T(TOKENS_SCRIPT),
            T(STATS_SCRIPT),
            T(DECISIONS_SCRIPT),
            T(WINDOWS_SCRIPT),
            T(PALETTE_SCRIPT),
          ];
      allLines.splice(
        i,
        0,
        T(REPARENT_SCRIPT),
        T(PASTE_UNDO_SCRIPT),
        ...chromeScripts,
        // The vendored upstream bundle keeps its own locales: never translated here.
        vendorAssets().js,
        ...(minimal ? [] : [T(DOCK_SCRIPT)]),
      );
      break;
    }
  }

  return `<!-- Pi Heao GUI V1.3.0 · made by HEAOZIE -->\n${allLines.join("\n")}`;
}
