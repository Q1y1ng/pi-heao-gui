/**
 * In-app diff viewer.
 *
 * The rewind extension stores content-addressed snapshots at
 * ~/.pi/snapshots/<sessionId>/<sha256>, and pi-chat sends the clicked file's
 * baselineHash with the rewind-diff message — so "before" is the snapshot and
 * "after" is the file on disk. Nothing is opened in the OS default app anymore.
 */
import { BrowserWindow } from "electron";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { unifiedDiff, type DiffResult } from "./diff";
import { log, errText } from "./log";

export interface DiffRequest {
  absPath: string;
  baselineHash?: string | null;
  sessionId?: string;
  /** Shown in the header; falls back to the file name. */
  basename?: string;
}

const SNAP_ROOT = join(homedir(), ".pi", "snapshots");
const MAX_HTML = 4 * 1024 * 1024;
const CONTEXT_LINES = 3;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The one path shape a rewind snapshot can have: a hash or a session id, never a path. */
export const SAFE_SNAPSHOT_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * A snapshot segment straight from the renderer. It becomes part of a path
 * (`~/.pi/snapshots/<sessionId>/<baselineHash>`), so it is not trusted to be a path itself:
 * `..` used to walk out of the snapshot root and read whatever it found there.
 */
export function safeSnapshotSegment(value: unknown): string {
  // A string, or nothing: the caller is the IPC boundary, and "42" from a number is a directory
  // name nobody asked for.
  if (typeof value !== "string") return "";
  const text = value;
  // `.` and `..` are the two names that are *always* a path rather than a segment, and Windows
  // silently drops a trailing dot or space when it resolves a name — none of which a session id or
  // a snapshot hash ($sha256 of the file's content) can legitimately contain.
  if (text === "." || text === "..") return "";
  if (/[ .]$/.test(text)) return "";
  return SAFE_SNAPSHOT_SEGMENT.test(text) ? text : "";
}

/**
 * How much of a file the diff window will read, and how much markup it will render.
 *
 * Both were unbounded: `pi:show-diff` / `pi:rewind-diff` take an `absPath` from the renderer, and a
 * 500 MB file used to be read whole into the main process, split into lines, rendered into an HTML
 * string several times its size and written to disk — with `MAX_HTML` checked *after* the write, so
 * its only effect was a log line. Refusing is the honest answer: a diff of a file that big is not
 * readable anyway.
 */
export const MAX_DIFF_BYTES = 8 * 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

async function readIfExists(
  path: string | null,
  maxBytes = MAX_DIFF_BYTES,
): Promise<string | null> {
  if (!path) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > maxBytes) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Resolve the "before" text: snapshot when the hash is known, else git HEAD. */
async function resolveBefore(req: DiffRequest): Promise<{ text: string | null; label: string }> {
  const sessionId = safeSnapshotSegment(req.sessionId);
  const baselineHash = safeSnapshotSegment(req.baselineHash);
  if (sessionId && baselineHash) {
    // Both segments are renderer-supplied and were joined into a path as-is: `..` walked
    // straight out of the snapshot root and read whatever it found there.
    const snap = join(SNAP_ROOT, sessionId, baselineHash);
    const text = await readIfExists(snap, MAX_SNAPSHOT_BYTES);
    if (text !== null) return { text, label: "回退快照" };
  }
  if (req.baselineHash === null) {
    return { text: null, label: "文件原不存在" };
  }
  return { text: null, label: "无基线快照" };
}

function renderBody(diff: DiffResult): string {
  if (!diff.hunks.length) {
    return '<div class="empty">没有差异 —— 文件内容与基线一致。</div>';
  }
  const parts: string[] = [];
  for (const hunk of diff.hunks) {
    parts.push(`<div class="hunk-header">${escapeHtml(hunk.header)}</div>`);
    for (const line of hunk.lines) {
      const ln = line.left === null ? "" : String(line.left);
      const rn = line.right === null ? "" : String(line.right);
      const cls = line.op === "add" ? "add" : line.op === "del" ? "del" : "ctx";
      const sign = line.op === "add" ? "+" : line.op === "del" ? "-" : " ";
      parts.push(
        `<div class="row ${cls}"><span class="ln">${ln}</span><span class="ln">${rn}</span>` +
          `<span class="sign">${sign}</span><span class="code">${escapeHtml(line.text) || " "}</span></div>`,
      );
    }
  }
  return parts.join("");
}

function renderHtml(opts: {
  title: string;
  subtitle: string;
  diff: DiffResult;
  note: string;
}): string {
  const { diff } = opts;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(opts.title)}</title>
