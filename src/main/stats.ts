/**
 * Token / performance telemetry for one pi session.
 *
 * Everything here is derived from what the RPC protocol gives us:
 *   - `message_update` carries a **cumulative** `usage` while streaming, so a
 *     live token counter and a live tokens/sec figure are possible;
 *   - the first streamed delta after we sent a prompt gives first-token latency;
 *   - `turn_end` / `agent_settled` close the turn.
 *
 * The collector is pure: the caller passes `now`, so it is testable without
 * timers or a live model.
 */

/** Token counts as reported by the provider (see pi-ai `Usage`). */
export interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

export interface TurnStats {
  turn: number;
  startedAt: number;
  endedAt: number;
  /** prompt sent -> first streamed token (ms); null when nothing streamed. */
  ttftMs: number | null;
  /** first token -> turn end (ms); null when nothing streamed. */
  decodeMs: number | null;
  /** output ms separated prefill wall time from decode wall time. */
  prefillMs: number;
  outputTokens: number;
  reasoningTokens: number | null;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  /** output tokens / decode seconds. */
  tps: number | null;
  toolCalls: number;
  stopReason: string;
}

export interface LiveStats {
  running: boolean;
  startedAt: number;
  ttftMs: number | null;
  elapsedMs: number;
  outputTokens: number;
  tps: number | null;
}

export interface DayUsage {
  cost: number;
  outputTokens: number;
  totalTokens: number;
  turns: number;
}

export interface Aggregate {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  reasoningTokens: number;
  totalTokens: number;
  cost: number;
  toolCalls: number;
  avgTtftMs: number | null;
  p50TtftMs: number | null;
  p95TtftMs: number | null;
  avgTps: number | null;
  /** cacheRead / (cacheRead + input): how much of the prompt was cheap. */
  cacheHitRate: number | null;
  /** reasoning share of output tokens, when the provider reports it. */
  reasoningShare: number | null;
}

export interface StatsSnapshot {
  live: LiveStats | null;
  last: TurnStats | null;
  turns: TurnStats[];
  aggregate: Aggregate;
  costToday: number;
  costMonth: number;
  byDay: Record<string, DayUsage>;
}

const MAX_TURNS = 200;
const MAX_DAYS = 120;

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function usageOf(u: UsageLike | undefined): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number | null;
  total: number;
  cost: number;
} {
  if (!u) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, total: 0, cost: 0 };
  }
  const input = num(u.input);
  const output = num(u.output);
  const cacheRead = num(u.cacheRead);
  const cacheWrite = num(u.cacheWrite);
  const total = num(u.totalTokens) || input + output + cacheRead + cacheWrite;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning: typeof u.reasoning === "number" ? u.reasoning : null,
    total,
    cost: num(u.cost?.total),
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(((sorted.length - 1) * p) / 100)));
  return sorted[idx];
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

interface OpenTurn {
  turn: number;
  startedAt: number;
  firstTokenAt: number | null;
  lastDeltaAt: number | null;
  outputTokens: number;
  usage: UsageLike | undefined;
  toolCalls: number;
}

/**
 * Accumulates per-turn and total token/performance figures for one session.
 * All timestamps come from the caller so it can be unit tested.
 */
export class StatsCollector {
  private openTurn: OpenTurn | null = null;
  private turns: TurnStats[] = [];
  private byDay: Record<string, DayUsage> = {};
  private turnCounter = 0;

  /** Prompt accepted (RPC prompt/steer/follow_up sent). */
  beginTurn(now: number): void {
    this.turnCounter += 1;
    this.openTurn = {
      turn: this.turnCounter,
      startedAt: now,
      firstTokenAt: null,
      lastDeltaAt: null,
      outputTokens: 0,
      usage: undefined,
      toolCalls: 0,
    };
  }

  /** A streamed delta arrived (text/thinking/toolcall) with cumulative usage. */
  onDelta(now: number, usage?: UsageLike): void {
    const t = this.openTurn;
    if (!t) return;
    if (t.firstTokenAt === null) t.firstTokenAt = now;
    t.lastDeltaAt = now;
    if (usage) {
      t.usage = usage;
      const u = usageOf(usage);
      if (u.output > 0) t.outputTokens = u.output;
    }
  }

  /** A tool finished executing inside this turn. */
  onToolCall(): void {
    if (this.openTurn) this.openTurn.toolCalls += 1;
  }

  /**
   * Closes the open turn. `usage` should be the final usage from the last
   * `message_update` or `message_end` — it is authoritative over the live count.
   */
  endTurn(now: number, opts: { usage?: UsageLike; stopReason?: string } = {}): TurnStats | null {
    const t = this.openTurn;
    if (!t) return null;
    this.openTurn = null;

    const u = usageOf(opts.usage ?? t.usage);
    const outputTokens = u.output > 0 ? u.output : t.outputTokens;
    const firstTokenAt = t.firstTokenAt;
    const ttftMs = firstTokenAt === null ? null : Math.round(firstTokenAt - t.startedAt);
    const decodeMs =
      firstTokenAt === null || t.lastDeltaAt === null
        ? null
        : Math.round(t.lastDeltaAt - firstTokenAt);
    const tps =
      decodeMs !== null && decodeMs > 0 && outputTokens > 0
        ? Math.round((outputTokens / (decodeMs / 1000)) * 10) / 10
        : null;

    const turn: TurnStats = {
      turn: t.turn,
      startedAt: t.startedAt,
      endedAt: now,
      ttftMs,
      decodeMs,
      prefillMs: ttftMs ?? Math.round(now - t.startedAt),
      outputTokens,
      reasoningTokens: u.reasoning,
      inputTokens: u.input,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      totalTokens: u.total,
      cost: u.cost,
      tps,
      toolCalls: t.toolCalls,
      stopReason: opts.stopReason ?? "stop",
    };

    this.turns.push(turn);
    if (this.turns.length > MAX_TURNS) this.turns = this.turns.slice(-MAX_TURNS);

    const key = dayKey(now);
    const day = this.byDay[key] ?? { cost: 0, outputTokens: 0, totalTokens: 0, turns: 0 };
    day.cost += turn.cost;
    day.outputTokens += turn.outputTokens;
    day.totalTokens += turn.totalTokens;
    day.turns += 1;
    this.byDay[key] = day;
    this.pruneDays(now);
    return turn;
  }

