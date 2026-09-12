/**
 * Sessions sidebar injected into the pi-chat HTML.
 * Dark theme with high-contrast text. XSS-safe rendering.
 * Includes workspace picker + session filter.
 * Designed as a flex child of #pi-body (not position:fixed).
 */
export const SIDEBAR_HTML = `
<div class="pi-sidebar-inner" style="
  display:flex;flex-direction:column;height:100%;width:100%;
  font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  font-size:13px;color:#e0e0e0;
">
  <div style="padding:8px 12px 6px;display:flex;align-items:center;gap:8px;flex-shrink:0;">
    <span style="font-size:14px;color:#cccccc;font-weight:600;">π</span>
    <span style="font-weight:500;flex:1;color:#cccccc;font-size:12px;">会话</span>
    <button id="pi-sidebar-toggle" title="折叠侧栏" style="
      background:none;border:none;color:#8a8a8a;cursor:pointer;font-size:14px;padding:2px 6px;
      border-radius:4px;line-height:1;
    ">«</button>
  </div>
  <div style="padding:4px 10px 6px;flex-shrink:0;">
    <button id="pi-pick-workspace" title="选择工作目录" style="
      width:100%;padding:5px 10px;border-radius:5px;border:1px solid #3a3a3a;
      background:#2a2a2a;color:#aaa;cursor:pointer;font-size:11px;
      display:flex;align-items:center;gap:6px;text-align:left;
      overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
    ">
      <span style="flex-shrink:0;">📁</span>
      <span id="pi-workspace-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;">选择工作目录…</span>
    </button>
  </div>
  <div style="padding:0 10px 6px;flex-shrink:0;">
    <input id="pi-session-filter" type="text" placeholder="搜索会话…" style="
      width:100%;padding:5px 10px;border-radius:5px;border:1px solid #3a3a3a;
      background:#1e1e1e;color:#e0e0e0;font-size:11px;outline:none;
      box-sizing:border-box;
    " />
  </div>
  <div style="padding:0 10px 6px;flex-shrink:0;">
    <button id="pi-new-session" style="
      width:100%;padding:6px 12px;border-radius:6px;border:1px solid #0e639c;
      background:#0e639c;color:#fff;cursor:pointer;font-size:12px;font-weight:500;
      display:flex;align-items:center;justify-content:center;gap:6px;
    ">
      <span style="font-size:14px;">+</span> 新建会话
    </button>
  </div>
  <div id="pi-session-list" style="flex:1;overflow-y:auto;padding:0 6px 8px;min-height:0;"></div>
  <div style="padding:6px 10px;border-top:1px solid #2a2a2a;display:flex;gap:6px;flex-shrink:0;">
    <button id="pi-export-chat" title="导出对话为 Markdown" style="
      flex:1;padding:5px 8px;border-radius:5px;border:1px solid #3a3a3a;
      background:none;color:#9a9a9a;cursor:pointer;font-size:11px;
    ">⤓ 导出</button>
    <button id="pi-open-settings" style="
      flex:1;padding:5px 8px;border-radius:5px;border:1px solid #3a3a3a;
      background:none;color:#9a9a9a;cursor:pointer;font-size:11px;
    ">⚙ 设置</button>
  </div>
</div>
<style>
  #pi-sidebar .pi-session-item {
    padding:7px 10px;border-radius:5px;cursor:pointer;margin:1px 0;
    transition:background 0.12s;
  }
  #pi-sidebar .pi-session-item:hover { background:#2a2d2e; }
  #pi-sidebar .pi-session-item.active { background:#094771; }
  #pi-sidebar .pi-session-item .pi-session-name {
    font-size:12px;color:#e0e0e0;line-height:1.4;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  #pi-sidebar .pi-session-item .pi-session-time { font-size:10px;color:#6a6a6a;margin-top:2px; }
  #pi-sidebar .pi-session-item .pi-session-status {
    display:inline-block;width:6px;height:6px;border-radius:50%;
    background:#555;margin-right:6px;vertical-align:middle;flex-shrink:0;
  }
  #pi-sidebar .pi-session-item .pi-session-status.running { background:#4ec9b0; }
  #pi-sidebar .pi-session-empty { padding:20px 10px;text-align:center;color:#555;font-size:12px; }
  #pi-session-list::-webkit-scrollbar { width:5px; }
  #pi-session-list::-webkit-scrollbar-track { background:transparent; }
  #pi-session-list::-webkit-scrollbar-thumb { background:#3a3a3a;border-radius:3px; }
  #pi-session-filter:focus { border-color:#0e639c !important; }
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

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function shortenPath(p) {
    if (!p) return '选择工作目录…';
    var home = (window.__PI_HOME__ || '').replace(/\\\\/g, '/');
    var norm = String(p).replace(/\\\\/g, '/');
    if (home && norm.indexOf(home) === 0) return '~' + norm.slice(home.length);
    return p;
  }

  function setCollapsed(c) {
    // In shell layout: #pi-sidebar and #pi-sidebar-collapsed are siblings inside .pi-body
    if (sidebar) sidebar.style.display = c ? 'none' : 'flex';
    if (collapsed) collapsed.style.display = c ? 'flex' : 'none';
    try { localStorage.setItem('pi-sidebar-collapsed', c ? '1' : '0'); } catch(e) {}
  }

  var toggleBtn = document.getElementById('pi-sidebar-toggle');
  if (toggleBtn) toggleBtn.onclick = function() { setCollapsed(true); };
  var expandBtn = document.getElementById('pi-sidebar-expand');
  if (expandBtn) expandBtn.onclick = function() { setCollapsed(false); };

  // Restore collapse state
  try {
    if (localStorage.getItem('pi-sidebar-collapsed') === '1') setCollapsed(true);
  } catch(e) {}

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

  var newBtn = document.getElementById('pi-new-session');
  if (newBtn) newBtn.onclick = function() {
    if (window.pi) window.pi.postMessage({ type: 'newSession' });
  };
  var newMini = document.getElementById('pi-new-session-mini');
  if (newMini) newMini.onclick = function() {
    if (window.pi) window.pi.postMessage({ type: 'newSession' });
  };
  var settingsBtn = document.getElementById('pi-open-settings');
  if (settingsBtn) settingsBtn.onclick = function() {
    if (window.pi) window.pi.invoke('pi:open-settings');
  };
  var exportBtn = document.getElementById('pi-export-chat');
  if (exportBtn) exportBtn.onclick = function() {
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
  var settingsMini = document.getElementById('pi-open-settings-mini');
  if (settingsMini) settingsMini.onclick = function() {
    if (window.pi) window.pi.invoke('pi:open-settings');
  };

  // Session filter
  if (filterInput) {
    filterInput.addEventListener('input', function() {
      filterText = (filterInput.value || '').toLowerCase();
      renderSessions();
    });
  }

  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff/60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff/3600000) + ' 小时前';
    if (diff < 172800000) return '昨天';
    return (d.getMonth()+1) + '/' + d.getDate();
  }

  function renderSessions() {
    if (!listEl) return;
    listEl.innerHTML = '';
    var filtered = sessions;
    if (filterText) {
      filtered = sessions.filter(function(s) {
        var name = (s.name || s.sessionId || s.file || '').toLowerCase();
        return name.indexOf(filterText) !== -1;
      });
    }
    if (!filtered.length) {
      listEl.innerHTML = '<div class="pi-session-empty">' + (filterText ? '无匹配会话' : '暂无会话') + '</div>';
      return;
    }
    filtered.forEach(function(s) {
      var item = document.createElement('div');
      item.className = 'pi-session-item';
      item.setAttribute('data-session-id', s.sessionId || '');
      item.setAttribute('data-file', s.file || '');
      var statusCls = s.running ? 'running' : '';
      item.innerHTML =
        '<div style="display:flex;align-items:center;">' +
          '<span class="pi-session-status ' + statusCls + '"></span>' +
          '<span class="pi-session-name">' + esc(s.name || s.sessionId || '未命名') + '</span>' +
        '</div>' +
        '<div class="pi-session-time">' + esc(fmtTime(s.mtime)) + '</div>';
      item.onclick = function() {
        if (window.pi && s.file) {
          window.pi.postMessage({ type: 'switchSession', sessionFile: s.file });
        }
      };
      listEl.appendChild(item);
    });
  }

  // Listen for session list updates from main
  window.addEventListener('message', function(e) {
    var msg = e.data;
    if (!msg) return;
    if (msg.type === 'sessionsList' || msg.command === 'sessionsList') {
      sessions = msg.sessions || msg.payload || [];
      renderSessions();
    }
    if (msg.type === 'workspaceChanged') {
      if (wsLabel && msg.path) wsLabel.textContent = shortenPath(msg.path);
    }
  });

  // Request session list on load
  function requestSessions() {
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
  setInterval(requestSessions, 5000);

  // Drag & drop files
  document.addEventListener('dragover', function(e) { e.preventDefault(); });
  document.addEventListener('drop', function(e) {
    e.preventDefault();
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    var paths = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i].path) paths.push(files[i].path);
    }
    if (paths.length && window.pi) {
      window.pi.postMessage({ type: 'appendInput', text: paths.join('\\n') });
    }
  });
})();
</script>
`;