<style>
  :root {
    --bg: #0e1013; --surface: #14171c; --raised: #1a1e24; --border: #262c35;
    --text: #e7eaf0; --dim: #9ba3af; --add: #1f6f43; --add-bg: #12261b;
    --del: #a13b3b; --del-bg: #2a1618; --accent: #4c8dff;
    --font-ui: "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei UI", sans-serif;
    --font-mono: "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--font-ui); }
  header {
    display: flex; align-items: center; gap: 12px; padding: 10px 14px;
    background: linear-gradient(180deg, #171b21, #14171c); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 2;
  }
  .title { font-size: 13px; font-weight: 600; }
  .sub { font-size: 11px; color: var(--dim); font-family: var(--font-mono); }
  .stats { margin-left: auto; display: flex; gap: 8px; align-items: center; font-size: 11px; }
  .pill { padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--raised); }
  .pill.add { color: #7ee2a8; border-color: #235c3b; }
  .pill.del { color: #f08c8c; border-color: #71302f; }
  button {
    font-family: inherit; font-size: 11px; color: var(--text); background: var(--raised);
    border: 1px solid var(--border); border-radius: 7px; padding: 4px 10px; cursor: pointer;
  }
  button:hover { background: #232830; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  main { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55; padding: 8px 0 40px; }
  .hunk-header {
    color: var(--dim); background: var(--surface); padding: 4px 14px; margin: 10px 0 4px;
    border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); font-size: 11.5px;
  }
  .row { display: flex; white-space: pre; }
  .row.add { background: var(--add-bg); }
  .row.del { background: var(--del-bg); }
  .ln { width: 54px; text-align: right; padding-right: 10px; color: #5c6470; user-select: none; flex: none; }
  .sign { width: 16px; flex: none; color: var(--dim); }
  .row.add .sign { color: #7ee2a8; }
  .row.del .sign { color: #f08c8c; }
  .code { padding-right: 16px; }
  .row.add .code { color: #cbf2da; }
  .row.del .code { color: #f3cccc; }
  .empty { padding: 40px; text-align: center; color: var(--dim); font-family: var(--font-ui); }
  .note { font-size: 11px; color: var(--dim); padding: 6px 14px; }
  body.wrap .row { white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>
<header>
  <span class="title">${escapeHtml(opts.title)}</span>
  <span class="sub">${escapeHtml(opts.subtitle)}</span>
  <span class="stats">
    <span class="pill add">+${diff.added}</span>
    <span class="pill del">-${diff.removed}</span>
    ${diff.truncated ? '<span class="pill">大文件：按整块替换显示</span>' : ""}
    <button id="wrap" title="切换自动换行">换行</button>
    <button id="copy" title="复制为 unified diff 文本">复制</button>
  </span>
</header>
<main id="body">${renderBody(diff)}</main>
<div class="note">${escapeHtml(opts.note)}</div>
<script>
  document.getElementById('wrap').addEventListener('click', function () {
    document.body.classList.toggle('wrap');
  });
  document.getElementById('copy').addEventListener('click', function () {
    var lines = [];
    document.querySelectorAll('.hunk-header, .row').forEach(function (el) {
      if (el.classList.contains('hunk-header')) { lines.push(el.textContent); return; }
      var sign = el.querySelector('.sign').textContent;
      lines.push(sign + el.querySelector('.code').textContent);
    });
    navigator.clipboard.writeText(lines.join('\\n'));
  });
</script>
</body>
</html>`;
}

/** Unified diff between the rewind baseline snapshot and the file on disk. */
export async function openDiffWindow(req: DiffRequest): Promise<{ ok: boolean; error?: string }> {
  const abs = String(req.absPath || "");
  if (!abs) return { ok: false, error: "缺少文件路径" };

  const after = await readIfExists(abs);
  if (after === null) return { ok: false, error: "文件不存在或无法读取" };
  const before = await resolveBefore(req);

  const note =
    before.label === "回退快照"
      ? "基线 = 该轮对话开始前的快照；右侧为当前磁盘内容。操作：rewind-accept 保留 / rewind-revert 回退。"
      : before.label === "文件原不存在"
        ? "会话开始时该文件不存在，以下为新增内容。"
        : "未找到基线快照，以下为当前文件内容。";

  const diff = unifiedDiff(before.text ?? "", after, { context: CONTEXT_LINES });
  const title = `变更：${req.basename || basename(abs)}`;
  const html = renderHtml({ title, subtitle: abs, diff, note });
  // Rendered size is what actually fills memory and disk; the read cap above does not bound it
  // (one line of one character becomes ~60 bytes of markup). Checked here, before writing.
  if (html.length > MAX_HTML) {
    return {
      ok: false,
      error: `这个文件的差异太大，不渲染（${Math.round(html.length / 1024 / 1024)} MB）`,
    };
  }

  const dir = join(homedir(), ".pi", "standalone", "diff");
  const file = join(dir, `diff-${Date.now().toString(36)}.html`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(file, html, "utf8");
  } catch (e) {
    log.warn("diff window write:", errText(e));
    return { ok: false, error: errText(e) };
  }

  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    title,
    backgroundColor: "#0e1013",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    void unlink(file).catch(() => undefined);
  });
  await win.loadFile(file);
  return { ok: true };
}
