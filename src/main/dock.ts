import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from "./file-kind";

/**
 * Bottom dock: the standalone replacement for what VS Code itself provided in
 * the original extension — a real terminal (upstream `terminal.ts`), a way to
 * read/edit files and push a selection into the chat (upstream `add-to-chat.ts`)
 * and commit-message generation (upstream `gitCommit/`).
 *
 * xterm.js and CodeMirror are UMD builds inlined from
 * `dist/renderer/vendor/` — no network, no bundler, CSP untouched.
 */
export const DOCK_HTML = `
<div id="pi-dock" hidden>
  <div class="pi-dock-resize" id="pi-dock-resize" title="拖动调整高度"></div>
  <div class="pi-dock-head">
    <div class="pi-dock-tabs">
      <button class="pi-dock-tab active" data-dock="term" type="button">终端</button>
      <button class="pi-dock-tab" data-dock="files" type="button">文件</button>
      <button class="pi-dock-tab" data-dock="changes" type="button">变更</button>
    </div>
    <span class="pi-dock-meta" id="pi-dock-meta"></span>
    <div class="pi-dock-actions">
      <button class="pi-dock-btn" id="pi-term-kind" type="button" title="在 pi TUI 与系统 shell 之间切换">pi TUI</button>
      <button class="pi-dock-btn" id="pi-term-restart" type="button" title="重启终端">重启</button>
      <button class="pi-dock-btn" id="pi-dock-close" type="button" title="关闭面板 (Ctrl+\`)">✕</button>
    </div>
  </div>
  <div class="pi-dock-body">
    <div class="pi-dock-pane active" id="pi-pane-term"><div id="pi-dock-term"></div></div>
    <div class="pi-dock-pane" id="pi-pane-files">
      <div class="pi-files-side">
        <div class="pi-files-head">
          <span id="pi-files-path">.</span>
          <button class="pi-dock-btn" id="pi-files-up" type="button" title="上一级">↑</button>
        </div>
        <div id="pi-files-list"></div>
      </div>
      <div class="pi-files-main">
        <div class="pi-files-bar">
          <span id="pi-files-name">未打开文件</span>
          <span class="pi-files-spacer"></span>
          <button class="pi-dock-btn" id="pi-files-send" type="button" title="把选中的内容发送到对话输入框">发送选中到对话</button>
          <button class="pi-dock-btn primary" id="pi-files-save" type="button" title="保存 (Ctrl+S)">保存</button>
        </div>
        <textarea id="pi-files-editor" spellcheck="false" placeholder="从左侧选择一个文件…"></textarea>
        <div id="pi-files-media" hidden></div>
      </div>
    </div>
    <div class="pi-dock-pane" id="pi-pane-changes">
      <div class="pi-git-side">
        <div class="pi-files-head"><span id="pi-git-branch">git</span>
            <select id="pi-worktree" title="选择工作副本"></select>
          <button class="pi-dock-btn" id="pi-git-refresh" type="button" title="刷新">刷新</button>
        </div>
        <div id="pi-git-list"></div>
        <div class="pi-git-actions">
          <input type="text" id="pi-git-notes" placeholder="给模型的备注（可选）" />
          <button class="pi-dock-btn primary" id="pi-git-generate" type="button">生成提交信息</button>
        </div>
        <div class="pi-git-hint" id="pi-git-hint">默认使用已暂存改动（git add 后）；没有暂存则用工作区改动。</div>
      </div>
      <div class="pi-git-main">
        <div class="pi-files-bar">
          <span>提交信息</span>
          <span class="pi-files-spacer"></span>
          <button class="pi-dock-btn" id="pi-commit-copy" type="button">复制</button>
          <button class="pi-dock-btn" id="pi-commit-insert" type="button" title="插入到对话输入框">插入到对话</button>
        </div>
        <textarea id="pi-commit-msg" spellcheck="false" placeholder="生成后会显示在这里，可以直接编辑…"></textarea>
      </div>
    </div>
  </div>
</div>`;

