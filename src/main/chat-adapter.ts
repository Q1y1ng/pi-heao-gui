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
import { THEME_CSS } from "./theme";

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
  search: `<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>`,
  history: `<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>`,
};

const CHROME_CSS = `
<style id="pi-standalone-chrome">
html, body {
  overflow: hidden !important;
  height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #1e1e1e !important;
}

#pi-shell {
  display: flex !important;
  flex-direction: column !important;
  height: 100vh !important;
  width: 100vw !important;
  overflow: hidden !important;
  background: #1e1e1e;
}

/* ── Title bar: 32px, full width ── */
.pi-titlebar {
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  background: #181818;
  border-bottom: 1px solid #2a2a2a;
  -webkit-app-region: drag;
  user-select: none;
  z-index: 1000;
  position: relative;
}
.pi-tb-left {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  flex-shrink: 0;
  width: auto;
}
.pi-tb-logo {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: #0b0b0b;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  padding-bottom: 1px;
  box-sizing: border-box;
  flex-shrink: 0;
}

/* Author mark: present but deliberately quiet. */
.pi-tb-brand {
  font-size: 9.5px;
  color: #4a4a4a;
  letter-spacing: 0.35px;
  margin-left: 3px;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
}
.pi-tb-app {
  font-size: 12px;
  font-weight: 500;
  color: #cccccc;
  letter-spacing: 0.15px;
  white-space: nowrap;
}
.pi-tb-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 0 12px;
}
.pi-tb-title {
  font-size: 11.5px;
  color: #8a8a8a;
  max-width: 60%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: center;
}
.pi-tb-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
.pi-stat {
  font-size: 10.5px;
  color: #7a7a7a;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.2px;
}
.pi-stat.pi-stat-active { color: #4ec9b0; }
.pi-stat.pi-stat-warn { color: #cca700; }
.pi-stat.pi-stat-err { color: #f44747; }
.pi-tb-right {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
.pi-tb-actions {
  display: flex;
  align-items: center;
  padding: 0 2px;
  gap: 0;
}
.pi-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: #9a9a9a;
  cursor: pointer;
  padding: 0;
  -webkit-app-region: no-drag;
  transition: color 0.1s, background 0.1s;
}
.pi-icon-btn:hover {
  color: #e4e4e4;
  background: rgba(255,255,255,0.06);
}
.pi-icon-btn:active {
  background: rgba(255,255,255,0.1);
}
.pi-icon-btn svg {
  display: block;
  pointer-events: none;
}

/* ── Body: sidebar + main ── */
.pi-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

#pi-sidebar {
  width: 248px;
  min-width: 200px;
  max-width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2a2a2a;
  background: #181818;
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
  background: #1e1e1e;
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
  max-width: 920px !important;
  margin: 0 auto !important;
  width: 100% !important;
}

/* ── Session list (injected in head so it always applies) ── */
#pi-sidebar { pointer-events: auto !important; }
#pi-session-list { pointer-events: auto !important; }
#pi-sidebar .pi-session-item,
.pi-session-item {
  padding: 7px 10px !important;
  border-radius: 5px !important;
  cursor: pointer !important;
  pointer-events: auto !important;
  margin: 1px 0 !important;
  transition: background 0.12s !important;
  user-select: none !important;
}
#pi-sidebar .pi-session-item:hover,
.pi-session-item:hover { background: #2a2d2e !important; }
#pi-sidebar .pi-session-item.active,
.pi-session-item.active { background: #094771 !important; }
.pi-session-item .pi-session-name {
  font-size: 12px !important;
  color: #e0e0e0 !important;
  line-height: 1.4 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  flex: 1 !important;
  min-width: 0 !important;
}
.pi-session-item .pi-session-time {
  font-size: 10px !important;
  color: #6a6a6a !important;
  margin-top: 2px !important;
}
.pi-session-item .pi-pin-btn {
  background: none !important;
  border: none !important;
  color: #666 !important;
  cursor: pointer !important;
  font-size: 12px !important;
  padding: 0 2px !important;
  opacity: 0 !important;
  flex-shrink: 0 !important;
  line-height: 1 !important;
}
.pi-session-item:hover .pi-pin-btn { opacity: 1 !important; }
.pi-session-item.pinned .pi-pin-btn { opacity: 1 !important; color: #cca700 !important; }

/* Sidebar header refinement */
#pi-sidebar .sidebar-header {
  padding: 10px 12px 8px !important;
}
#pi-sidebar .sidebar-header h3 {
  font-size: 12.5px !important;
  margin: 0 !important;
  color: #cccccc !important;
  font-weight: 500 !important;
}
#pi-sidebar .sidebar-collapse-btn {
  width: 22px !important;
  height: 22px !important;
}
</style>
`;

