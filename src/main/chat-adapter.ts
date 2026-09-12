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
  const wrap = (tag: string, src: string): string =>
    "<" + tag + ">" + NL + src + NL + "</" + tag + ">";
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
};

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
  background: linear-gradient(180deg, var(--pi-surface, #14171c), #12141a);
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
  color: #464c56;
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
  return `<style id="${id}">${css}</style>`;
}

function buildChromeHtml(): string {
  return `
<div id="pi-shell">
  <header class="pi-titlebar" id="pi-titlebar">
    <div class="pi-tb-left">
      <div class="pi-tb-logo" aria-hidden="true">π</div>
      <span class="pi-tb-app">Pi Heao GUI</span>
      <span class="pi-tb-brand" title="Pi Heao GUI V1.0 — made by HEAOZIE">made by HEAOZIE</span>
    </div>
    <div class="pi-tb-center">
      <span class="pi-tb-title is-empty" id="pi-title-text" title="当前会话"></span>
    </div>
    <div class="pi-tb-stats" id="pi-token-stats" title="Token 用量">
      <span class="pi-stat" id="pi-stat-ctx" title="上下文占用"></span>
      <span class="pi-stat" id="pi-stat-ft" title="首 token 延迟"></span>
      <span class="pi-stat" id="pi-stat-tps" title="输出速度"></span>
      <span class="pi-stat" id="pi-stat-cost" title="本次会话花费"></span>
    </div>
    <div class="pi-tb-right">
      <div class="pi-tb-actions">
        <button class="pi-icon-btn" id="pi-tb-new" title="新建会话 (Ctrl+N)" aria-label="新建会话">${svgIcon(ICONS.plus)}</button>
        <button class="pi-icon-btn" id="pi-dock-toggle" title="终端 / 文件 / 变更 (Ctrl+&#96;)" aria-label="打开终端面板">${svgIcon(ICONS.terminal)}</button>
        <button class="pi-icon-btn" id="pi-tb-history" title="会话历史 (Ctrl+H)" aria-label="会话历史">${svgIcon(ICONS.history)}</button>
        <button class="pi-icon-btn" id="pi-tb-search" title="搜索会话 (Ctrl+F)" aria-label="搜索会话">${svgIcon(ICONS.search)}</button>
        <button class="pi-icon-btn" id="pi-tb-refresh" title="重新加载会话" aria-label="重新加载会话">${svgIcon(ICONS.refresh)}</button>
        <button class="pi-icon-btn" id="pi-tb-export" title="导出当前会话" aria-label="导出会话">${svgIcon(ICONS.download)}</button>
        <span class="pi-tb-sep" aria-hidden="true"></span>
        <button class="pi-icon-btn" id="pi-tb-settings" title="设置 (Ctrl+,)" aria-label="设置">${svgIcon(ICONS.gear)}</button>
      </div>
    </div>
  </header>
  <div class="pi-body">
    <div id="pi-sidebar-collapsed" style="
      display:none;flex-direction:column;align-items:center;padding-top:8px;gap:4px;
      width:42px;flex-shrink:0;background:var(--pi-surface,#14171c);border-right:1px solid var(--pi-border,#252a32);
    ">
      <button id="pi-sidebar-expand" title="展开侧栏" aria-label="展开侧栏" style="
        background:none;border:none;color:var(--pi-text-dim,#9ba3af);cursor:pointer;padding:6px;
        border-radius:6px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;
      ">${svgIcon(ICONS.panel)}</button>
      <div style="width:18px;height:1px;background:var(--pi-border,#252a32);margin:4px 0;"></div>
      <button id="pi-new-session-mini" title="新建会话" aria-label="新建会话" style="
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
${PALETTE_HTML}
    <div id="pi-main">
${DOCK_HTML}
    </div>
  </div>
</div>
`;
}

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

export function buildChatHtml(appPath: string, config: StandaloneConfig): string | null {
  const candidates = [
    join(appPath, "vendor", "upstream", "packages", "pi-chat", "dist", "pi-chat-0.0.0.html"),
    join(appPath, "vendor", "upstream", "pi-chat", "dist", "index.html"),
    join(
      appPath,
      "app.asar",
      "vendor",
      "upstream",
      "packages",
      "pi-chat",
      "dist",
      "pi-chat-0.0.0.html",
    ),
    join(appPath, "app.asar", "vendor", "upstream", "pi-chat", "dist", "index.html"),
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
    lines.splice(
      headLineIdx,
      0,
      buildThemeCss(config.theme, config.accent),
      CHROME_CSS,
      styleTag("pi-stats", STATS_CSS),
      styleTag("pi-palette", PALETTE_CSS),
      styleTag("pi-dock-css", DOCK_CSS),
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
        buildThemeCss(config.theme, config.accent) +
        CHROME_CSS +
        styleTag("pi-stats", STATS_CSS) +
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
  const chromeHtml = buildChromeHtml();
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
      allLines.splice(
        i,
        0,
        REPARENT_SCRIPT,
        SIDEBAR_SCRIPT,
        TITLEBAR_SCRIPT,
        TOKENS_SCRIPT,
        STATS_SCRIPT,
        PALETTE_SCRIPT,
        vendorAssets().js,
        DOCK_SCRIPT,
      );
      break;
    }
  }

  return `<!-- Pi Heao GUI V1.0 · made by HEAOZIE -->\n${allLines.join("\n")}`;
}
