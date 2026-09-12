/**
 * Telemetry panel (DeepSeekHarness-style detail) for the chat window.
 *
 * Data comes from the main process through `pi:get-stats` (the chat session's
 * StatsCollector snapshot). The panel polls while it is open instead of hooking
 * the message stream: the injected scripts run in the same window as pi-chat,
 * whose preload exposes a single message listener that upstream already owns.
 */
export const STATS_HTML = `
<div class="pi-modal" id="pi-stats-modal" hidden>
  <div class="pi-modal-card" role="dialog" aria-modal="true" aria-labelledby="pi-stats-title">
    <header class="pi-modal-head">
      <h2 id="pi-stats-title">Token 与性能统计</h2>
      <span class="pi-stats-session" id="pi-stats-path"></span>
      <button class="pi-modal-close" id="pi-stats-close" type="button" aria-label="关闭">✕</button>
    </header>
    <div class="pi-modal-body">
      <section class="pi-stats-live" id="pi-stats-live" hidden>
        <span class="pi-stats-live-dot"></span>
        <span id="pi-stats-live-text">生成中…</span>
      </section>

      <section class="pi-stats-grid">
        <div class="pi-stat-card">
          <div class="pi-stat-label">首 token 延迟 (TTFT)</div>
          <div class="pi-stat-value" id="pi-stat-ttft">–</div>
          <div class="pi-stat-sub" id="pi-stat-ttft-sub">本轮 / 会话均值</div>
        </div>
        <div class="pi-stat-card">
          <div class="pi-stat-label">解码速度</div>
          <div class="pi-stat-value" id="pi-stat-tps">–</div>
          <div class="pi-stat-sub" id="pi-stat-tps-sub">output tokens / 解码秒</div>
        </div>
        <div class="pi-stat-card">
          <div class="pi-stat-label">缓存命中率</div>
          <div class="pi-stat-value" id="pi-stat-cache">–</div>
          <div class="pi-stat-sub" id="pi-stat-cache-sub">cacheRead / (cacheRead + input)</div>
        </div>
        <div class="pi-stat-card">
          <div class="pi-stat-label">花费</div>
          <div class="pi-stat-value" id="pi-stat-cost">–</div>
          <div class="pi-stat-sub" id="pi-stat-cost-sub">今日 / 本月</div>
        </div>
      </section>

      <section class="pi-stats-block">
        <h3>会话累计</h3>
        <div class="pi-kv" id="pi-stats-totals"></div>
      </section>

      <section class="pi-stats-block">
        <h3>最近轮次</h3>
        <div class="pi-table-wrap">
          <table class="pi-table">
            <thead>
              <tr>
                <th>#</th><th>TTFT</th><th>解码</th><th>t/s</th>
                <th>输出</th><th>推理</th><th>缓存读</th><th>输入</th><th>$</th><th>工具</th>
              </tr>
            </thead>
            <tbody id="pi-stats-turns"></tbody>
          </table>
        </div>
      </section>
      <p class="pi-stats-note">
        数据来自 pi 的 RPC 事件（message_update 携带累计 usage）。价格按 provider 回报计算；
        未提供 reasoning 拆分或缓存计费的模型会显示 –。
      </p>
    </div>
  </div>
</div>`;

