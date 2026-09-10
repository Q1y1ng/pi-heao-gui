/**
 * Sessions sidebar injected into the pi-chat HTML.
 * Provides: session list, new session, switch, rename indicator.
 */
export const SIDEBAR_HTML = `
<div id="pi-sidebar" style="
  position:fixed;left:0;top:0;bottom:0;width:240px;z-index:9999;
  background:#1a1a1a;border-right:1px solid #333;
  display:flex;flex-direction:column;
  font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  font-size:13px;color:#ccc;
">
  <div style="padding:12px 14px;border-bottom:1px solid #333;display:flex;align-items:center;gap:8px;">
    <span style="font-size:18px;opacity:0.7;">π</span>
    <span style="font-weight:500;flex:1;">Pi Standalone</span>
    <button id="pi-sidebar-toggle" title="折叠侧栏" style="
      background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:2px 6px;
    ">«</button>
  </div>
  <div style="padding:8px 10px;">
    <button id="pi-new-session" style="
      width:100%;padding:7px 12px;border-radius:6px;border:1px solid #444;
      background:#2a2a2a;color:#ccc;cursor:pointer;font-size:12px;
      display:flex;align-items:center;justify-content:center;gap:6px;
    ">
      <span>+</span> 新建会话
    </button>
  </div>
  <div id="pi-session-list" style="flex:1;overflow-y:auto;padding:0 6px 10px;"></div>
  <div style="padding:8px 10px;border-top:1px solid #333;">
    <button id="pi-open-settings" style="
      width:100%;padding:6px 12px;border-radius:6px;border:1px solid #444;
      background:none;color:#888;cursor:pointer;font-size:12px;
    ">⚙ 设置</button>
  </div>
</div>
<div id="pi-sidebar-collapsed" style="
  position:fixed;left:0;top:0;bottom:0;width:36px;z-index:9999;
  background:#1a1a1a;border-right:1px solid #333;
  display:none;flex-direction:column;align-items:center;padding-top:12px;
  font-family:sans-serif;
">
  <button id="pi-sidebar-expand" title="展开侧栏" style="
    background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:4px;
  ">»</button>
  <button id="pi-new-session-mini" title="新建会话" style="
    background:none;border:none;color:#888;cursor:pointer;font-size:18px;padding:8px 4px;margin-top:8px;
  ">+</button>
</div>
<style>
  body.pi-sidebar-active { padding-left: 240px !important; }
  body.pi-sidebar-collapsed { padding-left: 36px !important; }
  #pi-sidebar .pi-session-item {
    padding:8px 10px;border-radius:6px;cursor:pointer;margin:2px 0;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    transition:background 0.15s;
  }
  #pi-sidebar .pi-session-item:hover { background:#2a2a2a; }
  #pi-sidebar .pi-session-item.active { background:#0e639c44;border-left:2px solid #0e639c; }
  #pi-sidebar .pi-session-item .pi-session-name { font-size:12px; }
  #pi-sidebar .pi-session-item .pi-session-time { font-size:10px;color:#666;margin-top:2px; }
  #pi-sidebar .pi-session-item .pi-session-status {
    display:inline-block;width:6px;height:6px;border-radius:50%;
    background:#555;margin-right:6px;vertical-align:middle;
  }
  #pi-sidebar .pi-session-item .pi-session-status.running { background:#4ec9b0; }
</style>
`;

export const SIDEBAR_SCRIPT = `
<script>
(function() {
  var sidebar = document.getElementById('pi-sidebar');
  var collapsed = document.getElementById('pi-sidebar-collapsed');
  var listEl = document.getElementById('pi-session-list');
  var currentFile = null;
  var sessions = [];

  function setCollapsed(c) {
    if (c) {
      sidebar.style.display = 'none';
      collapsed.style.display = 'flex';
      document.body.classList.remove('pi-sidebar-active');
      document.body.classList.add('pi-sidebar-collapsed');
    } else {
      sidebar.style.display = 'flex';
      collapsed.style.display = 'none';
      document.body.classList.add('pi-sidebar-active');
      document.body.classList.remove('pi-sidebar-collapsed');
    }
    try { localStorage.setItem('pi-sidebar-collapsed', c ? '1' : '0'); } catch(e) {}
  }

  document.getElementById('pi-sidebar-toggle').onclick = function() { setCollapsed(true); };
  document.getElementById('pi-sidebar-expand').onclick = function() { setCollapsed(false); };

  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff/60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff/3600000) + ' 小时前';
    return d.toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'}) + ' ' +
           d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
  }

  function renderSessions() {
    listEl.innerHTML = '';
    if (!sessions.length) {
      listEl.innerHTML = '<div style="padding:20px 10px;text-align:center;color:#555;font-size:12px;">暂无会话</div>';
      return;
    }
    sessions.forEach(function(s) {
      var item = document.createElement('div');
      item.className = 'pi-session-item' + (s.file === currentFile ? ' active' : '');
      item.innerHTML =
        '<div class="pi-session-name"><span class="pi-session-status"></span>' +
        (s.name || '未命名') + '</div>' +
        '<div class="pi-session-time">' + fmtTime(s.mtime) + '</div>';
      item.title = s.file;
      item.onclick = function() {
        if (s.file === currentFile) return;
        if (window.pi) window.pi.postMessage({ type: 'switchSession', sessionFile: s.file });
      };
      listEl.appendChild(item);
    });
  }

  function loadSessions() {
    if (!window.pi) return;
    window.pi.invoke('pi:list-sessions').then(function(list) {
      sessions = list || [];
      renderSessions();
    }).catch(function() {});
  }

  document.getElementById('pi-new-session').onclick = function() {
    if (window.pi) window.pi.postMessage({ type: 'newSession' });
  };
  document.getElementById('pi-new-session-mini').onclick = function() {
    if (window.pi) window.pi.postMessage({ type: 'newSession' });
  };
  document.getElementById('pi-open-settings').onclick = function() {
    if (window.pi) window.pi.invoke('pi:open-settings');
  };

  // Listen for sessionInfo to track current session
  if (window.pi) {
    var origOnMessage = window.pi.onMessage;
    // We need to intercept - the shim already sets a listener.
    // Instead, poll sessionInfo via a MutationObserver or override.
    // Simpler: watch for the sessionInfo message via a wrapper.
  }

  // Track current session file from sessionInfo messages
  var observer = new MutationObserver(function() {});
  // Use a periodic check: the chat updates sessionInfoEl text
  setInterval(function() {
    // Update active state if we know currentFile changed
    var items = listEl.querySelectorAll('.pi-session-item');
    // no-op placeholder
  }, 5000);

  // Listen for messages to track current session
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'sessionInfo' && d.sessionFile) {
      currentFile = d.sessionFile;
      renderSessions();
    }
    if (d.type === 'state' && d.state && d.state.sessionFile) {
      currentFile = d.state.sessionFile;
      renderSessions();
    }
    if (d.type === 'event' && d.event && (d.event.type === 'agent_settled' || d.event.type === 'agent_start')) {
      loadSessions();
    }
  });

  // Init
  var wasCollapsed = false;
  try { wasCollapsed = localStorage.getItem('pi-sidebar-collapsed') === '1'; } catch(e) {}
  setCollapsed(wasCollapsed);
  loadSessions();
  // Refresh session list periodically
  setInterval(loadSessions, 15000);
})();
</script>
`;