export const DOCK_CSS = `
/* ── Bottom dock (terminal / files / changes) ────────────────────────── */
#pi-dock {
  order: 9;
  flex: none;
  height: var(--pi-dock-height, 42%);
  min-height: 160px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--pi-border);
  background: var(--pi-surface);
  position: relative;
}
#pi-dock[hidden] { display: none; }
.pi-dock-resize {
  position: absolute; top: -3px; left: 0; right: 0; height: 6px;
  cursor: ns-resize; z-index: 5;
}
.pi-dock-head {
  display: flex; align-items: center; gap: 10px; padding: 0 8px 0 4px;
  height: 34px; flex: none; border-bottom: 1px solid var(--pi-border);
  background: var(--pi-raised);
}
.pi-dock-tabs { display: flex; gap: 2px; }
.pi-dock-tab {
  font-family: inherit; font-size: var(--pi-fs-sm); padding: 5px 12px; cursor: pointer;
  background: none; border: none; color: var(--pi-text-dim);
  border-bottom: 2px solid transparent;
}
.pi-dock-tab:hover { color: var(--pi-text); }
.pi-dock-tab.active { color: var(--pi-text); border-bottom-color: var(--pi-accent); }
.pi-dock-meta {
  font-family: var(--pi-font-mono); font-size: var(--pi-fs-xs); color: var(--pi-text-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pi-dock-actions { margin-left: auto; display: flex; gap: 6px; }
.pi-dock-btn {
  font-family: inherit; font-size: var(--pi-fs-xs); padding: 3px 9px; cursor: pointer;
  background: var(--pi-raised); color: var(--pi-text-dim);
  border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm);
}
.pi-dock-btn:hover { color: var(--pi-text); border-color: var(--pi-border-strong); }
.pi-dock-btn.primary { background: var(--pi-accent); color: #fff; border-color: var(--pi-accent); }
.pi-dock-body { flex: 1; min-height: 0; position: relative; }
.pi-dock-pane { position: absolute; inset: 0; display: none; }
.pi-dock-pane.active { display: flex; }
#pi-pane-term { padding: 4px 6px; }
#pi-dock-term { flex: 1; min-width: 0; height: 100%; }
#pi-dock-term .xterm { height: 100%; }
.pi-files-side { width: 240px; flex: none; border-right: 1px solid var(--pi-border); display: flex; flex-direction: column; }
.pi-files-main, .pi-git-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pi-git-side { width: 280px; flex: none; border-right: 1px solid var(--pi-border); display: flex; flex-direction: column; gap: 6px; padding: 6px; }
.pi-files-head {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; flex: none;
  font-family: var(--pi-font-mono); font-size: var(--pi-fs-xs); color: var(--pi-text-dim);
  border-bottom: 1px solid var(--pi-border);
}
#pi-files-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#pi-files-list, #pi-git-list { flex: 1; overflow: auto; padding: 4px 0; }
#pi-worktree {
  display: none;
  max-width: 190px;
  background: var(--pi-surface, #14171c);
  color: var(--pi-text, #e6e9ef);
  border: 1px solid var(--pi-border, #252a32);
  border-radius: var(--pi-radius, 6px);
  font-size: var(--pi-fs-sm, 12px);
  font-family: inherit;
  padding: 2px 4px;
}
.pi-files-row {
  display: flex; align-items: center; gap: 6px; padding: 3px 8px; cursor: pointer;
  font-size: var(--pi-fs-sm); color: var(--pi-text-dim); white-space: nowrap;
}
.pi-files-row:hover { background: var(--pi-raised); color: var(--pi-text); }
.pi-files-row.active { background: var(--pi-accent-soft); color: var(--pi-text); }
  /* No opacity on the arrow/dot glyph. The contrast gate composites opacity into the ratio, and 0.7
     pulled this to 2.99:1 in the light theme even though the colour itself measures 5.59:1 there.
     The token already carries the hierarchy — an opacity on top of it only costs readability. */
  .pi-files-row .pi-files-icon { width: 14px; text-align: center; }
.pi-files-bar {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; flex: none;
  border-bottom: 1px solid var(--pi-border); font-size: var(--pi-fs-sm);
}
.pi-files-spacer { flex: 1; }
#pi-files-media {
flex: 1; display: flex; align-items: center; justify-content: center;
overflow: auto; background: var(--pi-bg); padding: 8px;
}
#pi-files-media img { max-width: 100%; max-height: 100%; object-fit: contain; }
#pi-files-media audio { width: 100%; }
#pi-files-editor, #pi-commit-msg {
  flex: 1; width: 100%; resize: none; border: none; outline: none;
  background: var(--pi-bg); color: var(--pi-text);
  font-family: var(--pi-font-mono); font-size: var(--pi-fs-sm); line-height: 1.55; padding: 8px;
}
.pi-git-actions { display: flex; flex-direction: column; gap: 6px; padding: 0 0 4px; }
.pi-git-actions input {
  background: var(--pi-raised); color: var(--pi-text); font-family: inherit; font-size: var(--pi-fs-sm);
  border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); padding: 5px 7px; outline: none;
}
.pi-git-actions input:focus { border-color: var(--pi-accent); box-shadow: var(--pi-ring); }
.pi-git-hint { font-size: 10.5px; color: var(--pi-text-faint); line-height: 1.5; padding: 2px 0 4px; }
.pi-git-file { display: flex; gap: 8px; align-items: center; padding: 3px 6px; font-size: var(--pi-fs-sm); }
.pi-git-file .pi-git-add { color: var(--pi-success); font-family: var(--pi-font-mono); font-size: var(--pi-fs-xs); }
.pi-git-file .pi-git-del { color: var(--pi-danger); font-family: var(--pi-font-mono); font-size: var(--pi-fs-xs); }
.pi-git-file .pi-git-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-git-sec-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--pi-text-faint); padding: 6px 6px 2px; }
  .CodeMirror { height: 100% !important; background: var(--pi-bg) !important; color: var(--pi-text) !important; font-family: var(--pi-font-mono) !important; font-size: var(--pi-fs-sm) !important; }
  /* CodeMirror ships a palette chosen for a white background, and on our two themes half of it is
     unreadable: the accessibility gate measured a gutter number at 2.85:1 in the light theme and a
     string at 2.59:1 in the dark one, as soon as an open file put the editor on screen. These follow
     the same tokens as every other surface in the dock. Where the palette has no hue to spare that
     stays readable, the distinction comes from weight instead of colour. */
  .CodeMirror-gutters { background: var(--pi-surface) !important; border-right: 1px solid var(--pi-border) !important; }
  .CodeMirror-linenumber { color: var(--pi-text-dim) !important; }
  .CodeMirror-cursor { border-left-color: var(--pi-text) !important; }
  .CodeMirror-selected, .CodeMirror-focused .CodeMirror-selected { background: var(--pi-raised) !important; }
  .CodeMirror-matchingbracket { color: var(--pi-text) !important; border-bottom: 1px solid var(--pi-text-dim) !important; }
  .cm-comment { color: var(--pi-text-dim) !important; font-style: italic; }
  .cm-keyword, .cm-operator, .cm-def, .cm-builtin, .cm-meta, .cm-tag, .cm-attribute, .cm-qualifier, .cm-type { color: var(--pi-text) !important; font-weight: 600; }
  .cm-string, .cm-string-2, .cm-number, .cm-atom, .cm-property, .cm-variable, .cm-variable-2, .cm-variable-3, .cm-bracket, .cm-link { color: var(--pi-text) !important; }
`;

