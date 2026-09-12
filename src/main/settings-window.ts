import { TOKENS_CSS } from "./theme";

/**
 * Settings window for Pi Heao GUI.
 * Tabs: 模型配置 | 扩展插件 | 技能 | 系统提示词 | 常规
 * Models/auth/extensions are fully editable.
 *
 * Styling: the legacy rules above are kept for layout, and a design layer that
 * consumes the shared --pi-* tokens is appended last so it wins.
 */
export function buildSettingsHtml(): string {
  return `<!DOCTYPE html>
<!-- Pi Heao GUI V0.1 · made by HEAOZIE -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pi Heao GUI 设置</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  background:#1e1e1e;color:#d4d4d4;font-size:13px;height:100vh;display:flex;flex-direction:column}
.toolbar{padding:12px 16px;border-bottom:1px solid #3c3c3c;display:flex;align-items:center;gap:10px;background:#252526}
.toolbar h1{font-size:15px;font-weight:600;flex:1;color:#e8e8e8}
.toolbar button{padding:5px 12px;border-radius:5px;border:1px solid #4a4a4a;background:#333;color:#d4d4d4;cursor:pointer;font-size:12px}
.toolbar button.primary{background:#0e639c;border-color:#0e639c;color:#fff}
.toolbar button:hover{background:#3a3a3a}
.toolbar button.primary:hover{background:#1177bb}
.tabs{display:flex;border-bottom:1px solid #3c3c3c;padding:0 8px;background:#252526;overflow-x:auto}
.tab{padding:9px 14px;cursor:pointer;border-bottom:2px solid transparent;color:#999;font-size:12px;white-space:nowrap;user-select:none}
.tab:hover{color:#d4d4d4}
.tab.active{color:#4ec9b0;border-bottom-color:#4ec9b0}
.content{flex:1;overflow-y:auto;padding:16px}
.panel{display:none}
.panel.active{display:block}
.field{margin-bottom:14px}
.field label{display:block;margin-bottom:5px;color:#aaa;font-size:12px}
.field input,.field select,.field textarea{
  width:100%;padding:7px 10px;border-radius:5px;border:1px solid #454545;
  background:#2d2d2d;color:#d4d4d4;font-size:13px;font-family:inherit;
}
.field textarea{min-height:80px;resize:vertical;font-family:'Cascadia Code','Consolas',monospace;font-size:12px}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:#0e639c}
.field .hint{margin-top:3px;font-size:11px;color:#777}
.row{display:flex;gap:10px}
.row .field{flex:1}
.card{background:#252526;border:1px solid #3c3c3c;border-radius:6px;padding:12px;margin-bottom:10px}
.card-title{font-weight:600;color:#e0e0e0;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.card-desc{color:#999;font-size:12px;line-height:1.5}
.card-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;background:#0e639c;color:#fff}
.card-badge.warn{background:#8b5a00}
.card-badge.muted{background:#555}
.card-badge.ok{background:#2e7d32}
.list-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:5px;margin:3px 0;background:#2a2a2a}
.list-item:hover{background:#303030}
.list-item .name{flex:1;font-size:12px;color:#d4d4d4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list-item .meta{font-size:11px;color:#888;flex-shrink:0}
.json-editor{width:100%;min-height:200px;padding:10px;border-radius:5px;border:1px solid #454545;
  background:#1a1a1a;color:#d4d4d4;font-family:'Cascadia Code','Consolas',monospace;font-size:12px;resize:vertical}
.status{padding:6px 16px;border-top:1px solid #3c3c3c;font-size:11px;color:#888;background:#252526}
.brand{padding:0 16px 6px;font-size:9.5px;color:#4a4a4a;letter-spacing:0.35px;background:#252526;text-align:right;user-select:none;-webkit-user-select:none}
.status.ok{color:#4ec9b0}
.status.err{color:#f44747}
.checkbox-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.checkbox-row input[type=checkbox]{width:auto;accent-color:#0e639c}
.checkbox-row label{margin:0;color:#d4d4d4}
.empty-hint{text-align:center;padding:30px;color:#666;font-size:12px}
.section-title{font-size:13px;font-weight:600;color:#e0e0e0;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #333;display:flex;align-items:center;gap:8px}
.section-title:first-child{margin-top:0}
.section-title .btn-add{margin-left:auto;padding:3px 10px;border-radius:4px;border:1px solid #0e639c;background:transparent;color:#0e639c;cursor:pointer;font-size:11px}
.section-title .btn-add:hover{background:#0e639c;color:#fff}
.masked{font-family:monospace;letter-spacing:1px}
.btn-sm{padding:3px 8px;border-radius:4px;border:1px solid #555;background:transparent;color:#aaa;cursor:pointer;font-size:11px;white-space:nowrap}
.btn-sm:hover{background:#333;color:#fff}
.btn-sm.danger{border-color:#8b3a3a;color:#f44747}
.btn-sm.danger:hover{background:#5a1a1a}
.btn-sm.ok{border-color:#2e7d32;color:#4ec9b0}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:100}
.modal{background:#252526;border:1px solid #454545;border-radius:8px;padding:20px;width:480px;max-height:80vh;overflow-y:auto}
.modal h3{font-size:14px;margin-bottom:14px;color:#e8e8e8}
.modal .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.modal .actions button{padding:6px 16px;border-radius:5px;border:1px solid #4a4a4a;background:#333;color:#d4d4d4;cursor:pointer;font-size:12px}
.modal .actions button.primary{background:#0e639c;border-color:#0e639c;color:#fff}
.switch{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.switch .slider{position:absolute;cursor:pointer;inset:0;background:#555;border-radius:10px;transition:.2s}
.switch .slider:before{content:'';position:absolute;height:14px;width:14px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
.switch input:checked + .slider{background:#0e639c}
.switch input:checked + .slider:before{transform:translateX(16px)}
</style>
<style id="pi-heao-settings">
${TOKENS_CSS}
/* ── Design layer ───────────────────────────────────────────────────── */
body {
  background: var(--pi-bg);
  color: var(--pi-text);
  font-family: var(--pi-font-ui);
  font-size: var(--pi-fs-md);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* header */
.toolbar {
  height: 48px;
  padding: 0 16px;
  gap: 10px;
  background: linear-gradient(180deg, var(--pi-surface), #12141a);
  border-bottom: 1px solid var(--pi-border);
}
.toolbar .pi-tile {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #0b0b0b;
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 1px;
  box-sizing: border-box;
}
.toolbar h1 {
  font-size: var(--pi-fs-lg);
  font-weight: 600;
  color: var(--pi-text);
  margin-right: auto;
}
.toolbar .pi-ver {
  font-size: 9.5px;
  color: #464c56;
  letter-spacing: 0.35px;
  margin-right: 4px;
}
.toolbar button {
  padding: 6px 14px;
  border-radius: var(--pi-radius);
  border: 1px solid var(--pi-border);
  background: var(--pi-raised);
  color: var(--pi-text-dim);
  font-size: var(--pi-fs-sm);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--pi-speed), color var(--pi-speed), border-color var(--pi-speed);
}
.toolbar button:hover {
  background: var(--pi-overlay);
  border-color: var(--pi-border-strong);
  color: var(--pi-text);
}
.toolbar button.primary {
  background: var(--pi-accent);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}
.toolbar button.primary:hover {
  background: var(--pi-accent-hover);
}

/* tabs */
.tabs {
  background: var(--pi-surface);
  border-bottom: 1px solid var(--pi-border);
  padding: 0 12px;
  gap: 2px;
}
.tab {
  padding: 10px 12px 9px;
  color: var(--pi-text-dim);
  font-size: var(--pi-fs-sm);
  border-bottom: 2px solid transparent;
  transition: color var(--pi-speed), border-color var(--pi-speed);
}
.tab:hover {
  color: var(--pi-text);
}
.tab.active {
  color: var(--pi-accent);
  border-bottom-color: var(--pi-accent);
}

/* content */
.content {
  padding: 18px 20px 28px;
}
.section-title {
  font-size: var(--pi-fs-sm);
  font-weight: 600;
  color: var(--pi-text);
  border-bottom: 1px solid var(--pi-border);
  padding-bottom: 6px;
  margin: 22px 0 10px;
}
.section-title:first-child {
  margin-top: 0;
}
.section-title .btn-add {
  border: 1px solid var(--pi-accent);
  border-radius: var(--pi-radius-sm);
  color: var(--pi-accent);
  padding: 3px 10px;
  font-size: var(--pi-fs-xs);
  background: transparent;
}
.section-title .btn-add:hover {
  background: var(--pi-accent);
  color: #fff;
}

/* fields */
.field {
  margin-bottom: 14px;
}
.field label {
  font-size: var(--pi-fs-sm);
  color: var(--pi-text-dim);
  margin-bottom: 6px;
}
.field input,
.field select,
.field textarea,
.json-editor {
  padding: 8px 10px;
  border-radius: var(--pi-radius);
  border: 1px solid var(--pi-border);
  background: var(--pi-bg);
  color: var(--pi-text);
  font-size: var(--pi-fs-sm);
  font-family: inherit;
  transition: border-color var(--pi-speed), box-shadow var(--pi-speed);
}
.field textarea,
.json-editor {
  font-family: var(--pi-font-mono);
  font-size: var(--pi-fs-sm);
  line-height: 1.55;
  min-height: 96px;
}
.field input:hover,
.field select:hover,
.field textarea:hover,
.json-editor:hover {
  border-color: var(--pi-border-strong);
}
.field input:focus,
.field select:focus,
.field textarea:focus,
.json-editor:focus {
  outline: none;
  border-color: var(--pi-accent);
  box-shadow: var(--pi-ring);
}
.field .hint,
.hint {
  font-size: var(--pi-fs-xs);
  color: var(--pi-text-faint);
  margin-top: 4px;
}

/* cards + lists */
.card {
  background: var(--pi-surface);
  border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius-lg);
  padding: 12px 14px;
  margin-bottom: 10px;
}
.card-title {
  font-size: var(--pi-fs-md);
  color: var(--pi-text);
}
.card-desc {
  color: var(--pi-text-dim);
  font-size: var(--pi-fs-sm);
}
.card-badge {
  border-radius: var(--pi-radius-pill);
  padding: 1px 8px;
  font-size: 10px;
  background: var(--pi-accent-soft);
  color: var(--pi-accent);
}
.card-badge.ok {
  background: rgba(53, 192, 139, 0.15);
  color: var(--pi-success);
}
.card-badge.warn {
  background: rgba(226, 179, 65, 0.15);
  color: var(--pi-warn);
}
.card-badge.muted {
  background: var(--pi-overlay);
  color: var(--pi-text-dim);
}
.list-item {
  background: var(--pi-bg);
  border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius);
  padding: 8px 10px;
  transition: border-color var(--pi-speed), background var(--pi-speed);
}
.list-item:hover {
  background: var(--pi-raised);
  border-color: var(--pi-border-strong);
}
.list-item .name {
  color: var(--pi-text);
  font-size: var(--pi-fs-sm);
}
.list-item .meta {
  color: var(--pi-text-faint);
  font-size: var(--pi-fs-xs);
}
.empty-hint {
  color: var(--pi-text-faint);
  font-size: var(--pi-fs-sm);
}

/* buttons */
.btn-sm {
  padding: 3px 9px;
  border-radius: var(--pi-radius-sm);
  border: 1px solid var(--pi-border-strong);
  background: transparent;
  color: var(--pi-text-dim);
  font-size: var(--pi-fs-xs);
  font-family: inherit;
  transition: background var(--pi-speed), color var(--pi-speed), border-color var(--pi-speed);
}
.btn-sm:hover {
  background: var(--pi-overlay);
  color: var(--pi-text);
}
.btn-sm.danger {
  border-color: rgba(240, 97, 109, 0.5);
  color: var(--pi-danger);
}
.btn-sm.danger:hover {
  background: rgba(240, 97, 109, 0.14);
  color: var(--pi-danger);
}
.btn-sm.ok {
  border-color: rgba(53, 192, 139, 0.5);
  color: var(--pi-success);
}

/* switch */
.switch .slider {
  background: var(--pi-border-strong);
}
.switch input:checked + .slider {
  background: var(--pi-accent);
}
.checkbox-row input[type="checkbox"] {
  accent-color: var(--pi-accent);
}

/* modal */
.modal-bg {
  background: rgba(6, 8, 11, 0.66);
}
.modal {
  background: var(--pi-overlay);
  border: 1px solid var(--pi-border-strong);
  border-radius: var(--pi-radius-lg);
  box-shadow: var(--pi-shadow-2);
}
.modal h3 {
  color: var(--pi-text);
}
.modal .actions button {
  border-radius: var(--pi-radius);
  border: 1px solid var(--pi-border);
  background: var(--pi-raised);
  color: var(--pi-text-dim);
}
.modal .actions button.primary {
  background: var(--pi-accent);
  border-color: transparent;
  color: #fff;
}

/* footer */
.status {
  border-top: 1px solid var(--pi-border);
  background: var(--pi-surface);
  color: var(--pi-text-dim);
  font-size: var(--pi-fs-xs);
  padding: 7px 16px;
}
.status.ok {
  color: var(--pi-success);
}
.status.err {
  color: var(--pi-danger);
}
.brand {
  background: var(--pi-surface);
  color: #464c56;
  font-size: 9.5px;
  letter-spacing: 0.35px;
  padding: 0 16px 8px;
  text-align: right;
}

/* scrollbars */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #3a414d80;
  border: 2px solid transparent;
  background-clip: content-box;
  border-radius: var(--pi-radius-pill);
}
::-webkit-scrollbar-thumb:hover {
  background: #4a5361cc;
  background-clip: content-box;
}
::selection {
  background: rgba(76, 141, 255, 0.32);
}
</style>
</head>
<body>
<div class="toolbar">
  <span class="pi-tile" aria-hidden="true">π</span>
  <h1>Pi Heao GUI 设置</h1>
  <span class="pi-ver" title="Pi Heao GUI V0.1 — made by HEAOZIE">V0.1</span>
  <button id="btn-reload">重新加载</button>
  <button id="btn-save" class="primary">保存更改</button>
</div>
<div class="tabs">
  <div class="tab active" data-tab="models">模型配置</div>
  <div class="tab" data-tab="extensions">扩展插件</div>
  <div class="tab" data-tab="skills">技能</div>
  <div class="tab" data-tab="sysprompt">系统提示词</div>
  <div class="tab" data-tab="general">常规</div>
</div>
<div class="content">
  <!-- Models -->
  <div class="panel active" id="panel-models">
    <div class="section-title">模型提供商
      <button class="btn-add" id="btn-add-provider">+ 添加提供商</button>
    </div>
    <div id="models-list"></div>
    <div class="section-title">API 密钥
      <button class="btn-add" id="btn-add-auth">+ 添加密钥</button>
    </div>
    <div id="auth-list"></div>
    <div class="section-title">默认模型</div>
    <div class="field">
      <label>默认提供商</label>
      <select id="default-provider"><option value="">（无）</option></select>
    </div>
    <div class="field">
      <label>默认模型 ID</label>
      <input type="text" id="default-model" placeholder="例如 deepseek-v4-flash">
    </div>
  </div>
  <!-- Extensions -->
  <div class="panel" id="panel-extensions">
    <div class="section-title">npm 扩展包（settings.json → packages）</div>
    <div id="npm-packages"></div>
    <div class="section-title">本地扩展（~/.pi/agent/extensions/）</div>
    <div id="local-extensions"></div>
  </div>
  <!-- Skills -->
  <div class="panel" id="panel-skills">
    <div class="section-title">已安装技能</div>
    <div id="skills-list"></div>
    <div class="hint" style="color:#666;font-size:12px;margin-top:12px">
      技能目录：~/.pi/agent/skills/（每个子目录含 SKILL.md）
    </div>
  </div>
  <!-- System Prompt -->
  <div class="panel" id="panel-sysprompt">
    <div class="field">
      <label>追加系统提示词（APPEND_SYSTEM.md）— 追加到 pi 默认提示词之后</label>
      <textarea id="agent-append" rows="5" placeholder="在此输入要追加的内容…"></textarea>
    </div>
    <div class="field">
      <label>覆盖系统提示词（SYSTEM.md）— 完全替换 pi 默认提示词（慎用）</label>
      <textarea id="agent-override" rows="5" placeholder="留空则不覆盖"></textarea>
    </div>
  </div>
  <!-- General -->
  <div class="panel" id="panel-general">
    <div class="field">
      <label>pi 可执行文件路径（留空自动检测）</label>
      <input type="text" id="cfg-piPath" placeholder="例如 C:\\\\Users\\\\...\\\\npm\\\\pi.cmd">
    </div>
    <div class="field">
      <label>默认工作目录</label>
      <input type="text" id="cfg-workspaceRoot" placeholder="例如 E:\\\\AI\\\\my-project">
      <div class="hint">@file 搜索与文件对话框的根目录</div>
    </div>
    <div class="field">
      <label>界面语言</label>
      <select id="cfg-language">
        <option value="zh-cn">简体中文</option>
        <option value="en">English</option>
        <option value="auto">自动检测</option>
      </select>
    </div>
    <div class="field">
      <label>额外 CLI 参数（每行一个）</label>
      <textarea id="cfg-args" placeholder="--no-extensions"></textarea>
    </div>
    <div class="field">
      <label>环境变量（JSON 对象）</label>
      <textarea id="cfg-env" placeholder='{"KEY":"value"}'></textarea>
    </div>
    <div class="row">
      <div class="field">
        <label>字体大小</label>
        <input type="number" id="cfg-chatFontSize" min="8" max="32">
      </div>
      <div class="field">
        <label>发送快捷键</label>
        <select id="cfg-chatSendShortcut">
          <option value="enter">Enter 发送</option>
          <option value="ctrlEnter">Ctrl+Enter 发送</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>Mermaid 主题</label>
      <select id="cfg-chatMermaidTheme">
        <option value="default">default</option>
        <option value="neutral">neutral</option>
        <option value="dark">dark</option>
        <option value="forest">forest</option>
        <option value="base">base</option>
      </select>
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="cfg-mcpEnabled">
      <label for="cfg-mcpEnabled">启用 MCP</label>
    </div>
    <div class="field">
      <label>MCP 空闲断开（分钟，0=不断开）</label>
      <input type="number" id="cfg-mcpIdleTimeout" min="0">
    </div>
    <div class="field">
      <label>权限模式</label>
      <select id="cfg-permissionMode">
        <option value="AskForApproval">危险命令需确认</option>
        <option value="FullAccess">完全访问</option>
      </select>
    </div>
    <div class="field">
      <label>禁用的工具（逗号分隔）</label>
      <input type="text" id="cfg-disabledTools" placeholder="todo, subagent, questionnaire">
    </div>
    <div class="field">
      <label>settings.json（~/.pi/agent/settings.json）— 原始编辑</label>
      <textarea class="json-editor" id="agent-settings" rows="6"></textarea>
    </div>
    <div class="field">
      <label>models.json（~/.pi/agent/models.json）— 原始编辑</label>
      <textarea class="json-editor" id="agent-models-raw" rows="6"></textarea>
    </div>
    <div class="field">
      <label>auth.json（~/.pi/agent/auth.json）— 原始编辑（密钥以 •••• 掩码显示；不动掩码即保持原值）</label>
      <textarea class="json-editor" id="agent-auth-raw" rows="4"></textarea>
    </div>
  </div>
</div>
<div class="status" id="status">就绪</div>
<div class="brand" title="Pi Heao GUI V0.1 — made by HEAOZIE">made by HEAOZIE</div>
<script>
const $ = id => document.getElementById(id);
const status = $('status');
function setStatus(msg, ok) {
  status.textContent = msg;
  status.className = 'status' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// Tabs
document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('panel-' + t.dataset.tab).classList.add('active');
  };
});

// ── State ──
let modelsJson = {};
let authJson = {};
let settingsJson = {};

function maskKey(k) {
  if (!k) return '（未设置）';
  // main already masks secrets before they reach this window — don't mask twice
  if (k.indexOf('\u2022') !== -1) return k;
  if (k.length <= 8) return '••••••••';
  return k.slice(0, 4) + '••••••••' + k.slice(-4);
}

// ── Models rendering ──
function renderModels() {
  const el = $('models-list');
  const sel = $('default-provider');
  el.innerHTML = '';
  sel.innerHTML = '<option value="">（无）</option>';
  const providers = modelsJson.providers || {};
  const ids = Object.keys(providers);
  if (!ids.length) {
    el.innerHTML = '<div class="empty-hint">未配置模型提供商。点击上方「添加提供商」或编辑 models.json</div>';
  }
  for (const id of ids) {
    const p = providers[id];
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = p.name || id;
    sel.appendChild(opt);
    const modelIds = Object.keys(p.models || {});
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title">' + esc(p.name || id) +
        ' <span class="card-badge">' + esc(id) + '</span>' +
        '<span style="margin-left:auto;display:flex;gap:4px">' +
          '<button class="btn-sm" data-act="edit-provider" data-id="' + esc(id) + '">编辑</button>' +
          '<button class="btn-sm" data-act="add-model" data-id="' + esc(id) + '">+ 模型</button>' +
          '<button class="btn-sm danger" data-act="del-provider" data-id="' + esc(id) + '">删除</button>' +
        '</span>' +
      '</div>' +
      '<div class="card-desc">Base URL: ' + esc(p.baseUrl || '（默认）') + '</div>';
    // Model list
    const mlist = document.createElement('div');
    mlist.style.cssText = 'margin-top:8px';
    for (const mid of modelIds) {
      const m = p.models[mid];
      const row = document.createElement('div');
      row.className = 'list-item';
      row.innerHTML =
        '<span class="name">' + esc(mid) + (m.name ? ' <span style="color:#888">(' + esc(m.name) + ')</span>' : '') + '</span>' +
        '<button class="btn-sm" data-act="edit-model" data-pid="' + esc(id) + '" data-mid="' + esc(mid) + '">编辑</button>' +
        '<button class="btn-sm danger" data-act="del-model" data-pid="' + esc(id) + '" data-mid="' + esc(mid) + '">删除</button>';
      mlist.appendChild(row);
    }
    if (!modelIds.length) mlist.innerHTML = '<div style="color:#666;font-size:11px;padding:4px 0">无模型，点击「+ 模型」添加</div>';
    card.appendChild(mlist);
    el.appendChild(card);
  }
}

// ── Auth rendering ──
function renderAuth() {
  const el = $('auth-list');
  el.innerHTML = '';
  const keys = Object.keys(authJson);
  if (!keys.length) {
    el.innerHTML = '<div class="empty-hint">未配置 API 密钥。点击上方「添加密钥」</div>';
    return;
  }
  for (const provider of keys) {
    const raw = authJson[provider];
    const key = typeof raw === 'string' ? raw : (raw && raw.apiKey) || '';
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML =
      '<span class="name">' + esc(provider) + '</span>' +
      '<span class="meta masked">' + esc(maskKey(key)) + '</span>' +
      '<button class="btn-sm" data-act="edit-auth" data-id="' + esc(provider) + '">编辑</button>' +
      '<button class="btn-sm danger" data-act="del-auth" data-id="' + esc(provider) + '">删除</button>';
    el.appendChild(item);
  }
}

// ── Extensions rendering ──
function renderLocalExtensions(exts) {
  const el = $('local-extensions');
  el.innerHTML = '';
  if (!exts || !exts.length) {
    el.innerHTML = '<div class="empty-hint">无本地扩展</div>';
    return;
  }
  for (const e of exts) {
    const disabled = e.endsWith('.disabled') || e.endsWith('.disabled-vscode');
    const base = e.replace(/\\.disabled(-vscode)?$/, '');
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML =
      '<span class="name">' + esc(base) + '</span>' +
      (disabled ? '<span class="card-badge muted">已禁用</span>' : '<span class="card-badge ok">已启用</span>') +
      '<label class="switch"><input type="checkbox" ' + (disabled ? '' : 'checked') + ' data-ext="' + esc(base) + '"><span class="slider"></span></label>';
    const cb = item.querySelector('input');
    cb.onchange = async () => {
      try {
        const r = await window.pi.invoke('pi:toggle-extension', base, cb.checked);
        if (r && r.ok === false) throw new Error(r.error || '操作失败');
        setStatus(cb.checked ? '已启用 ' + base : '已禁用 ' + base, true);
        const data = await window.pi.invoke('pi:get-env-info');
        renderLocalExtensions(data.extensions || []);
      } catch (err) {
        setStatus('操作失败: ' + err.message, false);
        cb.checked = !cb.checked;
      }
    };
    el.appendChild(item);
  }
}

function renderNpmPackages(packages) {
  const el = $('npm-packages');
  el.innerHTML = '';
  if (!packages || !packages.length) {
    el.innerHTML = '<div class="empty-hint">未安装 npm 扩展包</div>';
    return;
  }
  for (const pkg of packages) {
    const name = String(pkg).replace(/^npm:/, '');
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = '<span class="name">' + esc(name) + '</span><span class="meta">npm</span>';
    el.appendChild(item);
  }
}

function renderSkills(skills) {
  const el = $('skills-list');
  el.innerHTML = '';
  if (!skills || !skills.length) {
    el.innerHTML = '<div class="empty-hint">未安装技能。在 ~/.pi/agent/skills/ 下创建包含 SKILL.md 的目录即可。</div>';
    return;
  }
  for (const s of skills) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-title">' + esc(s.name) + '</div><div class="card-desc">' + esc(s.description || '（无描述）') + '</div>';
    el.appendChild(card);
  }
}

// ── Modal helpers ──
function showModal(title, fields, onSubmit) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const modal = document.createElement('div');
  modal.className = 'modal';
  let html = '<h3>' + esc(title) + '</h3>';
  for (const f of fields) {
    html += '<div class="field"><label>' + esc(f.label) + '</label>';
    if (f.type === 'textarea') html += '<textarea id="mf-' + f.key + '" rows="' + (f.rows || 4) + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(f.value || '') + '</textarea>';
    else html += '<input type="text" id="mf-' + f.key + '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.placeholder || '') + '">';
    if (f.hint) html += '<div class="hint">' + esc(f.hint) + '</div>';
    html += '</div>';
  }
  html += '<div class="actions"><button id="mf-cancel">取消</button><button id="mf-ok" class="primary">确定</button></div>';
  modal.innerHTML = html;
  bg.appendChild(modal);
  document.body.appendChild(bg);
  $('mf-cancel').onclick = () => bg.remove();
  $('mf-ok').onclick = () => {
    const vals = {};
    for (const f of fields) vals[f.key] = $('mf-' + f.key).value;
    bg.remove();
    onSubmit(vals);
  };
  // Focus first field
  const first = modal.querySelector('input,textarea');
  if (first) first.focus();
}

// ── Model CRUD ──
$('btn-add-provider').onclick = () => {
  showModal('添加模型提供商', [
    { key: 'id', label: '提供商 ID（小写英文）', placeholder: 'my-provider' },
    { key: 'name', label: '显示名称', placeholder: 'My Provider' },
    { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com/v1' },
  ], v => {
    if (!v.id.trim()) { setStatus('提供商 ID 不能为空', false); return; }
    modelsJson.providers = modelsJson.providers || {};
    modelsJson.providers[v.id.trim()] = { name: v.name || v.id, baseUrl: v.baseUrl || '', models: {} };
    renderModels();
    setStatus('已添加提供商 ' + v.id + '（记得保存）', true);
  });
};

$('btn-add-auth').onclick = () => {
  showModal('添加 API 密钥', [
    { key: 'provider', label: '提供商 ID', placeholder: 'openai / deepseek / ...' },
    { key: 'key', label: 'API Key', placeholder: 'sk-...' },
  ], v => {
    if (!v.provider.trim() || !v.key.trim()) { setStatus('提供商和密钥不能为空', false); return; }
    authJson[v.provider.trim()] = v.key.trim();
    renderAuth();
    setStatus('已添加密钥（记得保存）', true);
  });
};

// Delegated click for model cards
$('models-list').onclick = (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const pid = btn.dataset.pid;
  const mid = btn.dataset.mid;

  if (act === 'edit-provider') {
    const p = modelsJson.providers[id] || {};
    showModal('编辑提供商: ' + id, [
      { key: 'name', label: '显示名称', value: p.name || '' },
      { key: 'baseUrl', label: 'Base URL', value: p.baseUrl || '' },
    ], v => {
      modelsJson.providers[id].name = v.name || id;
      modelsJson.providers[id].baseUrl = v.baseUrl || '';
      renderModels();
      setStatus('已更新（记得保存）', true);
    });
  }
  if (act === 'del-provider') {
    if (confirm('确定删除提供商 "' + id + '" 及其所有模型？')) {
      delete modelsJson.providers[id];
      renderModels();
      setStatus('已删除（记得保存）', true);
    }
  }
  if (act === 'add-model') {
    showModal('添加模型到 ' + id, [
      { key: 'modelId', label: '模型 ID', placeholder: 'gpt-4o / deepseek-chat' },
      { key: 'name', label: '显示名称（可选）', placeholder: 'GPT-4o' },
      { key: 'contextWindow', label: '上下文窗口（可选）', placeholder: '128000' },
    ], v => {
      if (!v.modelId.trim()) { setStatus('模型 ID 不能为空', false); return; }
      modelsJson.providers[id].models = modelsJson.providers[id].models || {};
      const m = {};
      if (v.name) m.name = v.name;
      if (v.contextWindow) m.contextWindow = Number(v.contextWindow) || undefined;
      modelsJson.providers[id].models[v.modelId.trim()] = m;
      renderModels();
      setStatus('已添加模型（记得保存）', true);
    });
  }
  if (act === 'edit-model') {
    const m = (modelsJson.providers[pid].models || {})[mid] || {};
    showModal('编辑模型: ' + mid, [
      { key: 'name', label: '显示名称', value: m.name || '' },
      { key: 'contextWindow', label: '上下文窗口', value: m.contextWindow || '' },
    ], v => {
      modelsJson.providers[pid].models[mid] = { ...m, name: v.name || undefined, contextWindow: Number(v.contextWindow) || undefined };
      renderModels();
      setStatus('已更新（记得保存）', true);
    });
  }
  if (act === 'del-model') {
    if (confirm('删除模型 "' + mid + '"？')) {
      delete modelsJson.providers[pid].models[mid];
      renderModels();
      setStatus('已删除（记得保存）', true);
    }
  }
};

$('auth-list').onclick = (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (act === 'edit-auth') {
    const raw = authJson[id];
    const key = typeof raw === 'string' ? raw : (raw && raw.apiKey) || '';
    showModal('编辑密钥: ' + id, [
      { key: 'key', label: 'API Key', value: key },
    ], v => {
      authJson[id] = v.key.trim();
      renderAuth();
      setStatus('已更新（记得保存）', true);
    });
  }
  if (act === 'del-auth') {
    if (confirm('删除 "' + id + '" 的密钥？')) {
      delete authJson[id];
      renderAuth();
      setStatus('已删除（记得保存）', true);
    }
  }
};

// ── Load / Save ──
let currentConfig = {};

async function loadAll() {
  try {
    currentConfig = await window.pi.invoke('pi:get-config');
    $('cfg-piPath').value = currentConfig.piPath || '';
    $('cfg-workspaceRoot').value = currentConfig.workspaceRoot || '';
    $('cfg-language').value = currentConfig.language || 'zh-cn';
    $('cfg-args').value = (currentConfig.args || []).join('\\n');
    $('cfg-env').value = JSON.stringify(currentConfig.env || {}, null, 2);
    $('cfg-chatFontSize').value = currentConfig.chatFontSize || 13;
    $('cfg-chatSendShortcut').value = currentConfig.chatSendShortcut || 'enter';
    $('cfg-chatMermaidTheme').value = currentConfig.chatMermaidTheme || 'default';
    $('cfg-mcpEnabled').checked = !!currentConfig.mcpEnabled;
    $('cfg-mcpIdleTimeout').value = currentConfig.mcpIdleTimeout ?? 10;
    $('cfg-permissionMode').value = currentConfig.permissionMode || 'AskForApproval';
    $('cfg-disabledTools').value = (currentConfig.disabledTools || []).join(', ');

    const agent = await window.pi.invoke('pi:read-agent-files');
    $('agent-append').value = agent.append || '';
    $('agent-override').value = agent.override || '';
    $('agent-settings').value = agent.settings || '{}';
    $('agent-models-raw').value = agent.models || '{}';
    $('agent-auth-raw').value = agent.auth || '{}';

    try { modelsJson = JSON.parse(agent.models || '{}'); } catch { modelsJson = {}; }
    try { authJson = JSON.parse(agent.auth || '{}'); } catch { authJson = {}; }
    try { settingsJson = JSON.parse(agent.settings || '{}'); } catch { settingsJson = {}; }

    renderModels();
    renderAuth();
    renderNpmPackages(settingsJson.packages || []);

    const data = await window.pi.invoke('pi:get-env-info');
    renderLocalExtensions(data.extensions || []);
    renderSkills(data.skills || []);

    setStatus('已加载配置');
  } catch (e) {
    setStatus('加载失败: ' + e.message, false);
  }
}

async function saveAll() {
  try {
    let env = {};
    try { env = JSON.parse($('cfg-env').value || '{}'); } catch { throw new Error('环境变量 JSON 无效'); }
    const args = $('cfg-args').value.split('\\n').map(s => s.trim()).filter(Boolean);
    const disabledTools = $('cfg-disabledTools').value.split(',').map(s => s.trim()).filter(Boolean);
    const partial = {
      piPath: $('cfg-piPath').value.trim(),
      workspaceRoot: $('cfg-workspaceRoot').value.trim(),
      language: $('cfg-language').value,
      args, env,
      chatFontSize: Number($('cfg-chatFontSize').value) || 13,
      chatSendShortcut: $('cfg-chatSendShortcut').value,
      chatMermaidTheme: $('cfg-chatMermaidTheme').value,
      mcpEnabled: $('cfg-mcpEnabled').checked,
      mcpIdleTimeout: Number($('cfg-mcpIdleTimeout').value) || 0,
      permissionMode: $('cfg-permissionMode').value,
      disabledTools,
    };
    await window.pi.invoke('pi:set-config', partial);

    // Sync raw textareas with structured state
    $('agent-models-raw').value = JSON.stringify(modelsJson, null, 2);
    $('agent-auth-raw').value = JSON.stringify(authJson, null, 2);

    const result = await window.pi.invoke('pi:write-agent-files', {
      append: $('agent-append').value,
      override: $('agent-override').value,
      settings: $('agent-settings').value,
      models: $('agent-models-raw').value,
      auth: $('agent-auth-raw').value,
    });
    if (result && result.ok === false) throw new Error(result.error || '保存失败');
    currentConfig = await window.pi.invoke('pi:get-config');
    setStatus('已保存', true);
  } catch (e) {
    setStatus('保存失败: ' + e.message, false);
  }
}

$('btn-save').onclick = saveAll;
$('btn-reload').onclick = loadAll;
loadAll();
</script>
</body>
</html>`;
}
