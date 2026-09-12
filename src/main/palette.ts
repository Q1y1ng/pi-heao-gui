/**
 * Command palette (Ctrl+K) for the chat window.
 *
 * Three result groups in one list: sessions (name match from the session
 * lister), full-text hits inside session history, and app commands. Slash
 * commands known to pi are offered as "插入指令" entries.
 *
 * Everything is fetched through `window.pi.invoke`, because the injected scripts
 * share the window with pi-chat and its preload keeps a single message listener.
 */
export const PALETTE_HTML = `
<div class="pi-palette" id="pi-palette" hidden>
  <div class="pi-palette-card" role="dialog" aria-modal="true" aria-label="命令面板">
    <input id="pi-palette-input" class="pi-palette-input" type="text" spellcheck="false"
      placeholder="搜索会话、历史消息、命令…   (Enter 执行 · Esc 关闭 · Ctrl+Enter 仅搜会话名)" />
    <div class="pi-palette-list" id="pi-palette-list" role="listbox"></div>
    <div class="pi-palette-foot">
      <span><b>↑↓</b> 选择</span><span><b>Enter</b> 执行</span>
      <span><b>Tab</b> 分组</span><span id="pi-palette-status"></span>
    </div>
  </div>
</div>`;

export const PALETTE_SCRIPT = `
<script>
(function () {
  var root = document.getElementById('pi-palette');
  if (!root) return;
  var input = document.getElementById('pi-palette-input');
  var list = document.getElementById('pi-palette-list');
  var status = document.getElementById('pi-palette-status');

  var sessions = [];
  var commands = [];
  var items = [];
  var selection = 0;
  var searchToken = 0;
  var debounce = null;

  var ACTIONS = [
    { id: 'new', title: '新建会话', hint: 'Ctrl+N', keywords: 'new session 新 清空' },
    { id: 'settings', title: '打开设置', hint: 'Ctrl+,', keywords: 'settings 配置 模型 密钥' },
    { id: 'stats', title: 'Token 与性能统计', hint: 'Ctrl+Shift+S', keywords: 'token 统计 性能 ttft 速度 用量' },
    { id: 'export', title: '导出当前对话 (Markdown)', keywords: 'export 导出 md' },
    { id: 'workspace', title: '切换工作目录…', keywords: 'workspace cwd 目录 项目' },
    { id: 'reload', title: '重新加载会话 / 重启 agent', keywords: 'reload 重载 重启' },
    { id: 'sidebar', title: '折叠 / 展开侧栏', hint: 'Ctrl+B', keywords: 'sidebar 侧栏 折叠' },
    { id: 'theme', title: '切换深色 / 浅色主题', keywords: 'theme 主题 深色 浅色 亮色' },
    { id: 'diagnostics', title: '打开诊断信息', keywords: 'diagnostics 日志 log 诊断 反馈' },
    { id: 'archived', title: '显示 / 隐藏已归档会话', keywords: 'archive 归档 隐藏' },
  ];

  function fuzzy(needle, hay) {
    if (!needle) return true;
    var n = needle.toLowerCase();
    var h = (hay || '').toLowerCase();
    if (h.indexOf(n) >= 0) return true;
    // subsequence match (typing "stt" should find "统计统计"? keep it simple: initials)
    var i = 0;
    for (var c = 0; c < h.length && i < n.length; c++) if (h[c] === n[i]) i++;
    return i === n.length;
  }

  function show(msg) {
    hide();
    status.textContent = msg || '';
  }

  function render() {
    if (!items.length) {
      list.innerHTML = '<div class="pi-palette-empty">没有匹配项</div>';
      return;
    }
    list.innerHTML = items.map(function (it, i) {
      var active = i === selection ? ' active' : '';
      var sub = it.sub || '';
      return '<div class="pi-palette-item' + active + '" data-i="' + i + '" role="option">' +
        '<span class="pi-palette-kind pi-kind-' + (it.kind || 'cmd') + '">' + (it.badge || '') + '</span>' +
        '<span class="pi-palette-title">' + escapeHtml(it.title) + '</span>' +
        (sub ? '<span class="pi-palette-sub">' + escapeHtml(sub) + '</span>' : '') +
        (it.hint ? '<span class="pi-palette-hint">' + escapeHtml(it.hint) + '</span>' : '') +
        '</div>';
    }).join('');
    var el = list.querySelector('.pi-palette-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function build(query, contentHits) {
    var out = [];
    ACTIONS.forEach(function (a) {
      if (fuzzy(query, a.title + ' ' + (a.keywords || ''))) {
        out.push({ kind: 'cmd', badge: '命令', title: a.title, hint: a.hint, run: function () { runAction(a.id); } });
      }
    });
    commands.forEach(function (c) {
      var label = '/' + c.name;
      if (fuzzy(query, label + ' ' + (c.description || ''))) {
        out.push({
          kind: 'slash', badge: '指令', title: label, sub: c.description || '',
          run: function () {
            if (window.pi) window.pi.postMessage({ type: 'appendInput', text: label + ' ' });
          },
        });
      }
    });
    sessions.forEach(function (s) {
      if (fuzzy(query, s.name || s.file)) {
        out.push({
          kind: 'session', badge: '会话', title: s.name || s.file, sub: s.file,
          run: function () {
            if (window.pi) window.pi.invoke('pi:switch-session', { type: 'switchSession', sessionFile: s.file });
          },
        });
      }
    });
    (contentHits || []).forEach(function (h) {
      out.push({
        kind: 'hit', badge: h.role === 'user' ? '你' : 'AI',
        title: h.snippet, sub: h.sessionName + ' · 第 ' + h.lineNo + ' 行',
        run: function () {
          if (!window.pi) return;
          window.pi.invoke('pi:switch-session', { type: 'switchSession', sessionFile: h.file })
            .then(function () {
              // best-effort scroll to the first message containing the query
              var needle = input.value.trim().toLowerCase();
              setTimeout(function () {
                var nodes = document.querySelectorAll('.msg');
                for (var i = 0; i < nodes.length; i++) {
                  if (nodes[i].textContent.toLowerCase().indexOf(needle) >= 0) {
                    nodes[i].scrollIntoView({ block: 'center' });
                    nodes[i].classList.add('pi-hit-flash');
                    setTimeout(function () { nodes[i].classList.remove('pi-hit-flash'); }, 1600);
                    break;
                  }
                }
              }, 800);
            });
        },
      });
    });
    return out.slice(0, 60);
  }

  async function runAction(id) {
    var pi = window.pi;
    close();
    if (!pi) return;
    if (id === 'new') pi.postMessage({ type: 'newSession' });
    else if (id === 'settings') pi.invoke('pi:open-settings');
    else if (id === 'stats') window.__piStats && window.__piStats.open();
    else if (id === 'export') pi.invoke('pi:export-conversation');
    else if (id === 'workspace') {
      pi.invoke('pi:pick-workspace').then(function (dir) {
        if (dir) pi.invoke('pi:set-workspace', dir).then(function () { pi.postMessage({ type: 'reload' }); });
      });
    } else if (id === 'reload') pi.postMessage({ type: 'reload' });
    else if (id === 'sidebar') {
      var toggle = document.getElementById('pi-sidebar-toggle');
      if (toggle) toggle.click();
    } else if (id === 'theme') {
      var next = document.body.classList.contains('pi-light') ? 'dark' : 'light';
      if (window.__piApplyTheme) window.__piApplyTheme(next);
    } else if (id === 'diagnostics') pi.invoke('pi:open-settings', { tab: 'diagnostics' });
    else if (id === 'archived') {
      var ev = document.getElementById('pi-sidebar-archived-toggle');
      if (ev) ev.click();
    }
  }

  async function refreshData(query, withContent) {
    var pi = window.pi;
    if (!pi) return [];
    try {
      var s = await pi.invoke('pi:list-sessions');
      if (Array.isArray(s)) sessions = s;
    } catch (e) { /* ignore */ }
    if (!commands.length) {
      try {
        var c = await pi.invoke('pi:get-commands');
        if (Array.isArray(c)) commands = c;
      } catch (e) { /* ignore */ }
    }
    if (!withContent || query.trim().length < 2) return [];
    var token = ++searchToken;
    status.textContent = '搜索历史消息…';
    try {
      var res = await pi.invoke('pi:search-sessions', query);
      if (token !== searchToken) return [];
      status.textContent = res && res.hits ? res.hits.length + ' 条历史命中' : '';
      return (res && res.hits) || [];
    } catch (e) {
      status.textContent = '';
      return [];
    }
  }

  async function update(withContent) {
    var query = input.value.trim();
    var hits = await refreshData(query, withContent);
    items = build(query, hits);
    selection = 0;
    render();
  }

  function open() {
    root.hidden = false;
    input.value = '';
    input.focus();
    // Render the built-in commands immediately: the session list comes from the
    // main process and can take a moment on a large profile, and an empty list
    // for a second looks like the palette is broken.
    items = build('', []);
    selection = 0;
    render();
    void update(false);
  }
  function close() {
    root.hidden = true;
    status.textContent = '';
  }
  window.__piPalette = { open: open, close: close };

  input.addEventListener('input', function () {
    if (debounce) clearTimeout(debounce);
    // fast local filter immediately, content search after a pause
    var q = input.value.trim();
    items = build(q, []);
    selection = 0;
    render();
    debounce = setTimeout(function () { void update(true); }, 320);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selection = Math.min(items.length - 1, selection + 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selection = Math.max(0, selection - 1);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var it = items[selection];
      if (it && it.run) it.run();
      if (e.ctrlKey) close();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  list.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.pi-palette-item') : null;
    if (!row) return;
    var it = items[Number(row.getAttribute('data-i'))];
    if (it && it.run) it.run();
  });
  root.addEventListener('click', function (e) {
    if (e.target === root) close();
  });
  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (root.hidden) open(); else close();
      return;
    }
    // Escape closes from anywhere: focus can sit on a result row, not just the
    // input, and the input's own handler only fires while it has focus.
    if (e.key === 'Escape' && !root.hidden) {
      e.preventDefault();
      close();
    }
  });
})();
</script>`;