export const STATS_SCRIPT = `
<script>
(function () {
  var modal = document.getElementById('pi-stats-modal');
  if (!modal) return;
  var pollTimer = null;
  var last = null;

  function num(n) {
    if (n == null || isNaN(n)) return null;
    return Number(n).toLocaleString('en-US');
  }
  function ms(v) {
    if (v == null) return '–';
    if (v < 1000) return v + ' ms';
    return (v / 1000).toFixed(2) + ' s';
  }
  function usd(v) {
    if (v == null) return '–';
    if (v === 0) return '$0';
    return '$' + Number(v).toFixed(v < 0.01 ? 4 : 3);
  }
  function pct(v) {
    if (v == null) return '–';
    return (v * 100).toFixed(1) + '%';
  }
  function set(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function kv(label, value, hint) {
    return '<div class="pi-kv-row"><span class="pi-kv-key">' + label + '</span>' +
      '<span class="pi-kv-val" title="' + (hint || '') + '">' + value + '</span></div>';
  }

  function render(stats) {
    last = stats;
    if (!stats) return;
    var agg = stats.aggregate || {};
    var lastTurn = stats.last || null;

    if (stats.live && stats.live.running) {
      var live = document.getElementById('pi-stats-live');
      if (live) live.hidden = false;
      set('pi-stats-live-text',
        '生成中 · TTFT ' + (live ? ms(stats.live.ttftMs) : '–') +
        ' · ' + (num(stats.live.outputTokens) || 0) + ' tokens' +
        ' · ' + (stats.live.tps ? stats.live.tps + ' t/s' : '…') +
        ' · ' + (stats.live.elapsedMs / 1000).toFixed(1) + 's');
    } else {
      var lv = document.getElementById('pi-stats-live');
      if (lv) lv.hidden = true;
    }

    set('pi-stat-ttft', lastTurn ? ms(lastTurn.ttftMs) : ms(agg.avgTtftMs));
    set('pi-stat-ttft-sub', '均值 ' + ms(agg.avgTtftMs) + ' · p50 ' + ms(agg.p50TtftMs) + ' · p95 ' + ms(agg.p95TtftMs));
    set('pi-stat-tps', lastTurn && lastTurn.tps ? lastTurn.tps + ' t/s' : (agg.avgTps ? agg.avgTps + ' t/s' : '–'));
    set('pi-stat-tps-sub', '均值 ' + (agg.avgTps != null ? agg.avgTps + ' t/s' : '–') + ' · 本轮输出 ' + (lastTurn ? num(lastTurn.outputTokens) : '–'));
    set('pi-stat-cache', pct(agg.cacheHitRate));
    set('pi-stat-cache-sub', '读 ' + num(agg.cacheRead) + ' · 写 ' + num(agg.cacheWrite));
    set('pi-stat-cost', usd(agg.cost));
    set('pi-stat-cost-sub', '今日 ' + usd(stats.costToday) + ' · 本月 ' + usd(stats.costMonth));
    set('pi-stats-path', stats.sessionFile || '');

    document.getElementById('pi-stats-totals').innerHTML = [
      kv('轮次', num(agg.turns)),
      kv('输入 tokens', num(agg.inputTokens)),
      kv('输出 tokens', num(agg.outputTokens) + (agg.reasoningTokens ? ' （含推理 ' + num(agg.reasoningTokens) + '，' + pct(agg.reasoningShare) + '）' : '')),
      kv('缓存读 / 写', num(agg.cacheRead) + ' / ' + num(agg.cacheWrite)),
      kv('总 tokens', num(agg.totalTokens), '与上下文长度不同：含全部历史轮次'),
      kv('工具调用', num(agg.toolCalls)),
      kv('总花费', usd(agg.cost) + '（今日 ' + usd(stats.costToday) + '，本月 ' + usd(stats.costMonth) + '）'),
    ].join('');

    var rows = (stats.turns || []).slice().reverse().map(function (t) {
      return '<tr><td>' + t.turn + '</td>' +
        '<td>' + ms(t.ttftMs) + '</td>' +
        '<td>' + ms(t.decodeMs) + '</td>' +
        '<td>' + (t.tps != null ? t.tps : '–') + '</td>' +
        '<td>' + (num(t.outputTokens) || 0) + '</td>' +
        '<td>' + (t.reasoningTokens != null ? num(t.reasoningTokens) : '–') + '</td>' +
        '<td>' + (num(t.cacheRead) || 0) + '</td>' +
        '<td>' + (num(t.inputTokens) || 0) + '</td>' +
        '<td>' + usd(t.cost) + '</td>' +
        '<td>' + (t.toolCalls || 0) + '</td></tr>';
    });
    document.getElementById('pi-stats-turns').innerHTML =
      rows.length ? rows.join('') : '<tr><td colspan="10" class="pi-table-empty">本轮会话还没有完成的轮次</td></tr>';
  }

  async function refresh() {
    try {
      var stats = await window.pi.invoke('pi:get-stats');
      render(stats);
    } catch (e) {
      /* session may be restarting */
    }
  }

  function open() {
    modal.hidden = false;
    void refresh();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 700);
  }
  function close() {
    modal.hidden = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
  window.__piStats = { open: open, close: close, render: render };

  document.getElementById('pi-stats-close').addEventListener('click', close);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) close();
    if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      if (modal.hidden) open(); else close();
    }
  });
  // clicking the metric chips in the title bar opens the panel
  document.querySelectorAll('.pi-stat').forEach(function (chip) {
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', function () {
      if (modal.hidden) open(); else close();
    });
  });
})();
</script>`;