  /** Streaming state for a live indicator; null when idle. */
  live(now: number): LiveStats | null {
    const t = this.openTurn;
    if (!t) return null;
    const startedAt = t.firstTokenAt ?? now;
    const decodeMs = now - startedAt;
    const tps =
      t.firstTokenAt !== null && decodeMs > 250 && t.outputTokens > 0
        ? Math.round((t.outputTokens / (decodeMs / 1000)) * 10) / 10
        : null;
    return {
      running: true,
      startedAt: t.startedAt,
      ttftMs: t.firstTokenAt === null ? null : Math.round(t.firstTokenAt - t.startedAt),
      elapsedMs: Math.round(now - t.startedAt),
      outputTokens: t.outputTokens,
      tps,
    };
  }

  last(): TurnStats | null {
    return this.turns.length ? this.turns[this.turns.length - 1] : null;
  }

  aggregate(): Aggregate {
    const a: Aggregate = {
      turns: this.turns.length,
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      cost: 0,
      toolCalls: 0,
      avgTtftMs: null,
      p50TtftMs: null,
      p95TtftMs: null,
      avgTps: null,
      cacheHitRate: null,
      reasoningShare: null,
    };
    const ttfts: number[] = [];
    const tpss: number[] = [];
    for (const t of this.turns) {
      a.inputTokens += t.inputTokens;
      a.outputTokens += t.outputTokens;
      a.cacheRead += t.cacheRead;
      a.cacheWrite += t.cacheWrite;
      a.reasoningTokens += t.reasoningTokens ?? 0;
      a.totalTokens += t.totalTokens;
      a.cost += t.cost;
      a.toolCalls += t.toolCalls;
      if (t.ttftMs !== null) ttfts.push(t.ttftMs);
      if (t.tps !== null) tpss.push(t.tps);
    }
    if (ttfts.length) {
      a.avgTtftMs = Math.round(ttfts.reduce((x, y) => x + y, 0) / ttfts.length);
      a.p50TtftMs = percentile(ttfts, 50);
      a.p95TtftMs = percentile(ttfts, 95);
    }
    if (tpss.length) {
      a.avgTps = Math.round((tpss.reduce((x, y) => x + y, 0) / tpss.length) * 10) / 10;
    }
    const prompt = a.cacheRead + a.inputTokens;
    if (prompt > 0) a.cacheHitRate = Math.round((a.cacheRead / prompt) * 1000) / 1000;
    if (a.outputTokens > 0 && a.reasoningTokens > 0) {
      a.reasoningShare = Math.round((a.reasoningTokens / a.outputTokens) * 1000) / 1000;
    }
    return a;
  }

  costToday(now: number): number {
    const day = this.byDay[dayKey(now)];
    return day ? Math.round(day.cost * 1e4) / 1e4 : 0;
  }

  costMonth(now: number): number {
    const prefix = dayKey(now).slice(0, 7);
    let sum = 0;
    for (const [key, day] of Object.entries(this.byDay)) {
      if (key.startsWith(prefix)) sum += day.cost;
    }
    return Math.round(sum * 1e4) / 1e4;
  }

  snapshot(now: number): StatsSnapshot {
    return {
      live: this.live(now),
      last: this.last(),
      turns: this.turns.slice(-20),
      aggregate: this.aggregate(),
      costToday: this.costToday(now),
      costMonth: this.costMonth(now),
      byDay: this.byDay,
    };
  }

  /** Chain-limit the per-day history so the store cannot grow forever. */
  private pruneDays(now: number): void {
    const keys = Object.keys(this.byDay);
    if (keys.length <= MAX_DAYS) return;
    const cutoff = dayKey(now - MAX_DAYS * 86_400_000);
    for (const key of keys) {
      if (key < cutoff) delete this.byDay[key];
    }
  }

  toJSON(): { turns: TurnStats[]; byDay: Record<string, DayUsage>; turnCounter: number } {
    return { turns: this.turns, byDay: this.byDay, turnCounter: this.turnCounter };
  }

  load(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const obj = data as { turns?: unknown; byDay?: unknown; turnCounter?: unknown };
    if (Array.isArray(obj.turns)) {
      this.turns = obj.turns
        .filter((t): t is TurnStats => !!t && typeof t === "object")
        .slice(-MAX_TURNS);
    }
    if (obj.byDay && typeof obj.byDay === "object") {
      const days: Record<string, DayUsage> = {};
      for (const [key, v] of Object.entries(obj.byDay as Record<string, unknown>)) {
        if (v && typeof v === "object") {
          const d = v as Partial<DayUsage>;
          days[key] = {
            cost: num(d.cost),
            outputTokens: num(d.outputTokens),
            totalTokens: num(d.totalTokens),
            turns: num(d.turns),
          };
        }
      }
      this.byDay = days;
    }
    if (typeof obj.turnCounter === "number") this.turnCounter = obj.turnCounter;
  }

  /** A finished turn that never streamed (abort before first token). */
  isEmpty(): boolean {
    return this.turns.length === 0 && this.openTurn === null;
  }
}
