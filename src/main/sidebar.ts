/**
 * Sessions sidebar injected into the pi-chat document.
 *
 * Owns the sidebar's look (the shell only sizes the container) and the session
 * list behaviour: grouping, filtering, pinning, switching, drag & drop.
 * All icons are inline SVG — no colour emoji, which clashes with a monochrome UI.
 */

const ICON = {
  brand: '<path d="M5 8h14"/><path d="M8 8v10"/><path d="M16 8v10"/>',
  collapse:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 10l-2 2 2 2"/>',
  expand:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M13 10l2 2-2 2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9Z"/>',
  export:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
};

function svg(paths: string, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const SIDEBAR_HTML = `
<div class="pi-sidebar-inner">
  <div id="pi-sidebar-header">
    <span class="pi-brand-tile">π</span>
    <span class="pi-brand-label">会话</span>
    <button id="pi-sidebar-toggle" title="折叠侧栏 (Ctrl+B)" aria-label="折叠侧栏">${svg(ICON.collapse, 15)}</button>
  </div>

  <button id="pi-pick-workspace" class="pi-ws-chip" title="选择工作目录">
    <span class="pi-ws-icon">${svg(ICON.folder, 14)}</span>
    <span id="pi-workspace-label">选择工作目录…</span>
  </button>

  <div class="pi-search">
    <span class="pi-search-icon">${svg(ICON.search, 13)}</span>
    <input id="pi-session-filter" type="text" placeholder="搜索会话…" spellcheck="false" aria-label="搜索会话" />
    <button id="pi-sidebar-archived-toggle" class="pi-search-btn" type="button"
      title="显示/隐藏已归档会话 (Ctrl+Shift+A)" aria-label="显示已归档会话">${svg(ICON.archive, 13)}</button>
  </div>

  <button id="pi-new-session" class="pi-btn-primary">
    <span>${svg(ICON.plus, 14)}</span><span>新建会话</span>
  </button>

  <div id="pi-session-list" role="list"></div>
  <div id="pi-archived-list" role="list" hidden></div>

  <div class="pi-sidebar-footer">
    <button id="pi-export-chat" class="pi-btn-ghost" title="导出对话为 Markdown">
      <span>${svg(ICON.export, 13)}</span><span>导出</span>
    </button>
    <button id="pi-open-settings" class="pi-btn-ghost" title="设置 (Ctrl+,)">
      <span>${svg(ICON.gear, 13)}</span><span>设置</span>
    </button>
  </div>
</div>
<style>
  /* ── Sidebar layout + look ─────────────────────────────────────────── */
  #pi-sidebar .pi-sidebar-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    padding: 0 8px 8px;
    box-sizing: border-box;
    font-family: var(--pi-font-ui);
    font-size: var(--pi-fs-md);
    color: var(--pi-text);
  }

  /* header row — the only draggable strip inside the sidebar */
  #pi-sidebar-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 2px 10px;
    flex-shrink: 0;
  }
  #pi-sidebar-header .pi-brand-tile {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: #0b0b0b;
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #fff;
    font-weight: 700;
    font-size: var(--pi-fs-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding-bottom: 1px;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  #pi-sidebar-header .pi-brand-label {
    flex: 1;
    font-size: var(--pi-fs-sm);
    font-weight: 600;
    letter-spacing: 0.3px;
    color: var(--pi-text);
  }
  #pi-sidebar-header button {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--pi-radius-sm);
    background: transparent;
    color: var(--pi-text-faint);
    cursor: pointer;
    transition: background var(--pi-speed), color var(--pi-speed);
  }
  #pi-sidebar-header button:hover {
    background: var(--pi-raised);
    color: var(--pi-text);
  }

  /* workspace chip */
  #pi-sidebar .pi-ws-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    margin-bottom: 8px;
    border-radius: var(--pi-radius);
    border: 1px solid var(--pi-border);
    background: var(--pi-raised);
    color: var(--pi-text-dim);
    font-size: var(--pi-fs-sm);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color var(--pi-speed), color var(--pi-speed), background var(--pi-speed);
    flex-shrink: 0;
  }
  #pi-sidebar .pi-ws-chip:hover {
    border-color: var(--pi-border-strong);
    background: var(--pi-overlay);
    color: var(--pi-text);
  }
  #pi-sidebar .pi-ws-chip .pi-ws-icon {
    display: inline-flex;
    color: var(--pi-accent);
    flex-shrink: 0;
  }
  #pi-sidebar .pi-ws-chip span:last-child {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* search */
  #pi-sidebar .pi-search {
    position: relative;
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    flex-shrink: 0;
  }
  #pi-sidebar .pi-search .pi-search-icon {
    position: absolute;
    left: 9px;
    display: inline-flex;
    color: var(--pi-text-faint);
    pointer-events: none;
  }
  #pi-sidebar #pi-session-filter {
    width: 100%;
    box-sizing: border-box;
    padding: 7px 9px 7px 30px;
    border-radius: var(--pi-radius);
    border: 1px solid var(--pi-border);
    background: var(--pi-bg);
    color: var(--pi-text);
    font-size: var(--pi-fs-sm);
    font-family: inherit;
    outline: none;
    transition: border-color var(--pi-speed), box-shadow var(--pi-speed);
  }
  #pi-sidebar #pi-session-filter::placeholder {
    color: var(--pi-text-faint);
  }
  #pi-sidebar #pi-session-filter:focus {
    border-color: var(--pi-accent) !important;
    box-shadow: var(--pi-ring);
  }

  /* primary action */
  #pi-sidebar .pi-btn-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    width: 100%;
    padding: 8px 12px;
    margin-bottom: 10px;
    border: 1px solid transparent;
    border-radius: var(--pi-radius);
    background: var(--pi-accent);
    color: #fff;
    font-size: var(--pi-fs-sm);
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
    transition: background var(--pi-speed), transform var(--pi-speed), box-shadow var(--pi-speed);
  }
  #pi-sidebar .pi-btn-primary:hover {
    background: var(--pi-accent-hover);
    box-shadow: 0 4px 14px rgba(76, 141, 255, 0.25);
  }
  #pi-sidebar .pi-btn-primary:active {
    transform: translateY(1px);
  }

  /* list */
  #pi-session-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 0 2px 6px;
    margin: 0 -2px;
  }
  #pi-sidebar .pi-group {
    padding: 10px 8px 5px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--pi-text-faint);
    user-select: none;
  }
  #pi-sidebar .pi-empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--pi-text-faint);
    font-size: var(--pi-fs-sm);
    line-height: 1.6;
  }

  #pi-sidebar .pi-session-item {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 9px 8px 11px;
    margin: 2px 0;
    border-radius: var(--pi-radius);
    border: 1px solid transparent;
    cursor: pointer !important;
    pointer-events: auto !important;
    transition: background var(--pi-speed), border-color var(--pi-speed);
  }
  #pi-sidebar .pi-session-item:hover {
    background: var(--pi-raised);
    border-color: var(--pi-border);
  }
  #pi-sidebar .pi-session-item.active {
    background: var(--pi-accent-soft);
    border-color: rgba(76, 141, 255, 0.4);
  }
  #pi-sidebar .pi-session-item.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 2px;
    background: var(--pi-accent);
  }
  #pi-sidebar .pi-session-dot {
    width: 6px;
    height: 6px;
    margin-top: 6px;
    border-radius: 50%;
    background: var(--pi-border-strong);
    flex-shrink: 0;
  }
  #pi-sidebar .pi-session-dot.running {
    background: var(--pi-success);
    box-shadow: 0 0 0 3px rgba(53, 192, 139, 0.16);
  }
  #pi-sidebar .pi-session-main {
    flex: 1;
    min-width: 0;
  }
  #pi-sidebar .pi-session-name {
    font-size: var(--pi-fs-sm);
    color: var(--pi-text);
    line-height: 1.45;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #pi-sidebar .pi-session-item.active .pi-session-name {
    /* Was a hardcoded #fff: on the light theme the active row's background is a pale
       accent wash, so white on it was unreadable. */
    color: var(--pi-text);
  }
  #pi-sidebar .pi-session-time {
    margin-top: 1px;
    font-size: 10.5px;
    color: var(--pi-text-faint);
  }
  #pi-sidebar .pi-pin-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border: none;
    border-radius: var(--pi-radius-sm);
    background: transparent;
    color: var(--pi-text-faint);
    cursor: pointer !important;
    opacity: 0;
    flex-shrink: 0;
    transition: opacity var(--pi-speed), color var(--pi-speed), background var(--pi-speed);
  }
  #pi-sidebar .pi-pin-btn svg {
    fill: none;
  }
  #pi-sidebar .pi-session-item:hover .pi-pin-btn {
    opacity: 0.6;
  }
  #pi-sidebar .pi-pin-btn:hover {
    opacity: 1 !important;
    background: var(--pi-overlay);
    color: var(--pi-warn);
  }
  #pi-sidebar .pi-session-item.pinned .pi-pin-btn {
    opacity: 1;
    color: var(--pi-warn);
  }
  #pi-sidebar .pi-session-item.pinned .pi-pin-btn svg {
    fill: var(--pi-warn);
  }

  #pi-sidebar .pi-session-item.loading {
    background: var(--pi-raised);
    border-color: var(--pi-border-strong);
  }
  #pi-sidebar .pi-session-item.loading .pi-session-dot {
    background: var(--pi-accent);
    animation: pi-pulse 900ms ease-in-out infinite;
  }
  @keyframes pi-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.25;
    }
  }
  .pi-tb-title.is-loading {
    color: var(--pi-accent) !important;
    animation: pi-pulse 1200ms ease-in-out infinite;
  }

  /* footer */
  #pi-sidebar .pi-sidebar-footer {
    display: flex;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--pi-border);
    flex-shrink: 0;
  }
  #pi-sidebar .pi-btn-ghost {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--pi-border);
    border-radius: var(--pi-radius);
    background: transparent;
    color: var(--pi-text-dim);
    font-size: var(--pi-fs-sm);
    font-family: inherit;
    cursor: pointer;
    transition: background var(--pi-speed), color var(--pi-speed), border-color var(--pi-speed);
  }
  #pi-sidebar .pi-btn-ghost:hover {
    background: var(--pi-raised);
    border-color: var(--pi-border-strong);
    color: var(--pi-text);
  }

  #pi-session-list::-webkit-scrollbar {
    width: 8px;
  }
  #pi-session-list::-webkit-scrollbar-thumb {
    background: #3a414d80;
    border: 2px solid transparent;
    background-clip: content-box;
    border-radius: 999px;
  }
  #pi-session-list::-webkit-scrollbar-thumb:hover {
    background: #4a5361cc;
    background-clip: content-box;
  }
  #pi-sidebar .pi-search-btn {
    background: none; border: 1px solid transparent; color: var(--pi-text-faint);
    cursor: pointer; padding: 3px; border-radius: 5px; display: flex; align-items: center;
    flex: none;
  }
  #pi-sidebar .pi-search-btn:hover { color: var(--pi-text); background: var(--pi-raised); }
  #pi-sidebar .pi-search-btn.active {
    color: var(--pi-accent); border-color: var(--pi-border); background: var(--pi-accent-soft);
  }
  #pi-sidebar .pi-session-item.kb { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
  #pi-sidebar .pi-session-item.archived { opacity: 0.82; }
  #pi-archived-list { padding: 0 6px 6px; }
  #pi-sidebar .pi-restore-btn {
    margin-left: auto; flex: none; font-size: 10px; padding: 1px 7px;
    background: var(--pi-raised); color: var(--pi-text-dim);
    border: 1px solid var(--pi-border); border-radius: 999px; cursor: pointer;
  }
  #pi-sidebar .pi-restore-btn:hover { color: var(--pi-text); border-color: var(--pi-border-strong); }
  #pi-archived-list .pi-archived-empty { font-size: var(--pi-fs-xs); color: var(--pi-text-faint); padding: 4px 10px 8px; }
  .pi-ctx-item.danger { color: var(--pi-danger); }
  .pi-ctx-hint { margin-left: auto; color: var(--pi-text-faint); font-size: 10px; padding-left: 12px; }
  .pi-prompt-backdrop {
    position: fixed; inset: 0; z-index: 5000; display: flex; align-items: center;
    justify-content: center; background: rgba(0, 0, 0, 0.45);
  }
  .pi-prompt {
    width: min(420px, 88vw); background: var(--pi-surface); color: var(--pi-text);
    border: 1px solid var(--pi-border-strong); border-radius: var(--pi-radius-lg);
    box-shadow: var(--pi-shadow-2); padding: 16px;
  }
  .pi-prompt-title { font-size: var(--pi-fs-md); font-weight: 600; margin-bottom: 10px; }
  .pi-prompt-input {
    width: 100%; box-sizing: border-box; background: var(--pi-raised); color: var(--pi-text);
    border: 1px solid var(--pi-border-strong); border-radius: var(--pi-radius-sm);
    padding: 8px 10px; font-family: var(--pi-font-ui); font-size: var(--pi-fs-md); outline: none;
  }
  .pi-prompt-input:focus { border-color: var(--pi-accent); box-shadow: var(--pi-ring); }
  .pi-prompt-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .pi-prompt-btn {
    font-family: inherit; font-size: var(--pi-fs-sm); padding: 6px 14px; border-radius: var(--pi-radius-sm);
    background: var(--pi-raised); color: var(--pi-text); border: 1px solid var(--pi-border); cursor: pointer;
  }
  .pi-prompt-btn.primary { background: var(--pi-accent); color: #ffffff; border-color: var(--pi-accent); }
  .pi-prompt-btn:hover { filter: brightness(1.08); }
</style>
`;

export const SIDEBAR_SCRIPT = `
<script>
(function() {
  var sidebar = document.getElementById('pi-sidebar');
  var collapsed = document.getElementById('pi-sidebar-collapsed');
  var listEl = document.getElementById('pi-session-list');
  var wsLabel = document.getElementById('pi-workspace-label');
  var filterInput = document.getElementById('pi-session-filter');
  var currentFile = null;
  var sessions = [];
  var filterText = '';
  /** Guards against queuing a second switch while pi is still loading one
   *  (a multi-MB session takes tens of seconds to parse). */
  var switching = false;

  var STAR_OUTLINE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9Z"/></svg>';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function showToast(text) {
    var toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = text;
      toast.className = 'toast show error';
      setTimeout(function() { toast.className = 'toast'; }, 3000);
    } else {
      console.warn('[toast]', text);
    }
  }

  /**
   * Session switching is a blocking RPC: a multi-MB session file takes tens of
   * seconds inside pi before anything comes back. Showing progress there is the
   * difference between "nothing happened" and "it's working".
   */
  /**
   * Mirror the active session's name into the shell title bar.
   *
   * chat-session posts sessionInfo once, and at that moment cwd / sessionName can both be
   * unset (a restored session hydrates later), so the label arrives empty and the title
   * sits on its "no session" placeholder for the whole session. The list this sidebar
   * renders already has the name, so the title reads from the same place the user does.
   */
  function mirrorTitle() {
    var el = document.getElementById('pi-title-text');
    if (!el) return;
    if (el.classList.contains('is-loading')) return;   // an in-flight switch owns the title
    var active = document.querySelector('#pi-session-list .pi-session-item.active');
    var name = active ? (active.querySelector('.pi-session-name') || {}).textContent : '';
    name = (name || '').trim();
    if (name) {
      el.textContent = name;
      el.classList.remove('is-empty');
    } else {
      el.textContent = '';
      el.classList.add('is-empty');
    }
  }

  function setTitleLoading(text) {
    var el = document.getElementById('pi-title-text');
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.remove('is-empty');
      el.classList.add('is-loading');
    } else {
      // Clearing has to wipe the text, not just the class. It used to only remove
      // is-loading, so a finished load left "载入会话…" on screen forever — the spinner
      // stopped but the sentence did not, which reads as a load that never completed.
      // The real title arrives later from the sessionInfo/state messages and overwrites
      // this; when no session is active an empty title is the honest state.
      el.textContent = '';
      el.classList.add('is-empty');
      el.classList.remove('is-loading');
    }
  }

  /** Keep the tail visible: the deepest folder is the useful part of a path. */
  function elidePath(p, max) {
    if (!p || p.length <= max) return p;
    var head = p.slice(0, 10);
    var tail = p.slice(-(max - 11));
    return head + '…' + tail;
  }

  function shortenPath(p) {
    if (!p) return '选择工作目录…';
    var home = (window.__PI_HOME__ || '').replace(/\\\\/g, '/');
    var norm = String(p).replace(/\\\\/g, '/');
    var short = (home && norm.indexOf(home) === 0) ? '~' + norm.slice(home.length) : p;
    return elidePath(short, 34);
  }

  function setCollapsed(c) {
    if (sidebar) sidebar.style.display = c ? 'none' : 'flex';
    if (collapsed) collapsed.style.display = c ? 'flex' : 'none';
    try { localStorage.setItem('pi-sidebar-collapsed', c ? '1' : '0'); } catch (e) {}
  }

  var toggleBtn = document.getElementById('pi-sidebar-toggle');
  if (toggleBtn) toggleBtn.onclick = function() { setCollapsed(true); };
  var expandBtn = document.getElementById('pi-sidebar-expand');
  if (expandBtn) expandBtn.onclick = function() { setCollapsed(false); };

  try {
    if (localStorage.getItem('pi-sidebar-collapsed') === '1') setCollapsed(true);
  } catch (e) {}

  // Workspace picker
  var pickBtn = document.getElementById('pi-pick-workspace');
  if (pickBtn) pickBtn.onclick = function() {
    if (!window.pi) return;
    window.pi.invoke('pi:pick-workspace').then(function(dir) {
      if (dir) {
        if (wsLabel) wsLabel.textContent = shortenPath(dir);
        window.pi.invoke('pi:set-workspace', dir).then(function() {
          window.pi.postMessage({ type: 'reload' });
        });
      }
    });
  };

  function wire(id, fn) {
    var el = document.getElementById(id);
    if (el) el.onclick = fn;
  }
  wire('pi-new-session', function() { if (window.pi) window.pi.postMessage({ type: 'newSession' }); });
  wire('pi-new-session-mini', function() { if (window.pi) window.pi.postMessage({ type: 'newSession' }); });
  wire('pi-open-settings', function() { if (window.pi) window.pi.invoke('pi:open-settings'); });
  wire('pi-open-settings-mini', function() { if (window.pi) window.pi.invoke('pi:open-settings'); });
  wire('pi-export-chat', function() {
    if (!window.pi) return;
    window.pi.invoke('pi:export-conversation').then(function(path) {
      if (!path) return;
      var toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = '已导出到: ' + path;
        toast.className = 'toast show success';
        setTimeout(function() { toast.className = 'toast'; }, 3000);
      }
    });
  });

  if (filterInput) {
    filterInput.addEventListener('input', function() {
      filterText = (filterInput.value || '').toLowerCase();
      renderSessions();
    });
    filterInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { filterInput.value = ''; filterText = ''; renderSessions(); }
    });
  }

  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var diff = Date.now() - d.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 172800000) return '昨天';
    return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function groupOf(s) {
    if (s.pinned) return '置顶';
    var diff = Date.now() - (s.mtime || 0);
    if (diff < 86400000) return '今天';
    if (diff < 172800000) return '昨天';
    if (diff < 604800000) return '本周';
    return '更早';
  }

  function itemEl(s, idx) {
    var item = document.createElement('div');
    item.className = 'pi-session-item' + (s.pinned ? ' pinned' : '') + (s.file === currentFile ? ' active' : '');
    item.setAttribute('data-idx', String(idx));
    item.setAttribute('data-file', s.file || '');
    item.setAttribute('role', 'listitem');
    item.innerHTML =
      '<span class="pi-session-dot' + (s.running ? ' running' : '') + '"></span>' +
      '<div class="pi-session-main">' +
        '<div class="pi-session-name" title="' + esc(s.name || s.sessionId || '未命名') + '">' +
          esc(s.name || s.sessionId || '未命名') +
        '</div>' +
        '<div class="pi-session-time">' + esc(fmtTime(s.mtime)) + '</div>' +
      '</div>' +
      '<button class="pi-pin-btn" data-pin="1" title="' + (s.pinned ? '取消置顶' : '置顶') + '" aria-label="置顶">' +
        STAR_OUTLINE +
      '</button>';
    return item;
  }

  function renderSessions() {
    if (!listEl) return;
    listEl.innerHTML = '';
    var filtered = sessions;
    if (filterText) {
      filtered = sessions.filter(function(s) {
        return ((s.name || '') + ' ' + (s.sessionId || '') + ' ' + (s.file || '')).toLowerCase().indexOf(filterText) !== -1;
      });
    }
    if (!filtered.length) {
      var empty = document.createElement('div');
      empty.className = 'pi-empty';
      empty.textContent = filterText ? '没有匹配的会话' : '还没有会话\\n点击「新建会话」开始';
      empty.style.whiteSpace = 'pre-line';
      listEl.appendChild(empty);
      return;
    }
    var lastGroup = '';
    filtered.forEach(function(s, idx) {
      if (!filterText) {
        var g = groupOf(s);
        if (g !== lastGroup) {
          var head = document.createElement('div');
          head.className = 'pi-group';
          head.textContent = g;
          listEl.appendChild(head);
          lastGroup = g;
        }
      }
      listEl.appendChild(itemEl(s, idx));
    });
  }

  // Event delegation — survives re-renders
  if (listEl) {
    listEl.addEventListener('click', function(e) {
      var pinBtn = e.target.closest ? e.target.closest('.pi-pin-btn') : null;
      var item = e.target.closest ? e.target.closest('.pi-session-item') : null;
      if (!item) return;
      var file = item.getAttribute('data-file') || '';
      if (pinBtn) {
        e.stopPropagation();
        if (window.pi && file) window.pi.invoke('pi:toggle-pin', file).then(function() { requestSessions(); });
        return;
      }
      if (!file) return;
      if (!window.pi) { showToast('桥接未就绪'); return; }
      if (switching) return;
      switching = true;
      setTitleLoading('载入会话…');
      var prev = listEl.querySelector('.pi-session-item.active');
      if (prev) prev.classList.remove('active');
      item.classList.add('active', 'loading');
      currentFile = file;
      listEl.classList.add('is-loading');
      var settle = function(ok) {
        switching = false;
        item.classList.remove('loading');
        listEl.classList.remove('is-loading');
        if (!ok) item.classList.remove('active');
        // Reset on success too. This used to be inside the failure branch, so a session
        // that loaded fine left the sidebar title stuck on "载入会话…" with its spinner
        // still turning — a status that outlived the thing it reported.
        setTitleLoading('');
        // After the switch resolves, mirror the freshly active row's name into the title.
        // Called from the click path it was useless: setTitleLoading had just set is-loading,
        // and mirrorTitle returns early in that state. Guarded so a cosmetic failure can
        // never affect the switch that already succeeded.
        try { mirrorTitle(); } catch (err) { /* title only */ }
      };
      window.pi.invoke('pi:switch-session', { type: 'switchSession', sessionFile: file })
        .then(function(r) {
          if (r && r.ok === false) {
            showToast('切换失败: ' + (r.error || '未知错误'));
            settle(false);
          } else {
            settle(true);
            requestSessions();
          }
        })
        .catch(function(err) {
          showToast('切换出错: ' + (err && err.message || err));
          settle(false);
        });
    });
    listEl.addEventListener('contextmenu', function(e) {
      var item = e.target.closest ? e.target.closest('.pi-session-item') : null;
      if (!item) return;
      e.preventDefault();
      var file = item.getAttribute('data-file') || '';
      var s = sessions.filter(function(x) { return x.file === file; })[0] || { file: file };
      showContextMenu(e.clientX, e.clientY, s);
    });
  }

  // Context menu
  var ctxMenu = null;
  function hideContextMenu() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }
  function showContextMenu(x, y, s) {
    hideContextMenu();
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'pi-ctx';
    var items = [
      { label: s.pinned ? '取消置顶' : '置顶', action: function() {
        if (window.pi) window.pi.invoke('pi:toggle-pin', s.file).then(function() { requestSessions(); });
      }},
      { label: '重命名…', hint: 'F2', action: function() { startRename(s.file); }},
      { label: '在新窗口打开', action: function() {
        if (window.pi) window.pi.invoke('pi:open-session-window', s.file);
      }},
    ];
    if (s.archived) {
      items.push({ label: '恢复到会话列表', action: function() { restoreSession(s.file); }});
    } else {
      items.push({ label: '归档（从列表隐藏）', action: function() { archiveSession(s.file); }});
    }
    items.push({ label: '复制会话路径', action: function() {
      if (window.pi) window.pi.invoke('pi:copy', s.file);
    }});
    items.push({ label: '删除…', hint: 'Del', danger: true, action: function() { confirmDelete(s.file); }});

    items.forEach(function(it) {
      var el = document.createElement('div');
      el.className = 'pi-ctx-item' + (it.danger ? ' danger' : '');
      el.textContent = it.label;
      if (it.hint) {
        var hint = document.createElement('span');
        hint.className = 'pi-ctx-hint';
        hint.textContent = it.hint;
        el.appendChild(hint);
      }
      el.onclick = function() { hideContextMenu(); it.action(); };
      ctxMenu.appendChild(el);
    });
    document.body.appendChild(ctxMenu);
    var mw = 200, mh = items.length * 32 + 10;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 4;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  }
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('contextmenu', function(e) {
    if (!e.target.closest || !e.target.closest('.pi-session-item')) hideContextMenu();
  });

  // ── Session operations (rename / archive / restore / delete) ─────────
  function sessionOp(op, file, name) {
    if (!window.pi) return Promise.resolve(null);
    return window.pi.invoke('pi:session-op', { op: op, file: file, name: name }).then(function(res) {
      if (res && res.ok === false) showToast(res.error || '操作失败');
      requestSessions();
      return res;
    }).catch(function(err) {
      showToast('操作失败: ' + ((err && err.message) || err));
      return null;
    });
  }
  function startRename(file) {
    var s = sessions.filter(function(x) { return x.file === file; })[0] || { file: file, name: '' };
    askName(s.name || '', function(name) { sessionOp('rename', file, name); });
  }
  function archiveSession(file) { sessionOp('archive', file); }
  function restoreSession(file) { sessionOp('restore', file); }
  function confirmDelete(file) {
    if (!window.confirm('删除该会话文件？此操作不可撤销。')) return;
    sessionOp('delete', file);
  }

  /** Electron has no window.prompt(), so the rename dialog is built here. */
  function askName(initial, done) {
    var wrap = document.createElement('div');
    wrap.className = 'pi-prompt-backdrop';
    var card = document.createElement('div');
    card.className = 'pi-prompt';
    var title = document.createElement('div');
    title.className = 'pi-prompt-title';
    title.textContent = '重命名会话';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'pi-prompt-input';
    input.value = initial || '';
    var actions = document.createElement('div');
    actions.className = 'pi-prompt-actions';
    var cancel = document.createElement('button');
    cancel.className = 'pi-prompt-btn';
    cancel.textContent = '取消';
    var ok = document.createElement('button');
    ok.className = 'pi-prompt-btn primary';
    ok.textContent = '确定';
    actions.appendChild(cancel);
    actions.appendChild(ok);
    card.appendChild(title);
    card.appendChild(input);
    card.appendChild(actions);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    setTimeout(function() { input.focus(); input.select(); }, 0);
    function finish(accept) {
      var value = input.value.trim();
      wrap.remove();
      if (accept && value) done(value);
    }
    ok.onclick = function() { finish(true); };
    cancel.onclick = function() { finish(false); };
    wrap.addEventListener('click', function(e) { if (e.target === wrap) finish(false); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  // ── Archived sessions ────────────────────────────────────────────────
  var archivedEl = document.getElementById('pi-archived-list');
  var archivedBtn = document.getElementById('pi-sidebar-archived-toggle');
  var archivedVisible = false;
  try { archivedVisible = localStorage.getItem('pi-archived') === '1'; } catch (e) { archivedVisible = false; }

  function renderArchived(items) {
    if (!archivedEl) return;
    archivedEl.hidden = !archivedVisible;
    if (archivedBtn) archivedBtn.classList.toggle('active', archivedVisible);
    if (!archivedVisible) { archivedEl.innerHTML = ''; return; }
    if (!items.length) {
      archivedEl.innerHTML = '<div class="pi-group-head">已归档</div><div class="pi-archived-empty">没有已归档会话</div>';
      return;
    }
    archivedEl.innerHTML = '<div class="pi-group-head">已归档 · ' + items.length + '</div>' + items.map(function(s) {
      return '<div class="pi-session-item archived" data-file="' + esc(s.file) + '" title="' + esc(s.file) + '">' +
        '<span class="pi-session-dot"></span>' +
        '<span class="pi-session-name">' + esc(s.name || s.file) + '</span>' +
        '<button class="pi-restore-btn" data-restore="' + esc(s.file) + '" title="恢复到会话列表">恢复</button>' +
        '</div>';
    }).join('');
  }

  function refreshArchived() {
    if (!archivedEl || !window.pi) return;
    if (!archivedVisible) { renderArchived([]); return; }
    window.pi.invoke('pi:list-archived').then(function(list) {
      renderArchived(Array.isArray(list) ? list : []);
    }).catch(function() { renderArchived([]); });
  }

  function toggleArchived() {
    archivedVisible = !archivedVisible;
    try { localStorage.setItem('pi-archived', archivedVisible ? '1' : '0'); } catch (e) { /* private mode */ }
    renderArchived([]);
    refreshArchived();
  }

  if (archivedBtn) archivedBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleArchived(); });
  if (archivedEl) {
    archivedEl.addEventListener('click', function(e) {
      var restoreBtn = e.target.closest ? e.target.closest('.pi-restore-btn') : null;
      if (restoreBtn) {
        e.stopPropagation();
        restoreSession(restoreBtn.getAttribute('data-restore') || '');
        return;
      }
      var row = e.target.closest ? e.target.closest('.pi-session-item') : null;
      if (!row || !window.pi) return;
      var file = row.getAttribute('data-file') || '';
      if (!file || switching) return;
      switching = true;
      setTitleLoading('载入会话…');
      window.pi.invoke('pi:switch-session', { type: 'switchSession', sessionFile: file }).then(function() {
        switching = false;
        currentFile = file;
        setTitleLoading('');   // 这条路径此前成功、失败都不复位，标题就永久停在“载入会话…”
        requestSessions();
      }).catch(function(err) {
        switching = false;
        setTitleLoading('');
        showToast('切换出错: ' + ((err && err.message) || err));
      });
    });
  }

  // ── Keyboard navigation over the session list ────────────────────────
  var kbIndex = -1;
  function rows() {
    return listEl ? Array.prototype.slice.call(listEl.querySelectorAll('.pi-session-item')) : [];
  }
  function focusRow(target) {
    var all = rows();
    if (!all.length) return;
    var next = Math.max(0, Math.min(all.length - 1, target));
    all.forEach(function(r) { r.classList.remove('kb'); });
    all[next].classList.add('kb');
    all[next].scrollIntoView({ block: 'nearest' });
    kbIndex = next;
  }
  document.addEventListener('keydown', function(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      toggleArchived();
      return;
    }
    var tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (mod || e.altKey) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(kbIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(kbIndex - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
    else if (e.key === 'End') { e.preventDefault(); focusRow(rows().length - 1); }
    else if (e.key === 'Enter') {
      var row = rows()[kbIndex];
      if (row) { e.preventDefault(); row.click(); }
    } else if (e.key === 'F2') {
      var r2 = rows()[kbIndex];
      if (r2) { e.preventDefault(); startRename(r2.getAttribute('data-file') || ''); }
    } else if (e.key === 'Delete') {
      var r3 = rows()[kbIndex];
      if (r3) { e.preventDefault(); confirmDelete(r3.getAttribute('data-file') || ''); }
    }
  });

  // main -> renderer messages
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg) return;
    if (msg.type === 'sessionsList' || msg.command === 'sessionsList') {
      sessions = msg.sessions || msg.payload || [];
      renderSessions();
    }
    if (msg.type === 'workspaceChanged' && wsLabel && msg.path) {
      wsLabel.textContent = shortenPath(msg.path);
    }
  });

  function requestSessions() {
    refreshArchived();
    if (window.pi && window.pi.invoke) {
      window.pi.invoke('pi:list-sessions').then(function(list) {
        if (Array.isArray(list)) {
          sessions = list;
          renderSessions();
        }
      }).catch(function() {});
    }
  }
  requestSessions();
  // The main process caches parsed metadata, but there is no reason to poll often
  // — refresh on demand, on focus, and every 15s as a safety net.
  setInterval(requestSessions, 15000);
  window.addEventListener('focus', requestSessions);

  // Drag & drop files -> composer
  function dragAndDropFiles(files) {
    var paths = [];
    for (var i = 0; i < files.length; i++) {
      var p = '';
      try { p = window.pi && window.pi.getPathForFile ? window.pi.getPathForFile(files[i]) : ''; } catch (e) { p = ''; }
      if (p) paths.push(p);
    }
    if (paths.length && window.pi) {
      window.pi.postMessage({ type: 'appendInput', text: paths.join('\\\\n') });
    } else if (files.length) {
      showToast('无法解析拖入文件的路径');
    }
  }
  document.addEventListener('dragover', function(e) { e.preventDefault(); });
  document.addEventListener('drop', function(e) {
    e.preventDefault();
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) dragAndDropFiles(files);
  });
})();
</script>
<style>
  /* context menu (rendered on document.body, outside the sidebar) */
  .pi-ctx {
    position: fixed;
    z-index: 10000;
    min-width: 168px;
    padding: 4px;
    border: 1px solid var(--pi-border-strong);
    border-radius: var(--pi-radius);
    background: var(--pi-overlay);
    box-shadow: var(--pi-shadow-2);
    font-family: var(--pi-font-ui);
    font-size: var(--pi-fs-sm);
    color: var(--pi-text);
  }
  .pi-ctx-item {
    padding: 6px 10px;
    border-radius: var(--pi-radius-sm);
    cursor: pointer;
  }
  .pi-ctx-item:hover {
    background: var(--pi-accent-soft);
    color: #fff;
  }
</style>
`;