/**
 * Panel styling — shares the --pi-* tokens with the rest of the shell.
 */
export const STATS_CSS = `
/* ── Telemetry panel ────────────────────────────────────────────────── */
.pi-modal {
  position: fixed; inset: 0; z-index: 4000; display: flex;
  align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(2px);
}
.pi-modal[hidden] { display: none; }
.pi-modal-card {
  width: min(980px, 92vw); max-height: 86vh; display: flex; flex-direction: column;
  background: var(--pi-surface); color: var(--pi-text);
  border: 1px solid var(--pi-border-strong); border-radius: var(--pi-radius-lg);
  box-shadow: var(--pi-shadow-2); overflow: hidden;
}
.pi-modal-head {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 1px solid var(--pi-border); background: var(--pi-raised);
}
.pi-modal-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
.pi-stats-session {
  font-family: var(--pi-font-mono); font-size: 11px; color: var(--pi-text-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46ch;
}
.pi-modal-close {
  margin-left: auto; background: transparent; color: var(--pi-text-dim);
  border: 1px solid transparent; border-radius: var(--pi-radius-sm);
  width: 26px; height: 26px; cursor: pointer; font-size: 13px;
}
.pi-modal-close:hover { background: var(--pi-overlay); color: var(--pi-text); }
.pi-modal-body { padding: 16px; overflow: auto; }
.pi-stats-live {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; margin-bottom: 14px;
  background: var(--pi-accent-soft); border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius); font-size: 12px; color: var(--pi-text);
}
.pi-stats-live-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--pi-accent);
  animation: pi-stats-pulse 1.2s ease-in-out infinite;
}
@keyframes pi-stats-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }
.pi-stats-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px; margin-bottom: 18px;
}
.pi-stat-card {
  background: var(--pi-raised); border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius); padding: 12px 14px;
}
.pi-stat-label { font-size: 11px; color: var(--pi-text-dim); margin-bottom: 6px; }
.pi-stat-value {
  font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.pi-stat-sub { font-size: 11px; color: var(--pi-text-faint); margin-top: 4px; }
.pi-stats-block { margin-bottom: 18px; }
.pi-stats-block h3 {
  font-size: 12px; font-weight: 600; color: var(--pi-text-dim);
  text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 8px;
}
.pi-kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 2px 18px; }
.pi-kv-row {
  display: flex; justify-content: space-between; gap: 12px; padding: 5px 0;
  border-bottom: 1px dashed var(--pi-border); font-size: 12px;
}
.pi-kv-key { color: var(--pi-text-dim); }
.pi-kv-val { font-family: var(--pi-font-mono); font-variant-numeric: tabular-nums; }
.pi-table-wrap { overflow: auto; border: 1px solid var(--pi-border); border-radius: var(--pi-radius); }
.pi-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pi-table th {
  position: sticky; top: 0; background: var(--pi-raised); color: var(--pi-text-dim);
  text-align: right; padding: 6px 10px; font-weight: 500; border-bottom: 1px solid var(--pi-border);
}
.pi-table td {
  text-align: right; padding: 5px 10px; font-family: var(--pi-font-mono);
  font-variant-numeric: tabular-nums; border-bottom: 1px solid var(--pi-border);
}
.pi-table tr:last-child td { border-bottom: none; }
.pi-table-empty { text-align: center !important; color: var(--pi-text-faint); padding: 18px !important; }
.pi-stats-note { font-size: 11px; color: var(--pi-text-faint); margin: 0; line-height: 1.6; }
`;