export const DOCK_SCRIPT = `
<script>
(function () {
  var dock = document.getElementById('pi-dock');
  if (!dock || !window.pi) return;

  var meta = document.getElementById('pi-dock-meta');
  var height = 42;

  function show(tab) {
    dock.hidden = false;
    document.documentElement.style.setProperty('--pi-dock-height', height + '%');
    document.querySelectorAll('.pi-dock-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-dock') === tab);
    });
    document.querySelectorAll('.pi-dock-pane').forEach(function (p) {
      p.classList.toggle('active', p.id === 'pi-pane-' + tab);
    });
    document.body.classList.add('pi-dock-open');
    if (tab === 'term') { ensureTerm(); setTimeout(fitTerm, 30); }
    if (tab === 'files') { loadTree(treePath); }
    if (tab === 'changes') { refreshGit(); }
  }
  function hide() {
    dock.hidden = true;
    document.body.classList.remove('pi-dock-open');
  }
  function toggle(tab) {
    if (!dock.hidden && (!tab || dock.querySelector('.pi-dock-tab.active').getAttribute('data-dock') === tab)) hide();
    else show(tab || 'term');
  }
  window.__piDock = { show: show, hide: hide, toggle: toggle };

  document.querySelectorAll('.pi-dock-tab').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-dock')); });
  });
  document.getElementById('pi-dock-close').addEventListener('click', hide);
  var tbToggle = document.getElementById('pi-dock-toggle');
  if (tbToggle) tbToggle.addEventListener('click', function () { toggle(null); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && (e.key === '\\\`' || e.key === '~')) { e.preventDefault(); toggle(null); }
  });

  // ── resize handle ──
  (function () {
    var grip = document.getElementById('pi-dock-resize');
    var dragging = false;
    grip.addEventListener('mousedown', function (e) { dragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var h = ((window.innerHeight - e.clientY) / window.innerHeight) * 100;
      height = Math.min(85, Math.max(15, h));
      document.documentElement.style.setProperty('--pi-dock-height', height + '%');
      fitTerm();
    });
    window.addEventListener('mouseup', function () { dragging = false; });
  })();

  // ── terminal (xterm + node-pty in the main process) ──
  var term = null, fitAddon = null, termKind = 'pi', termOpening = false;

  function fitTerm() {
    if (!term || !fitAddon) return;
    try {
      fitAddon.fit();
      window.pi.invoke('pi:term-resize', { cols: term.cols, rows: term.rows });
    } catch (e) { /* dock hidden */ }
  }

  async function ensureTerm() {
    if (term || termOpening) return;
    if (!window.Terminal) { meta.textContent = 'xterm.js 未加载'; return; }
    termOpening = true;
    var res = null;
    try {
      res = await window.pi.invoke('pi:term-open', { kind: termKind, cols: 100, rows: 26 });
    } catch (e) {
      meta.textContent = '终端启动失败: ' + e.message;
      termOpening = false;
      return;
    }
    if (!res || !res.ok) {
      meta.textContent = (res && res.error) || '终端不可用';
      termOpening = false;
      return;
    }
    term = new Terminal({
      fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      convertEol: false,
      allowProposedApi: true,
      theme: {
        background: '#0e1013', foreground: '#e7eaf0', cursor: '#4c8dff',
        selectionBackground: '#26405f'
      }
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('pi-dock-term'));
    fitTerm();
    term.onData(function (d) { window.pi.invoke('pi:term-input', d); });
    window.pi.onTermData(function (m) { if (m && m.data && term) term.write(m.data); });
    window.pi.onTermExit(function (m) {
      if (term) term.write('\\r\\n[进程已退出' + (m && m.code != null ? ' code=' + m.code : '') + ']\\r\\n');
    });
    meta.textContent = (res.kind === 'pi' ? 'pi TUI' : res.shell) + ' · ' + res.cwd;
    termOpening = false;
    window.__piTerm = term;
  }

  async function restartTerm() {
    if (term) { try { term.dispose(); } catch (e) {} term = null; fitAddon = null; }
    // An open that is still in flight would otherwise leave termOpening stuck,
    // and ensureTerm() would return immediately: the panel would show a dead
    // terminal that swallows every keystroke.
    termOpening = false;
    await window.pi.invoke('pi:term-close');
    ensureTerm();
  }

  document.getElementById('pi-term-restart').addEventListener('click', restartTerm);
  document.getElementById('pi-term-kind').addEventListener('click', function () {
    termKind = termKind === 'pi' ? 'shell' : 'pi';
    this.textContent = termKind === 'pi' ? 'pi TUI' : '系统 shell';
    restartTerm();
  });

  // ── files (browse, edit, push a selection into the chat) ──
  var treePath = '.';
  var currentFile = '';
  var cm = null;

  // Media previews. The decision comes from the extension alone, and the lists are injected from
  // file-kind.ts so the renderer and the pi:fs-media handler can never disagree about what an
  // image is. Everything that is not media keeps the editor path it always had.
  var IMAGE_EXT = ${JSON.stringify(IMAGE_EXTENSIONS)};
  var AUDIO_EXT = ${JSON.stringify(AUDIO_EXTENSIONS)};

  function extOf(name) {
    var s = String(name === null || name === undefined ? '' : name).toLowerCase();
    var dot = s.lastIndexOf('.');
    // Only '/' can separate here: loadTree builds these paths as workspace-relative strings, so
    // they are always forward-slashed. A literal backslash would have to be escaped twice inside
    // this template and is precisely what silently breaks the generated page; the full
    // either-separator rule lives in file-kind.ts, where it is unit-tested.
    var slash = s.lastIndexOf('/');
    return dot > slash ? s.slice(dot) : '';
  }

  function previewKindOf(name) {
    var e = extOf(name);
    if (IMAGE_EXT.indexOf(e) >= 0) return 'image';
    if (AUDIO_EXT.indexOf(e) >= 0) return 'audio';
    return 'text';
  }

  /** Swap the editor out for the media host, and back. The save/send buttons only mean something
   *  for text, so they go with the editor. */
  function setFileMode(mode) {
    var media = mode !== 'text';
    var host = document.getElementById('pi-files-media');
    var ta = document.getElementById('pi-files-editor');
    var cmEl = document.querySelector('.CodeMirror');
    if (host) host.hidden = !media;
    if (ta) ta.style.display = media ? 'none' : '';
    if (cmEl) cmEl.style.display = media ? 'none' : '';
    var save = document.getElementById('pi-files-save');
    var send = document.getElementById('pi-files-send');
    if (save) save.hidden = media;
    if (send) send.hidden = media;
  }

  function editor() {
    if (cm || !window.CodeMirror) return cm;
    var ta = document.getElementById('pi-files-editor');
    cm = CodeMirror.fromTextArea(ta, {
      lineNumbers: true, mode: 'text/x-typescript', theme: 'default',
      indentUnit: 2, lineWrapping: false
    });
    cm.setSize('100%', '100%');
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && !dock.hidden && currentFile) {
        e.preventDefault();
        saveFile();
      }
    });
    return cm;
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  }

  function modeFor(name) {
    if (/\\.(ts|tsx)$/.test(name)) return 'text/typescript';
    if (/\\.(js|jsx|mjs|cjs)$/.test(name)) return 'text/javascript';
    if (/\\.json$/.test(name)) return 'application/json';
    if (/\\.(md|markdown)$/.test(name)) return 'text/x-markdown';
    if (/\\.(html?)$/.test(name)) return 'text/html';
    if (/\\.css$/.test(name)) return 'text/css';
    if (/\\.py$/.test(name)) return 'text/x-python';
    if (/\\.(sh|bash)$/.test(name)) return 'text/x-sh';
    if (/\\.(yml|yaml)$/.test(name)) return 'text/x-yaml';
    if (/\\.rs$/.test(name)) return 'text/x-rust';
    if (/\\.go$/.test(name)) return 'text/x-go';
    return 'text/plain';
  }

  async function loadTree(path) {
    treePath = path || '.';
    var res = await window.pi.invoke('pi:fs-tree', treePath);
    var list = document.getElementById('pi-files-list');
    document.getElementById('pi-files-path').textContent = treePath;
    if (!res || !res.ok) { list.innerHTML = '<div class="pi-git-hint">' + esc((res && res.error) || '读取失败') + '</div>'; return; }
    var rows = (res.items || []).map(function (it) {
      return '<div class="pi-files-row" data-path="' + esc(it.path) + '" data-dir="' + (it.dir ? '1' : '0') + '">' +
        '<span class="pi-files-icon">' + (it.dir ? '▸' : '·') + '</span><span>' + esc(it.name) + '</span></div>';
    });
    list.innerHTML = rows.join('') || '<div class="pi-git-hint">空目录</div>';
  }

  async function openFile(path) {
    var kind = previewKindOf(path);
    if (kind !== 'text') {
      var media = await window.pi.invoke('pi:fs-media', path);
      if (!media || !media.ok) { meta.textContent = (media && media.error) || '读取失败'; return; }
      currentFile = path;
      document.getElementById('pi-files-name').textContent = path;
      var host = document.getElementById('pi-files-media');
      if (host) {
        host.textContent = '';
        var el = document.createElement(kind === 'image' ? 'img' : 'audio');
        el.id = kind === 'image' ? 'pi-files-image' : 'pi-files-audio';
        if (kind === 'image') { el.alt = ''; } else { el.controls = true; }
        el.src = media.dataUrl;
        host.appendChild(el);
      }
      setFileMode(kind);
      meta.textContent = (kind === 'image' ? '图片预览' : '音频预览') + ' · ' + Math.round((media.size || 0) / 1024) + ' KB';
      return;
    }
    var res = await window.pi.invoke('pi:fs-read', path);
    if (!res || !res.ok) { meta.textContent = (res && res.error) || '读取失败'; return; }
    currentFile = path;
    document.getElementById('pi-files-name').textContent = path;
    var ed = editor();
    setFileMode('text');
    if (ed) { ed.setOption('mode', modeFor(path)); ed.setValue(res.content || ''); }
    else { document.getElementById('pi-files-editor').value = res.content || ''; }
    meta.textContent = '已打开 ' + res.size + ' 字节';
  }

  async function saveFile() {
    // A binary file has no meaningful text content: writing the editor's value back would destroy
    // it. Refuse before touching the disk — Ctrl+S is bound globally and does not know what the
    // panel is showing.
    if (previewKindOf(currentFile) !== 'text') { meta.textContent = '图片/音频不在面板内编辑'; return; }
    var ed = editor();
    var content = ed ? ed.getValue() : document.getElementById('pi-files-editor').value;
    var res = await window.pi.invoke('pi:fs-write', { path: currentFile, content: content });
    meta.textContent = res && res.ok ? '已保存 ' + currentFile : '保存失败: ' + ((res && res.error) || '');
  }

  document.getElementById('pi-files-list').addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.pi-files-row') : null;
    if (!row) return;
    var path = row.getAttribute('data-path');
    if (row.getAttribute('data-dir') === '1') { loadTree(path); return; }
    openFile(path);
  });
  document.getElementById('pi-files-up').addEventListener('click', function () {
    var parts = treePath.split('/').filter(Boolean);
    parts.pop();
    loadTree(parts.join('/') || '.');
  });
  document.getElementById('pi-files-save').addEventListener('click', saveFile);
  document.getElementById('pi-files-send').addEventListener('click', function () {
    var ed = editor();
    var text = ed ? ed.getSelection() : '';
    if (!text) { meta.textContent = '先在编辑器里选择一段内容'; return; }
    var header = '文件: ' + currentFile + '\\n\\n';
    window.pi.postMessage({ type: 'appendInput', text: header + text });
    meta.textContent = '已发送 ' + text.length + ' 个字符到对话输入框';
  });

  // ── changes (git status + commit message) ──
  function gitRows(items, sign) {
    return (items || []).map(function (f) {
      return '<div class="pi-git-file"><span class="' + (sign === '+' ? 'pi-git-add' : 'pi-git-del') + '">' +
        (sign === '+' ? '+' + f.added : '-' + f.removed) + '</span><span class="pi-git-path">' + esc(f.path) + '</span></div>';
    }).join('');
  }

  async function refreshGit() {
    var res = await window.pi.invoke('pi:git-info');
    var list = document.getElementById('pi-git-list');
    if (!res || !res.ok || !res.repo) {
      document.getElementById('pi-git-branch').textContent = '非 git 仓库';
      list.innerHTML = '<div class="pi-git-hint">当前工作目录不是 git 仓库。</div>';
      return;
    }
    document.getElementById('pi-git-branch').textContent = res.branch || 'HEAD';
    list.innerHTML =
      '<div class="pi-git-sec-title">已暂存 (' + (res.staged || []).length + ')</div>' + gitRows(res.staged, '+') +
      '<div class="pi-git-sec-title">未暂存 (' + (res.unstaged || []).length + ')</div>' + gitRows(res.unstaged, '-');
  }

  // The refresh button belongs to the whole pane, and the worktree dropdown is part of it: a working
  // copy created with "git worktree add" while the app is running used to stay invisible until the
  // page was reloaded, which is a strange thing for a button labelled "refresh" to do.
  document.getElementById('pi-git-refresh').addEventListener('click', function () {
    refreshGit();
    refreshWorktrees();
  });

  // Worktrees of the same repository. Picking one switches the workspace, so the git pane, the
  // file list, the terminal and the next session all land in that working copy — the same concept
  // the workspace picker already uses, not a new one. Hidden unless there is more than one, since
  // a one-entry dropdown is noise.
  async function refreshWorktrees() {
    var sel = document.getElementById('pi-worktree');
    if (!sel) return;
    var res = await window.pi.invoke('pi:worktree-list');
    var list = (res && res.worktrees) || [];
    sel.innerHTML = '';
    if (list.length < 2) { sel.style.display = 'none'; return; }
    list.forEach(function (wt) {
      var opt = document.createElement('option');
      opt.value = wt.path;
      opt.textContent = wt.label;
      opt.title = wt.path + (wt.locked ? ' · 已锁定' : '') + (wt.prunable ? ' · 可清理' : '');
      if (res.current && wt.path === res.current) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.style.display = 'inline-block';
  }

  var worktreeSel = document.getElementById('pi-worktree');
  if (worktreeSel) {
    worktreeSel.addEventListener('change', async function () {
      var res = await window.pi.invoke('pi:worktree-use', worktreeSel.value);
      if (!res || !res.ok) {
        var hint = document.getElementById('pi-git-hint');
        if (hint) hint.textContent = (res && res.error) || '切换失败';
        refreshWorktrees();
        return;
      }
      refreshGit();
      refreshWorktrees();
    });
    refreshWorktrees();
  }
  document.getElementById('pi-git-generate').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    meta.textContent = '正在生成提交信息…';
    try {
      var res = await window.pi.invoke('pi:git-commit-message', {
        stagedOnly: true,
        notes: document.getElementById('pi-git-notes').value || ''
      });
      if (res && res.ok) {
        document.getElementById('pi-commit-msg').value = res.message || '';
        meta.textContent = res.truncated ? '已生成（diff 过大，按文件截断）' : '已生成';
      } else {
        meta.textContent = (res && res.error) || '生成失败';
      }
    } catch (e) {
      meta.textContent = '生成失败: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('pi-commit-copy').addEventListener('click', function () {
    var text = document.getElementById('pi-commit-msg').value;
    if (text) window.pi.invoke('pi:copy', text);
  });
  document.getElementById('pi-commit-insert').addEventListener('click', function () {
    var text = document.getElementById('pi-commit-msg').value;
    if (text) window.pi.postMessage({ type: 'appendInput', text: text });
  });

  // keep the terminal sized with the window
  window.addEventListener('resize', fitTerm);

  // ── provider login: settings asks us to run pi's /login in this terminal ──
  if (window.pi.onLoginRequest) {
    window.pi.onLoginRequest(async function (m) {
      var provider = (m && m.provider) || '';
      show('term');
      await ensureTerm();
      if (!term) {
        meta.textContent = '终端不可用，无法启动登录';
        return;
      }
      // give the TUI a moment to draw its composer before typing
      setTimeout(function () {
        window.pi.invoke('pi:term-input', '/login ' + provider + '\\r');
        meta.textContent = '已发送 /login ' + provider + ' —— 请在终端里完成授权';
      }, 1200);
    });
  }
})();
</script>`;
