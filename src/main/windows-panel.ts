/**
 * The board: what every window is doing, in one list.
 *
 * Read-only on purpose. Everything it shows is already known somewhere — the tray's unread badges,
 * the title bar's streaming state, the pending-decision list — and none of those is something you can
 * glance at when several windows are open. This is that glance: waiting first (a person is required),
 * then running, then the rest, and clicking a row raises that window.
 *
 * Pushed as a `windowStatus` message on every change, and fetched once with `pi:get-windows` on load
 * (a push that happened before this script ran is a push nobody heard). No timers: like the decision
 * panel, it only moves when the main process says it did.
 */
export const WINDOWS_HTML = `
<div class="pi-windows-modal" id="pi-windows-modal" hidden>
  <div class="pi-windows-card" role="dialog" aria-modal="true" aria-labelledby="pi-windows-title">
    <header class="pi-windows-head">
      <h2 id="pi-windows-title">窗口总览</h2>
      <span class="pi-windows-sub" id="pi-windows-sub"></span>
      <button class="pi-windows-close" id="pi-windows-close" type="button" aria-label="关闭">✕</button>
    </header>
    <div class="pi-windows-body">
      <ul class="pi-windows-list" id="pi-windows-list"></ul>
      <p class="pi-windows-note">每个窗口一个 pi 进程。点一行把它提到前台；「等待回答」的窗口那一轮正卡在等人。</p>
    </div>
  </div>
</div>`;

export const WINDOWS_SCRIPT = `
<script>
(function () {
  var modal = document.getElementById('pi-windows-modal');
  if (!modal) return;
  var btn = document.getElementById('pi-windows-btn');
  var list = document.getElementById('pi-windows-list');
  var sub = document.getElementById('pi-windows-sub');
  var items = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 1000));
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    return Math.round(s / 3600) + ' 小时前';
  }
  function state(d) {
    if (Number(d.waiting) > 0) return { key: 'waiting', text: '等待回答' };
    if (d.running) return { key: 'running', text: '运行中' };
    return { key: 'idle', text: '空闲' };
  }
  function paint() {
    if (sub) sub.textContent = items.length ? items.length + ' 个窗口' : '';
    if (modal.hidden) return;
    list.innerHTML = items.length
      ? items.map(function (d) {
          var st = state(d);
          return '<li class="pi-windows-item is-' + st.key + '" data-window="' + esc(d.windowId) + '" tabindex="0">' +
            '<span class="pi-windows-state">' + st.text + '</span>' +
            '<span class="pi-windows-label">' + esc(d.label) + '</span>' +
            '<span class="pi-windows-meta">' +
            (Number(d.unread) > 0 ? esc(d.unread) + ' 条未读 · ' : '') +
            ago(d.touchedAt) + '</span>' +
            '<span class="pi-windows-go">切过去 →</span></li>';
        }).join('')
      : '<li class="pi-windows-empty">现在只有这一个窗口。</li>';
  }
  function render(next) {
    items = Array.isArray(next) ? next : [];
    if (btn) btn.className = 'pi-icon-btn pi-windows-btn' + (items.length > 1 ? ' has-windows' : '');
    paint();
  }
  function open() { modal.hidden = false; paint(); void refresh(); }
  function close() { modal.hidden = true; }
  async function refresh() {
    try { render(await window.pi.invoke('pi:get-windows')); } catch (e) { /* restarting */ }
  }
  async function goTo(windowId) {
    try { await window.pi.invoke('pi:focus-window', { windowId: windowId }); } catch (e) { /* gone */ }
    close();
  }

  list.addEventListener('click', function (e) {
    var li = e.target && e.target.closest ? e.target.closest('.pi-windows-item') : null;
    if (li) goTo(Number(li.getAttribute('data-window')));
  });
  list.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var li = e.target && e.target.closest ? e.target.closest('.pi-windows-item') : null;
    if (li) { e.preventDefault(); goTo(Number(li.getAttribute('data-window'))); }
  });
  document.getElementById('pi-windows-close').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
  if (btn) btn.addEventListener('click', function () { if (modal.hidden) open(); else close(); });
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (msg && msg.type === 'windowStatus') render(msg.items);
  });
  void refresh();
})();
</script>`;

/**
 * Board styling. Its own class names, like the decision panel: the stripped child shell carries both
 * panels and neither of the other panels' CSS.
 */
export const WINDOWS_CSS = `
/* ── Window board ──────────────────────────────────────────────────── */
.pi-windows-btn { position: relative; }
.pi-windows-btn.has-windows { color: var(--pi-accent); }
.pi-windows-modal {
  position: fixed; inset: 0; z-index: 4100; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.72); color: #fff; backdrop-filter: blur(2px);
}
.pi-windows-modal[hidden] { display: none; }
.pi-windows-card {
  width: min(620px, 92vw); max-height: 80vh; display: flex; flex-direction: column;
  background: var(--pi-surface); color: var(--pi-text);
  border: 1px solid var(--pi-border-strong); border-radius: var(--pi-radius-lg);
  box-shadow: var(--pi-shadow-2); overflow: hidden;
}
.pi-windows-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px;
  border-bottom: 1px solid var(--pi-border); background: var(--pi-raised);
}
.pi-windows-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.pi-windows-sub { font-size: 11px; color: var(--pi-text-faint); }
.pi-windows-close {
  margin-left: auto; background: transparent; color: var(--pi-text-dim);
  border: 1px solid transparent; border-radius: var(--pi-radius-sm);
  width: 26px; height: 26px; cursor: pointer; font-size: 13px;
}
.pi-windows-close:hover { background: var(--pi-overlay); color: var(--pi-text); }
.pi-windows-body { padding: 12px 16px 14px; overflow: auto; }
.pi-windows-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pi-windows-item {
  display: grid; grid-template-columns: auto 1fr auto; gap: 3px 10px; align-items: center;
  padding: 9px 12px; background: var(--pi-raised); border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius); cursor: pointer;
}
.pi-windows-item:hover, .pi-windows-item:focus-visible {
  border-color: var(--pi-border-strong); background: var(--pi-overlay); outline: none;
}
.pi-windows-state {
  grid-row: 1 / span 2; padding: 2px 7px; border-radius: var(--pi-radius-pill);
  font-size: 11px; white-space: nowrap;
  background: var(--pi-overlay); color: var(--pi-text-dim);
}
.pi-windows-item.is-waiting .pi-windows-state { background: var(--pi-warn); color: var(--pi-bg); }
.pi-windows-item.is-running .pi-windows-state { background: var(--pi-accent-soft); color: var(--pi-accent); }
.pi-windows-label { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.pi-windows-meta { grid-column: 2; font-size: 11px; color: var(--pi-text-faint); }
.pi-windows-go { grid-column: 3; grid-row: 1 / span 2; font-size: 12px; color: var(--pi-accent); white-space: nowrap; }
.pi-windows-empty { padding: 18px 0; text-align: center; font-size: 12px; color: var(--pi-text-faint); }
.pi-windows-note { margin: 12px 0 0; font-size: 11px; line-height: 1.6; color: var(--pi-text-faint); }
`;