export const PALETTE_CSS = `
/* ── Command palette ────────────────────────────────────────────────── */
.pi-palette {
  position: fixed; inset: 0; z-index: 4100; display: flex;
  align-items: flex-start; justify-content: center; padding-top: 12vh;
  background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(2px);
}
.pi-palette[hidden] { display: none; }
.pi-palette-card {
  width: min(720px, 90vw); background: var(--pi-surface); color: var(--pi-text);
  border: 1px solid var(--pi-border-strong); border-radius: var(--pi-radius-lg);
  box-shadow: var(--pi-shadow-2); overflow: hidden; display: flex; flex-direction: column;
  max-height: 62vh;
}
.pi-palette-input {
  border: none; outline: none; background: var(--pi-raised); color: var(--pi-text);
  font-family: var(--pi-font-ui); font-size: 14px; padding: 14px 16px;
  border-bottom: 1px solid var(--pi-border);
}
.pi-palette-input::placeholder { color: var(--pi-text-faint); }
.pi-palette-list { overflow: auto; padding: 4px 0; }
.pi-palette-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 14px; cursor: pointer;
  font-size: 12.5px; border-left: 2px solid transparent;
}
.pi-palette-item.active { background: var(--pi-accent-soft); border-left-color: var(--pi-accent); }
.pi-palette-kind {
  flex: none; font-size: 10px; padding: 1px 6px; border-radius: var(--pi-radius-pill);
  border: 1px solid var(--pi-border-strong); color: var(--pi-text-dim); min-width: 34px; text-align: center;
}
.pi-kind-session { color: var(--pi-accent); border-color: var(--pi-accent); }
.pi-kind-hit { color: var(--pi-success); border-color: var(--pi-success); }
.pi-palette-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-palette-sub {
  color: var(--pi-text-faint); font-size: 11px; margin-left: auto;
  max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--pi-font-mono);
}
.pi-palette-hint {
  margin-left: auto; color: var(--pi-text-faint); font-size: 11px;
  font-family: var(--pi-font-mono);
}
.pi-palette-empty { padding: 18px; text-align: center; color: var(--pi-text-faint); font-size: 12px; }
.pi-palette-foot {
  display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid var(--pi-border);
  background: var(--pi-raised); font-size: 11px; color: var(--pi-text-faint);
}
.pi-palette-foot b { color: var(--pi-text-dim); font-weight: 600; }
.pi-palette-foot span:last-child { margin-left: auto; }
.pi-hit-flash { animation: pi-hit-flash 1.6s ease-out; }
@keyframes pi-hit-flash {
  0% { background: var(--pi-accent-soft); }
  100% { background: transparent; }
}
`;
