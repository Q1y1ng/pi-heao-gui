/**
 * Sessions sidebar injected into the pi-chat HTML.
 * Dark theme with high-contrast text. XSS-safe rendering.
 * Includes workspace picker.
 */
export const SIDEBAR_HTML = `
<div id="pi-sidebar" style="
  position:fixed;left:0;top:0;bottom:0;width:240px;z-index:9999;
  background:#252526;border-right:1px solid #3c3c3c;
  display:flex;flex-direction:column;
  font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  font-size:13px;color:#e0e0e0;
">
  <div style="padding:10px 12px;border-bottom:1px solid #3c3c3c;display:flex;align-items:center;gap:8px;">
    <span style="font-size:16px;color:#cccccc;">π</span>
    <span style="font-weight:600;flex:1;color:#e8e8e8;font-size:12px;">Pi Standalone</span>
    <button id="pi-sidebar-toggle" title="折叠侧栏" style="
      background:none;border:none;color:#a0a0a0;cursor:pointer;font-size:14px;padding:2px 6px;
      border-radius:4px;line-height:1;
    ">«</button>
  </div>
  <div style="padding:6px 10px;border-bottom:1px solid #333;">
    <button id="pi-pick-workspace" title="选择工作目录" style="
      width:100%;padding:6px 10px;border-radius:5px;border:1px solid #444;
      background:#2a2a2a;color:#aaa;cursor:pointer;font-size:11px;
      display:flex;align-items:center;gap:6px;text-align:left;
      overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
    ">
      <span style="flex-shrink:0;">📁</span>
      <span id="pi-workspace-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;">选择工作目录…</span>
    </button>
  </div>
  <div style="padding:6px 10px;">
    <button id="pi-new-session" style="
      width:100%;padding:7px 12px;border-radius:6px;border:1px solid #4a4a4a;
      background:#333333;color:#e0e0e0;cursor:pointer;font-size:12px;font-weight:500;
      display:flex;align-items:center;justify-content:center;gap:6px;
    ">
      <span style="font-size:14px;">+</span> 新建会话
    </button>
  </div>
  <div id="pi-session-list" style="flex:1;overflow-y:auto;padding:0 6px 8px;"></div>
  <div style="padding:8px 10px;border-top:1px solid #3c3c3c;display:flex;gap:6px;">
    <button id="pi-export-chat" title="导出对话为 Markdown" style="
      flex:1;padding:6px 8px;border-radius:6px;border:1px solid #4a4a4a;
      background:none;color:#a0a0a0;cursor:pointer;font-size:11px;
    ">⤓ 导出</button>
    <button id="pi-open-settings" style="
      flex:1;padding:6px 8px;border-radius:6px;border:1px solid #4a4a4a;
      background:none;color:#a0a0a0;cursor:pointer;font-size:11px;
    ">⚙ 设置</button>
  </div>
</div>
<div id="pi-sidebar-collapsed" style="
  position:fixed;left:0;top:0;bottom:0;width:40px;z-index:9999;
  background:#252526;border-right:1px solid #3c3c3c;
  display:none;flex-direction:column;align-items:center;padding-top:10px;gap:4px;
  font-family:sans-serif;
">
  <button id="pi-sidebar-expand" title="展开侧栏" style="
    background:none;border:none;color:#a0a0a0;cursor:pointer;font-size:14px;padding:6px;
    border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  ">»</button>
  <div style="width:24px;height:1px;background:#3c3c3c;margin:2px 0;"></div>
  <button id="pi-new-session-mini" title="新建会话" style="
    background:none;border:none;color:#a0a0a0;cursor:pointer;font-size:16px;padding:6px;
    border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  ">+</button>
  <div style="flex:1;"></div>
  <button id="pi-open-settings-mini" title="设置" style="
    background:none;border:none;color:#a0a0a0;cursor:pointer;font-size:14px;padding:6px;
    border-radius:4px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;
    margin-bottom:10px;
  ">⚙</button>
</div>
<style>
  body.pi-sidebar-active { padding-left: 240px !important; }
  body.pi-sidebar-collapsed { padding-left: 40px !important; }
  #pi-sidebar .pi-session-item {
    padding:8px 10px;border-radius:5px;cursor:pointer;margin:1px 0;
    transition:background 0.12s;
  }
  #pi-sidebar .pi-session-item:hover { background:#2a2d2e; }
  #pi-sidebar .pi-session-item.active { background:#094771;border-left:2px solid #007acc; }
  #pi-sidebar .pi-session-item .pi-session-name {
    font-size:12px;color:#e0e0e0;line-height:1.4;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  #pi-sidebar .pi-session-item .pi-session-time { font-size:11px;color:#777;margin-top:2px; }
  #pi-sidebar .pi-session-item .pi-session-status {
    display:inline-block;width:6px;height:6px;border-radius:50%;
    background:#555;margin-right:6px;vertical-align:middle;flex-shrink:0;
  }
  #pi-sidebar .pi-session-item .pi-session-status.running { background:#4ec9b0; }
  #pi-sidebar .pi-session-empty { padding:20px 10px;text-align:center;color:#666;font-size:12px; }
  #pi-sidebar-collapsed button:hover { background:#2a2d2e;color:#e0e0e0; }
  #pi-session-list::-webkit-scrollbar { width:5px; }
  #pi-session-list::-webkit-scrollbar-track { background:transparent; }
  #pi-session-list::-webkit-scrollbar-thumb { background:#4a4a4a;border-radius:3px; }
</style>
`;