function buildChromeHtml(): string {
  return `
<div id="pi-shell">
  <header class="pi-titlebar" id="pi-titlebar">
    <div class="pi-tb-left">
      <div class="pi-tb-logo" aria-hidden="true">π</div>
      <span class="pi-tb-app">Pi Heao GUI</span>
      <span class="pi-tb-brand" title="Pi Heao GUI V0.1 — made by HEAOZIE">made by HEAOZIE</span>
    </div>
    <div class="pi-tb-center">
      <span class="pi-tb-title" id="pi-title-text"></span>
    </div>
    <div class="pi-tb-stats" id="pi-token-stats" title="Token 用量">
      <span class="pi-stat" id="pi-stat-ctx" title="上下文占用"></span>
      <span class="pi-stat" id="pi-stat-ft" title="首 token 延迟"></span>
      <span class="pi-stat" id="pi-stat-tps" title="输出速度"></span>
      <span class="pi-stat" id="pi-stat-cost" title="本次会话花费"></span>
    </div>
    <div class="pi-tb-right">
      <div class="pi-tb-actions">
        <button class="pi-icon-btn" id="pi-tb-new" title="新建会话 (Ctrl+N)">${svgIcon(ICONS.plus)}</button>
        <button class="pi-icon-btn" id="pi-tb-history" title="会话历史 (Ctrl+H)">${svgIcon(ICONS.history)}</button>
        <button class="pi-icon-btn" id="pi-tb-search" title="搜索会话 (Ctrl+F)">${svgIcon(ICONS.search)}</button>
        <button class="pi-icon-btn" id="pi-tb-refresh" title="重新加载会话">${svgIcon(ICONS.history)}</button>
        <button class="pi-icon-btn" id="pi-tb-export" title="导出当前会话">${svgIcon(ICONS.download)}</button>
        <button class="pi-icon-btn" id="pi-tb-settings" title="设置 (Ctrl+,)">${svgIcon(ICONS.gear)}</button>
      </div>
    </div>
  </header>
  <div class="pi-body">
    <div id="pi-sidebar-collapsed" style="
      display:none;flex-direction:column;align-items:center;padding-top:8px;gap:4px;
      width:40px;flex-shrink:0;background:#181818;border-right:1px solid #2a2a2a;
    ">
      <button id="pi-sidebar-expand" title="展开侧栏" style="
        background:none;border:none;color:#8a8a8a;cursor:pointer;padding:6px;
        border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
      ">»</button>
      <div style="width:20px;height:1px;background:#2a2a2a;margin:2px 0;"></div>
      <button id="pi-new-session-mini" title="新建会话" style="
        background:none;border:none;color:#8a8a8a;cursor:pointer;font-size:16px;padding:6px;
        border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
      ">+</button>
      <div style="flex:1;"></div>
      <button id="pi-open-settings-mini" title="设置" style="
        background:none;border:none;color:#8a8a8a;cursor:pointer;font-size:14px;padding:6px;
        border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
        margin-bottom:8px;
      ">⚙</button>
    </div>
    <aside id="pi-sidebar">
${SIDEBAR_HTML}
    </aside>
    <div id="pi-main"></div>
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
    // Keep title center clean — workspace path lives in sidebar only
    var titleEl = document.getElementById('pi-title-text');
    if (titleEl) titleEl.textContent = '';
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
  function onMsg(data) {
    if (!data) return;
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

  const configScript = `<script>window.__PI_HEAO_CONFIG__ = ${safeJson(config)}; window.__PI_STANDALONE_CONFIG__ = window.__PI_HEAO_CONFIG__; window.__PI_HOME__ = ${safeJson(home)};</script>`;

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
    lines.splice(headLineIdx, 0, THEME_CSS, CHROME_CSS, SHIM_SCRIPT, configScript);
  } else {
    // fallback: inject before last </body>
    const bodyIdx = html.lastIndexOf("</body>");
    if (bodyIdx !== -1) {
      html =
        html.slice(0, bodyIdx) +
        THEME_CSS +
        CHROME_CSS +
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
      allLines.splice(i, 0, REPARENT_SCRIPT, SIDEBAR_SCRIPT, TITLEBAR_SCRIPT, TOKENS_SCRIPT);
      break;
    }
  }

  return `<!-- Pi Heao GUI V0.1 · made by HEAOZIE -->\n${allLines.join("\n")}`;
}
