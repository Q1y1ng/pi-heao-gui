/**
 * Telemetry math: first-token latency, decode speed, cache hit rate, spend.
 * Times are injected, so these tests need no timers and no live model.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { StatsCollector } = require("../dist/main/stats.js");

const usage = (o) => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: undefined,
  totalTokens: 0,
  cost: { total: 0 },
  ...o,
});

test("TTFT is send -> first delta, decode is first delta -> end", () => {
  const c = new StatsCollector();
  c.beginTurn(1000);
  c.onDelta(1500, usage({ output: 1 })); // TTFT 500
  c.onDelta(2500, usage({ output: 100 })); // last delta at 2500
  const turn = c.endTurn(2600, { usage: usage({ input: 10, output: 120, totalTokens: 130 }) });

  assert.equal(turn.ttftMs, 500);
  assert.equal(turn.decodeMs, 1000); // 2500 - 1500
  assert.equal(turn.prefillMs, 500);
  assert.equal(turn.outputTokens, 120); // final usage wins over the live count
  assert.equal(turn.tps, 120); // 120 tokens over 1.0 s
});

test("no deltas means no ttft / no tps, but the turn still closes", () => {
  const c = new StatsCollector();
  c.beginTurn(1000);
  const turn = c.endTurn(4000, { usage: usage({ input: 5 }) });
  assert.equal(turn.ttftMs, null);
  assert.equal(turn.decodeMs, null);
  assert.equal(turn.tps, null);
  assert.equal(turn.prefillMs, 3000); // falls back to the full wall time
});

test("live stats report a running turn and disappear when idle", () => {
  const c = new StatsCollector();
  assert.equal(c.live(1000), null);
  c.beginTurn(1000);
  assert.equal(c.live(1200).ttftMs, null); // no token yet
  assert.equal(c.live(1200).running, true);
  c.onDelta(1500, usage({ output: 10 }));
  const live = c.live(2500);
  assert.equal(live.ttftMs, 500);
  assert.equal(live.outputTokens, 10);
  assert.equal(live.tps, 10); // 10 tokens / 1.0 s
  c.endTurn(2500, {});
  assert.equal(c.live(2600), null);
});

test("aggregate sums tokens and derives cache hit rate + reasoning share", () => {
  const c = new StatsCollector();
  c.beginTurn(0);
  c.onDelta(100, usage({ output: 10 }));
  c.endTurn(200, {
    usage: usage({ input: 1000, output: 200, cacheRead: 3000, cacheWrite: 500, reasoning: 50, totalTokens: 4700, cost: { total: 0.02 } }),
  });
  c.beginTurn(1000);
  c.onDelta(1100, usage({ output: 1 }));
  c.endTurn(1400, {
    usage: usage({ input: 1000, output: 100, cacheRead: 4000, cacheWrite: 0, reasoning: 50, totalTokens: 5100, cost: { total: 0.01 } }),
  });

  const agg = c.aggregate();
  assert.equal(agg.turns, 2);
  assert.equal(agg.inputTokens, 2000);
  assert.equal(agg.outputTokens, 300);
  assert.equal(agg.cacheRead, 7000);
  assert.equal(agg.cacheWrite, 500);
  assert.equal(agg.reasoningTokens, 100);
  assert.equal(Math.round(agg.cost * 1000) / 1000, 0.03);
  // 7000 / (7000 + 2000)
  assert.equal(agg.cacheHitRate, 0.778);
  assert.equal(agg.reasoningShare, 0.333);
  assert.equal(agg.avgTtftMs, 100); // both turns: first delta exactly 100 ms after send
});

test("percentiles cover p50 and p95 and ignore turns without a first token", () => {
  const c = new StatsCollector();
  const ttfts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  for (const t of ttfts) {
    c.beginTurn(0);
    c.onDelta(t, usage({ output: 1 }));
    c.endTurn(t + 10, { usage: usage({ output: 10 }) });
  }
  c.beginTurn(0); // aborted before the first token
  c.endTurn(10, {});

  const agg = c.aggregate();
  assert.equal(agg.avgTtftMs, 550);
  assert.equal(agg.p50TtftMs, 600);
  assert.equal(agg.p95TtftMs, 1000);
  assert.equal(agg.turns, 11);
});

test("spend is tracked per day and per month", () => {
  const c = new StatsCollector();
  const day1 = Date.UTC(2026, 0, 15, 12, 0, 0);
  const day2 = Date.UTC(2026, 1, 3, 12, 0, 0); // next month
  c.beginTurn(day1);
  c.onDelta(day1 + 10, usage({ output: 1 }));
  c.endTurn(day1 + 20, { usage: usage({ output: 10, cost: { total: 1.5 } }) });
  c.beginTurn(day1);
  c.onDelta(day1 + 10, usage({ output: 1 }));
  c.endTurn(day1 + 20, { usage: usage({ output: 10, cost: { total: 0.5 } }) });
  c.beginTurn(day2);
  c.onDelta(day2 + 10, usage({ output: 1 }));
  c.endTurn(day2 + 20, { usage: usage({ output: 10, cost: { total: 2 } }) });

  assert.equal(c.costToday(day1), 2);
  assert.equal(c.costToday(day2), 2);
  assert.equal(c.costMonth(day2), 2);
  const snap = c.snapshot(day2);
  assert.equal(snap.costToday, 2);
  assert.equal(snap.byDay[Object.keys(snap.byDay)[0]].turns > 0, true);
});

test("round-trips through toJSON/load and rejects junk at the boundary", () => {
  const a = new StatsCollector();
  a.beginTurn(0);
  a.onDelta(50, usage({ output: 1 }));
  a.endTurn(100, { usage: usage({ input: 1, output: 2, cost: { total: 0.25 } }) });

  const b = new StatsCollector();
  b.load(JSON.parse(JSON.stringify(a.toJSON())));
  assert.equal(b.last().outputTokens, 2);
  assert.equal(b.last().ttftMs, 50);
  assert.equal(b.aggregate().cost, 0.25);

  const c = new StatsCollector();
  c.load(null);
  c.load("nonsense");
  c.load({ turns: "not an array", byDay: 42 });
  assert.equal(c.aggregate().turns, 0);
});

test("turn history is bounded so a long session cannot grow without limit", () => {
  const c = new StatsCollector();
  for (let i = 0; i < 260; i++) {
    c.beginTurn(i);
    c.onDelta(i + 1, usage({ output: 1 }));
    c.endTurn(i + 2, { usage: usage({ output: 1 }) });
  }
  const snap = c.snapshot(1000);
  assert.equal(snap.turns.length, 20); // snapshot keeps the tail
  assert.equal(c.aggregate().turns, 200); // history is capped
  assert.equal(c.last().turn, 260);
});