export const SIDEBAR_SCRIPT = `
<script>
(function() {
  var sidebar = document.getElementById('pi-sidebar');
  var collapsed = document.getElementById('pi-sidebar-collapsed');
  var listEl = document.getElementById('pi-session-list');
  var wsLabel = document.getElementById('pi-workspace-label');
  var currentFile = null;
  var sessions = [];

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

  // Workspace picker
  document.getElementById('pi-pick-workspace').onclick = function() {
    if (!window.pi) return;
    window.pi.invoke('pi:pick-workspace').then(function(dir) {
      if (dir) {
        wsLabel.textContent = shortenPath(dir);
        // Reload session with new cwd
        window.pi.invoke('pi:set-workspace', dir).then(function() {
          window.pi.postMessage({ type: 'reload' });
        });
      }
    });
  };

  document.getElementById('pi-new-session').onclick = function() {
    if (window.pi) window.pi.postMessage({ type: 'newSession' });
  };
  document.getElementById('pi-new-session-mini').onclick = function() {
    if (window.pi) window.pi.postMessage({ type: 'newSession' });
  };
  document.getElementById('pi-open-settings').onclick = function() {
    if (window.pi) window.pi.invoke('pi:open-settings');
  };
  document.getElementById('pi-export-chat').onclick = function() {
    if (!window.pi) return;
    window.pi.invoke('pi:export-conversation').then(function(path) {
      if (path) {
        // Show toast via the chat's toast system
        var toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = '已导出到: ' + path;
          toast.className = 'toast show success';
          setTimeout(function() { toast.className = 'toast'; }, 3000);
        }
      }
    });
  };
  document.getElementById('pi-open-settings-mini').onclick = function() {
    if (window.pi) window.pi.invoke('pi:open-settings');
  };

  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff/60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff/3600000) + ' 小时前';
    if (diff < 172800000) return '昨天';
    return d.toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'}) + ' ' +
           d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
  }

  function renderSessions() {
    listEl.innerHTML = '';
    if (!sessions.length) {
      var empty = document.createElement('div');
      empty.className = 'pi-session-empty';
      empty.textContent = '暂无会话';
      listEl.appendChild(empty);
      return;
    }
    sessions.forEach(function(s) {
      var item = document.createElement('div');
      item.className = 'pi-session-item' + (s.file === currentFile ? ' active' : '');
      var nameRow = document.createElement('div');
      nameRow.className = 'pi-session-name';
      var dot = document.createElement('span');
      dot.className = 'pi-session-status';
      nameRow.appendChild(dot);
      nameRow.appendChild(document.createTextNode(s.name || '未命名会话'));
      var timeRow = document.createElement('div');
      timeRow.className = 'pi-session-time';
      timeRow.textContent = fmtTime(s.mtime);
      item.appendChild(nameRow);
      item.appendChild(timeRow);
      item.title = (s.name || '') + '\\n' + s.file;
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

  function loadWorkspaceLabel() {
    if (!window.pi) return;
    window.pi.invoke('pi:get-config').then(function(cfg) {
      wsLabel.textContent = shortenPath(cfg.workspaceRoot || '');
    }).catch(function() {});
  }

  // Track current session from chat messages
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
  loadWorkspaceLabel();
  setInterval(loadSessions, 20000);

  // Drag & drop files onto window → insert @path into composer
  document.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    var input = document.getElementById('input');
    if (!input) return;
    var paths = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      // Electron exposes file.path
      if (f.path) paths.push('@' + f.path);
    }
    if (paths.length) {
      var text = paths.join(' ');
      // Insert at cursor or append
      input.focus();
      document.execCommand('insertText', false, text + ' ');
    }
  });
})();
</script>
`;
