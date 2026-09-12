/**
 * Minimal unified-diff engine for the built-in diff viewer.
 *
 * The rewind extension only hands us file paths (and a snapshot hash), so the
 * viewer needs its own line diff. Classic LCS with a bounded dynamic program:
 * for very large files the DP table would explode, so above `MAX_DP` lines per
 * side we fall back to a cheap prefix/suffix trim plus one big replace hunk
 * (still correct output, just not minimally aligned).
 */

export type DiffOp = "context" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the left/old file (null for additions). */
  left: number | null;
  /** 1-based line number in the right/new file (null for deletions). */
  right: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  truncated: boolean;
}

const MAX_DP = 2000;
const CONTEXT = 3;

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  // An empty file has zero lines — not one empty line, which would otherwise
  // show up as a phantom deletion when diffing a new/empty file.
  if (normalized === "") return [];
  const lines = normalized.split("\n");
  // a trailing newline produces one empty trailing element that is not a line
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

interface RawOp {
  op: DiffOp;
  text: string;
}

/** LCS backtracking over the trimmed middle. */
function diffMiddle(a: string[], b: string[]): RawOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((text) => ({ op: "add" as const, text }));
  if (m === 0) return a.map((text) => ({ op: "del" as const, text }));
  if (n > MAX_DP || m > MAX_DP) {
    return [
      ...a.map((text) => ({ op: "del" as const, text })),
      ...b.map((text) => ({ op: "add" as const, text })),
    ];
  }

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  const out: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "context", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "del", text: a[i] });
      i++;
    } else {
      out.push({ op: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

/** Strip the common prefix/suffix so the DP only sees what really changed. */
function diffLines(a: string[], b: string[]): RawOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: RawOp[] = a.slice(0, start).map((text) => ({ op: "context" as const, text }));
  const middle = diffMiddle(a.slice(start, endA), b.slice(start, endB));
  const tail: RawOp[] = a.slice(endA).map((text) => ({ op: "context" as const, text }));
  return [...head, ...middle, ...tail];
}

export function unifiedDiff(
  before: string,
  after: string,
  opts: { leftLabel?: string; rightLabel?: string; context?: number } = {},
): DiffResult {
  const context = opts.context ?? CONTEXT;
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = diffLines(a, b);

  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.op === "add") added++;
    else if (o.op === "del") removed++;
  }

  // number the ops
  const numbered: DiffLine[] = [];
  let left = 1;
  let right = 1;
  for (const o of ops) {
    if (o.op === "context") {
      numbered.push({ op: "context", text: o.text, left: left++, right: right++ });
    } else if (o.op === "del") {
      numbered.push({ op: "del", text: o.text, left: left++, right: null });
    } else {
      numbered.push({ op: "add", text: o.text, left: null, right: right++ });
    }
  }

  // group into hunks separated by more than 2*context unchanged lines
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let gap = 0;
  const flush = (): void => {
    if (!current.length) return;
    const first = current[0];
    const lStart = first.left ?? first.right ?? 0;
    const rStart = first.right ?? first.left ?? 0;
    const lCount = current.filter((l) => l.left !== null).length;
    const rCount = current.filter((l) => l.right !== null).length;
    hunks.push({
      header: `@@ -${lStart},${lCount} +${rStart},${rCount} @@`,
      lines: current,
    });
    current = [];
  };

  for (const line of numbered) {
    if (line.op === "context") {
      gap++;
      if (gap > context * 2) flush();
      if (current.length || gap <= context) current.push(line);
      if (current.length > 0 && gap > context) {
        // drop the leading context that is further than `context` from a change
        while (current.length > context + 1 && current[0].op === "context") current.shift();
      }
    } else {
      gap = 0;
      current.push(line);
    }
  }
  flush();

  // second pass: trim trailing context per hunk
  for (const hunk of hunks) {
    while (hunk.lines.length > 1 && hunk.lines[hunk.lines.length - 1].op === "context") {
      const countOf = hunk.lines.filter((l) => l.op === "context").length;
      if (countOf <= context) break;
      hunk.lines.pop();
    }
  }

  const kept = hunks.filter((h) => h.lines.some((l) => l.op !== "context"));
  return {
    hunks: kept,
    added,
    removed,
    truncated: a.length > MAX_DP || b.length > MAX_DP,
  };
}

/** Convenience for callers that only need counts (widgets, badges). */
export function diffStat(before: string, after: string): { added: number; removed: number } {
  const r = unifiedDiff(before, after);
  return { added: r.added, removed: r.removed };
}
