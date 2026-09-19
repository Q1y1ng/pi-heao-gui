/**
 * "Waiting for you": the cross-window list of decisions nobody has answered yet.
 *
 * Data comes from the main process — pushed as a `decisions` message on every change (the shim
 * re-dispatches host messages as window `message` events, which is how the minimal shell's title
 * bridge already listens), and fetched once with `pi:decisions` on load, because the push that
 * happened before this script ran is a push nobody heard.
 *
 * Unlike the telemetry panel this one is injected into the stripped child shell too: a decision can
 * be raised in a window the person is not looking at, and the whole point of the list is that any
 * window can tell them so. It costs one button and no timers — the list only moves when the main
 * process says it did.
 */
export const DECISIONS_HTML = `
<div class="pi-decisions-modal" id="pi-decisions-modal" hidden>
  <div class="pi-decisions-card" role="dialog" aria-modal="true" aria-labelledby="pi-decisions-title">
    <header class="pi-decisions-head">
      <h2 id="pi-decisions-title">待你处理</h2>
      <span class="pi-decisions-sub" id="pi-decisions-sub"></span>
      <button class="pi-decisions-close" id="pi-decisions-close" type="button" aria-label="关闭">✕</button>
    </header>
    <div class="pi-decisions-body">
      <ul class="pi-decisions-list" id="pi-decisions-list"></ul>
      <p class="pi-decisions-note">pi 正在等一个回答（权限、确认或输入）。点一条会跳到提出它的窗口 —— 回答要在那里做，在别处回答不了。</p>
    </div>
  </div>
</div>`;

export const DECISIONS_SCRIPT = `
<script>
(function () {
  var modal = document.getElementById('pi-decisions-modal');
  if (!modal) return;
  var btn = document.getElementById('pi-decisions-btn');
  var badge = document.getElementById('pi-decisions-badge');
  var list = document.getElementById('pi-decisions-list');
  var sub = document.getElementById('pi-decisions-sub');
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
  function paint() {
    if (badge) {
      badge.textContent = String(items.length);
      badge.hidden = items.length === 0;
    }
    if (btn) btn.className = 'pi-icon-btn pi-decisions-btn' + (items.length ? ' has-decisions' : '');
    if (sub) sub.textContent = items.length ? items.length + ' 项等待回答' : '';
    if (modal.hidden) return;
    list.innerHTML = items.length
      ? items.map(function (d) {
          return '<li class="pi-decisions-item" data-window="' + esc(d.windowId) + '" tabindex="0">' +
            '<span class="pi-decisions-title">' + esc(d.title) + '</span>' +
            '<span class="pi-decisions-meta">' + esc(d.windowLabel || ('窗口 #' + d.windowId)) +
            ' · ' + ago(d.askedAt) + '</span>' +
            (d.message ? '<span class="pi-decisions-msg">' + esc(d.message) + '</span>' : '') +
            '<span class="pi-decisions-go">跳过去 →</span></li>';
        }).join('')
      : '<li class="pi-decisions-empty">现在没有等待回答的请求。</li>';
  }
  function render(next) {
    items = Array.isArray(next) ? next : [];
    paint();
  }
  function open() { modal.hidden = false; paint(); void refresh(); }
  function close() { modal.hidden = true; }
  async function refresh() {
    try { render(await window.pi.invoke('pi:decisions')); } catch (e) { /* the app is restarting */ }
  }
  async function goTo(windowId) {
    try { await window.pi.invoke('pi:decisions-focus', { windowId: windowId }); } catch (e) { /* gone */ }
    close();
  }

  list.addEventListener('click', function (e) {
    var li = e.target && e.target.closest ? e.target.closest('.pi-decisions-item') : null;
    if (li) goTo(Number(li.getAttribute('data-window')));
  });
  list.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var li = e.target && e.target.closest ? e.target.closest('.pi-decisions-item') : null;
    if (li) { e.preventDefault(); goTo(Number(li.getAttribute('data-window'))); }
  });
  document.getElementById('pi-decisions-close').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
  if (btn) {
    btn.addEventListener('click', function () { if (modal.hidden) open(); else close(); });
  }
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (msg && msg.type === 'decisions') render(msg.items);
  });
  void refresh();
})();
</script>`;

/**
 * Panel styling. Deliberately its own class names rather than the telemetry panel's: the stripped
 * child shell does not carry the telemetry CSS, and this panel is injected into it as well.
 */
export const DECISIONS_CSS = `
/* ── Pending decisions ─────────────────────────────────────────────── */
.pi-decisions-btn { position: relative; }
.pi-decisions-btn.has-decisions { color: var(--pi-warn); }
.pi-decisions-badge {
  position: absolute; top: -2px; right: -2px; min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: var(--pi-radius-pill); background: var(--pi-warn); color: var(--pi-bg);
  font-size: 10px; line-height: 14px; text-align: center; font-variant-numeric: tabular-nums;
  font-family: var(--pi-font-mono); pointer-events: none;
}
.pi-decisions-modal {
  position: fixed; inset: 0; z-index: 4200; display: flex; align-items: center; justify-content: center;
  /* Dim, and a text colour that goes with it: the overlay paints no text of its own — everything
     readable sits on the opaque card — but an element that *contains* text is measured against its
     own background, so this is the reading that is true for both themes. */
  background: rgba(0, 0, 0, 0.72); color: #fff; backdrop-filter: blur(2px);
}
.pi-decisions-modal[hidden] { display: none; }
.pi-decisions-card {
  width: min(640px, 92vw); max-height: 80vh; display: flex; flex-direction: column;
  background: var(--pi-surface); color: var(--pi-text);
  border: 1px solid var(--pi-border-strong); border-radius: var(--pi-radius-lg);
  box-shadow: var(--pi-shadow-2); overflow: hidden;
}
.pi-decisions-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px;
  border-bottom: 1px solid var(--pi-border); background: var(--pi-raised);
}
.pi-decisions-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.pi-decisions-sub { font-size: 11px; color: var(--pi-text-faint); }
.pi-decisions-close {
  margin-left: auto; background: transparent; color: var(--pi-text-dim);
  border: 1px solid transparent; border-radius: var(--pi-radius-sm);
  width: 26px; height: 26px; cursor: pointer; font-size: 13px;
}
.pi-decisions-close:hover { background: var(--pi-overlay); color: var(--pi-text); }
.pi-decisions-body { padding: 12px 16px 14px; overflow: auto; }
.pi-decisions-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pi-decisions-item {
  display: grid; grid-template-columns: 1fr auto; gap: 3px 12px;
  padding: 10px 12px; background: var(--pi-raised); border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius); cursor: pointer;
}
.pi-decisions-item:hover, .pi-decisions-item:focus-visible {
  border-color: var(--pi-border-strong); background: var(--pi-overlay); outline: none;
}
.pi-decisions-title { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.pi-decisions-meta { grid-column: 1; font-size: 11px; color: var(--pi-text-faint); }
.pi-decisions-msg {
  grid-column: 1 / -1; font-size: 12px; color: var(--pi-text-dim);
  white-space: pre-wrap; overflow-wrap: anywhere; max-height: 7.5em; overflow: hidden;
}
.pi-decisions-go {
  grid-column: 2; grid-row: 1 / span 2; align-self: center; white-space: nowrap;
  font-size: 12px; color: var(--pi-accent);
}
.pi-decisions-empty { padding: 18px 0; text-align: center; font-size: 12px; color: var(--pi-text-faint); }
.pi-decisions-note { margin: 12px 0 0; font-size: 11px; line-height: 1.6; color: var(--pi-text-faint); }
`;
