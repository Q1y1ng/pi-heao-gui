import { TOKENS_CSS } from "./theme";
import { t, type UiLang } from "./i18n";

/**
 * Settings window for Pi Heao GUI.
 * Tabs: 模型配置 | 扩展插件 | 技能 | 系统提示词 | 常规
 * Models/auth/extensions are fully editable.
 *
 * Styling: the legacy rules above are kept for layout, and a design layer that
 * consumes the shared --pi-* tokens is appended last so it wins.
 */
export function buildSettingsHtml(lang: UiLang = "zh-cn"): string {
  return `<!DOCTYPE html>
<!-- Pi Heao GUI V1.1.3 · made by HEAOZIE -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pi Heao GUI 设置</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  background:#1e1e1e;color:#d4d4d4;font-size:var(--pi-fs-md);height:100vh;display:flex;flex-direction:column}
.toolbar{padding:12px 16px;border-bottom:1px solid #3c3c3c;display:flex;align-items:center;gap:10px;background:#252526}
.toolbar h1{font-size:15px;font-weight:600;flex:1;color:#e8e8e8}
.toolbar button{padding:5px 12px;border-radius:5px;border:1px solid #4a4a4a;background:#333;color:#d4d4d4;cursor:pointer;font-size:var(--pi-fs-sm)}
.toolbar button.primary{background:#0e639c;border-color:#0e639c;color:#fff}
.toolbar button:hover{background:#3a3a3a}
.toolbar button.primary:hover{background:#1177bb}
.tabs{display:flex;border-bottom:1px solid #3c3c3c;padding:0 8px;background:#252526;overflow-x:auto}
.tab{padding:9px 14px;cursor:pointer;border-bottom:2px solid transparent;color:#999;font-size:var(--pi-fs-sm);white-space:nowrap;user-select:none}
.tab:hover{color:#d4d4d4}
.tab.active{color:#4ec9b0;border-bottom-color:#4ec9b0}
.content{flex:1;overflow-y:auto;padding:16px}
.panel{display:none}
.panel.active{display:block}
.field{margin-bottom:14px}
.field label{display:block;margin-bottom:5px;color:#aaa;font-size:var(--pi-fs-sm)}
.field input,.field select,.field textarea{
  width:100%;padding:7px 10px;border-radius:5px;border:1px solid #454545;
  background:#2d2d2d;color:#d4d4d4;font-size:var(--pi-fs-md);font-family:inherit;
}
.field textarea{min-height:80px;resize:vertical;font-family:'Cascadia Code','Consolas',monospace;font-size:var(--pi-fs-sm)}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:#0e639c}
.field .hint{margin-top:3px;font-size:var(--pi-fs-xs);color:#777}
.row{display:flex;gap:10px}
.row .field{flex:1}
.card{background:#252526;border:1px solid #3c3c3c;border-radius:6px;padding:12px;margin-bottom:10px}
.card-title{font-weight:600;color:#e0e0e0;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.card-desc{color:#999;font-size:var(--pi-fs-sm);line-height:1.5}
.card-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;background:#0e639c;color:#fff}
.card-badge.warn{background:#8b5a00}
.card-badge.muted{background:#555}
.card-badge.ok{background:#2e7d32}
.list-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:5px;margin:3px 0;background:#2a2a2a}
.list-item:hover{background:#303030}
.list-item .name{flex:1;font-size:var(--pi-fs-sm);color:#d4d4d4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list-item .meta{font-size:var(--pi-fs-xs);color:#888;flex-shrink:0}
.json-editor{width:100%;min-height:200px;padding:10px;border-radius:5px;border:1px solid #454545;
  background:#1a1a1a;color:#d4d4d4;font-family:'Cascadia Code','Consolas',monospace;font-size:var(--pi-fs-sm);resize:vertical}
.status{padding:6px 16px;border-top:1px solid #3c3c3c;font-size:var(--pi-fs-xs);color:#888;background:#252526}
.brand{padding:0 16px 6px;font-size:9.5px;color:#4a4a4a;letter-spacing:0.35px;background:#252526;text-align:right;user-select:none;-webkit-user-select:none}
.status.ok{color:#4ec9b0}
.status.err{color:#f44747}
.checkbox-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.checkbox-row input[type=checkbox]{width:auto;accent-color:#0e639c}
.checkbox-row label{margin:0;color:#d4d4d4}
.empty-hint{text-align:center;padding:30px;color:#666;font-size:var(--pi-fs-sm)}
.section-title{font-size:var(--pi-fs-md);font-weight:600;color:#e0e0e0;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #333;display:flex;align-items:center;gap:8px}
.section-title:first-child{margin-top:0}
.section-title .btn-add{margin-left:auto;padding:3px 10px;border-radius:4px;border:1px solid #0e639c;background:transparent;color:#0e639c;cursor:pointer;font-size:var(--pi-fs-xs)}
.section-title .btn-add:hover{background:#0e639c;color:#fff}
.masked{font-family:monospace;letter-spacing:1px}
.btn-sm{padding:3px 8px;border-radius:4px;border:1px solid #555;background:transparent;color:#aaa;cursor:pointer;font-size:var(--pi-fs-xs);white-space:nowrap}
.btn-sm:hover{background:#333;color:#fff}
.btn-sm.danger{border-color:#8b3a3a;color:#f44747}
.btn-sm.danger:hover{background:#5a1a1a}
.btn-sm.ok{border-color:#2e7d32;color:#4ec9b0}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:100}
.modal{background:#252526;border:1px solid #454545;border-radius:8px;padding:20px;width:480px;max-height:80vh;overflow-y:auto}
.modal h3{font-size:var(--pi-fs-lg);margin-bottom:14px;color:#e8e8e8}
.modal .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.modal .actions button{padding:6px 16px;border-radius:5px;border:1px solid #4a4a4a;background:#333;color:#d4d4d4;cursor:pointer;font-size:var(--pi-fs-sm)}
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
  font-size: var(--pi-fs-sm);
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

/* appearance: segmented group + accent swatches + font preview */
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius);
  background: var(--pi-bg);
}
.seg button {
  padding: 5px 14px;
  border: 1px solid transparent;
  border-radius: var(--pi-radius-sm);
  background: transparent;
  color: var(--pi-text-dim);
  font-family: inherit;
  font-size: var(--pi-fs-sm);
  cursor: pointer;
  transition: background var(--pi-speed), color var(--pi-speed), border-color var(--pi-speed);
}
.seg button:hover {
  background: var(--pi-overlay);
  color: var(--pi-text);
}
.seg button.active {
  background: var(--pi-accent-soft);
  border-color: var(--pi-accent);
  color: var(--pi-accent);
  font-weight: 600;
}
.swatches {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.swatch {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--pi-radius-pill);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  transition: transform var(--pi-speed), border-color var(--pi-speed), box-shadow var(--pi-speed);
}
.swatch:hover {
  transform: scale(1.08);
}
.swatch.active {
  border-color: var(--pi-text);
  box-shadow: 0 0 0 2px var(--pi-accent-soft), inset 0 0 0 1px rgba(0, 0, 0, 0.28);
}
.swatches input[type="color"] {
  width: 32px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius-sm);
  background: var(--pi-bg);
  cursor: pointer;
}
.font-preview {
  padding: 8px 10px;
  border: 1px dashed var(--pi-border-strong);
  border-radius: var(--pi-radius);
  background: var(--pi-bg);
  color: var(--pi-text);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* chips + recent workspaces (常规 tab) */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius-pill);
  background: var(--pi-bg);
  color: var(--pi-text);
  font-size: var(--pi-fs-xs);
}
.chip button {
  padding: 2px 5px;
  border: none;
  border-radius: var(--pi-radius-pill);
  background: transparent;
  color: var(--pi-text-faint);
  font-size: var(--pi-fs-md);
  line-height: 1;
  cursor: pointer;
}
.chip button:hover {
  background: rgba(240, 97, 109, 0.14);
  color: var(--pi-danger);
}
.recent-row {
  cursor: pointer;
}

/* diagnostics tab */
.diag-pre {
  margin: 0 0 10px;
  padding: 10px 12px;
  max-height: 260px;
  overflow: auto;
  border: 1px solid var(--pi-border);
  border-radius: var(--pi-radius);
  background: var(--pi-bg);
  color: var(--pi-text-dim);
  font-family: var(--pi-font-mono);
  font-size: var(--pi-fs-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}
.diag-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.diag-actions button {
  padding: 5px 12px;
  border: 1px solid var(--pi-border-strong);
  border-radius: var(--pi-radius);
  background: var(--pi-raised);
  color: var(--pi-text-dim);
  font-family: inherit;
  font-size: var(--pi-fs-sm);
  cursor: pointer;
  transition: background var(--pi-speed), color var(--pi-speed), border-color var(--pi-speed);
}
.diag-actions button:hover {
  background: var(--pi-overlay);
  color: var(--pi-text);
}
.diag-feedback {
  min-height: 15px;
  margin-bottom: 6px;
  font-size: var(--pi-fs-xs);
  color: var(--pi-text-faint);
}
.diag-feedback.ok {
  color: var(--pi-success);
}
.diag-feedback.err {
  color: var(--pi-danger);
}
.diag-path {
  margin-top: 6px;
  font-family: var(--pi-font-mono);
  font-size: var(--pi-fs-xs);
  color: var(--pi-text-dim);
  word-break: break-all;
}
.diag-path:empty {
  display: none;
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
  <span class="pi-ver" title="Pi Heao GUI V1.1.3 — made by HEAOZIE">V1.1.3</span>
  <button id="btn-reload">重新加载</button>
  <button id="btn-save" class="primary">保存更改</button>
</div>
<div class="tabs">
  <div class="tab active" data-tab="models">${t("settings.tab.models", lang)}</div>
  <div class="tab" data-tab="extensions">${t("settings.tab.extensions", lang)}</div>
  <div class="tab" data-tab="skills">${t("settings.tab.skills", lang)}</div>
  <div class="tab" data-tab="sysprompt">${t("settings.tab.sysprompt", lang)}</div>
  <div class="tab" data-tab="appearance">${t("settings.tab.appearance", lang)}</div>
  <div class="tab" data-tab="diagnostics">${t("settings.tab.diagnostics", lang)}</div>
  <div class="tab" data-tab="changelog">${t("settings.tab.changelog", lang)}</div>
  <div class="tab" data-tab="general">${t("settings.tab.general", lang)}</div>
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
    <div class="section-title">提供商就绪检查
      <button class="btn-add" id="btn-auth-check">开始检查</button>
    </div>
    <div id="auth-status-list"></div>
    <div class="hint">通过 pi auth check 检测密钥与登录状态。OAuth 凭据由 pi 自动刷新；需要重新登录时请在 pi CLI 中执行 pi auth。</div>
  </div>
  <!-- Extensions -->
  <div class="panel" id="panel-extensions">
    <div class="section-title">npm 扩展包（pi install / settings.json → packages）</div>
    <div class="field" style="display:flex;gap:8px;align-items:flex-end">
      <div style="flex:1">
        <label>安装扩展包</label>
        <input type="text" id="pkg-source" placeholder="npm:@scope/name、git:github.com/user/repo、./本地路径">
      </div>
      <button class="primary" id="btn-pkg-install">安装</button>
      <button id="btn-pkg-refresh">刷新</button>
    </div>
    <div class="hint" id="pkg-status"></div>
    <div id="npm-packages"></div>
    <div class="section-title">本地扩展（~/.pi/agent/extensions/）</div>
    <div id="local-extensions"></div>
  </div>
  <!-- Skills -->
  <div class="panel" id="panel-skills">
    <div class="section-title">已安装技能
      <button class="btn-add" id="btn-add-skill">+ 新建技能</button>
    </div>
    <div id="skills-list"></div>
    <div class="hint" style="color:#666;font-size:var(--pi-fs-sm);margin-top:12px">
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
  <!-- Appearance -->
  <div class="panel" id="panel-appearance">
    <div class="section-title">界面主题</div>
    <div class="field">
      <label>主题</label>
      <div class="seg" id="theme-group">
        <button type="button" data-theme="dark">深色</button>
        <button type="button" data-theme="light">浅色</button>
        <button type="button" data-theme="system">跟随系统</button>
      </div>
      <div class="hint">主题与强调色会立即应用到所有聊天窗口，无需重启。</div>
    </div>
    <div class="section-title">强调色</div>
    <div class="field">
      <label>强调色（按钮、焦点边框、选中行）</label>
      <div class="swatches" id="accent-swatches">
        <button type="button" class="swatch" data-accent="#4c8dff" style="background:#4c8dff" title="#4c8dff 蓝色"></button>
        <button type="button" class="swatch" data-accent="#22c55e" style="background:#22c55e" title="#22c55e 绿色"></button>
        <button type="button" class="swatch" data-accent="#a855f7" style="background:#a855f7" title="#a855f7 紫色"></button>
        <button type="button" class="swatch" data-accent="#f59e0b" style="background:#f59e0b" title="#f59e0b 琥珀色"></button>
        <button type="button" class="swatch" data-accent="#ef4444" style="background:#ef4444" title="#ef4444 红色"></button>
        <button type="button" class="swatch" data-accent="#14b8a6" style="background:#14b8a6" title="#14b8a6 青色"></button>
        <input type="color" id="accent-custom" value="#4c8dff" title="自定义颜色">
      </div>
      <div class="hint">点击色块立即生效；也可以用右侧取色器自定义任意颜色。</div>
    </div>
    <div class="section-title">字体大小</div>
    <div class="row">
      <div class="field" style="flex:0 0 130px">
        <label>界面字号（px）</label>
        <input type="number" id="ap-fontSize" min="8" max="32" step="1">
      </div>
      <div class="field">
        <label>预览</label>
        <div class="font-preview" id="ap-fontPreview">13px · 预览文本 Aa 你好 0123</div>
      </div>
    </div>
    <div class="hint">范围 8–32，立即应用到聊天窗口的正文与代码块。</div>
  </div>
  <!-- Diagnostics -->
  <div class="panel" id="panel-diagnostics">
    <div class="section-title">环境信息
      <button class="btn-add" id="btn-diag-refresh">刷新</button>
    </div>
    <pre class="diag-pre" id="diag-info">正在读取…</pre>
    <div class="section-title">诊断操作</div>
    <div class="diag-actions">
      <button type="button" id="btn-diag-log">刷新日志</button>
      <button type="button" id="btn-diag-copy">复制诊断信息</button>
      <button type="button" id="btn-diag-report">生成诊断包</button>
      <button type="button" id="btn-diag-openlogs">打开日志目录</button>
      <button type="button" id="btn-diag-openuserdata">打开数据目录</button>
    </div>
    <div class="section-title">版本与更新</div>
    <div class="diag-actions">
      <button type="button" id="btn-update-check">检查更新</button>
      <button type="button" id="btn-update-install">重启并安装</button>
    </div>
    <div class="diag-feedback" id="update-status">尚未检查。</div>
    <div class="hint">
      后台会定期检查 GitHub Release（可在常规标签页关闭）。未签名的构建仍可更新；
      更新包会被校验文件哈希。
    </div>
    <div class="diag-feedback" id="diag-feedback"></div>
    <div class="diag-path" id="diag-report-path"></div>
    <div class="section-title">RPC 日志（末尾）</div>
    <pre class="diag-pre" id="diag-log">尚未读取，点击「刷新日志」查看。</pre>
    <div class="hint">诊断包会隐去 API 密钥等敏感字段，但包含完整配置与日志末尾；生成后会自动打开所在目录。</div>
  </div>
  <!-- Changelog (upstream pi-changelog.ts) -->
  <div class="panel" id="panel-changelog">
    <div class="section-title">pi 更新日志
      <button class="btn-add" id="btn-changelog-refresh">刷新</button>
    </div>
    <div class="hint" id="changelog-meta"></div>
    <pre class="diag-pre" id="changelog-body">尚未读取，点击「刷新」查看。</pre>
    <div class="hint">内容来自已安装 pi 包内的 CHANGELOG.md（超过 20000 字符会截断），与 VS Code 插件的更新日志面板一致。</div>
  </div>
  <!-- General -->
  <div class="panel" id="panel-general">
    <div class="section-title">${t("settings.language", lang)}</div>
    <div class="field">
      <label>${t("settings.language", lang)}</label>
      <select id="ui-language">
        <option value="auto">${t("settings.language.auto", lang)}</option>
        <option value="zh-cn">${t("settings.language.zh", lang)}</option>
        <option value="en">${t("settings.language.en", lang)}</option>
      </select>
      <div class="hint">控制本应用自有文案（设置窗、侧栏、终端面板等）。上游聊天 UI 的语言由 pi-chat 自身的 locales 控制。</div>
    </div>
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
    <div class="section-title">启动与侧栏</div>
    <div class="checkbox-row">
      <label class="switch"><input type="checkbox" id="cfg-openAtLogin"><span class="slider"></span></label>
      <label for="cfg-openAtLogin">开机自启（登录系统后自动打开 Pi Heao GUI）</label>
    </div>
    <div class="checkbox-row">
      <label class="switch"><input type="checkbox" id="cfg-showArchived"><span class="slider"></span></label>
      <label for="cfg-showArchived">侧栏显示已归档会话</label>
    </div>
    <div class="section-title">预算</div>
    <div class="row">
      <div class="field">
        <label>每日预算（USD，0 = 不限制）</label>
        <input type="number" id="cfg-budgetDailyUsd" min="0" step="0.5">
      </div>
      <div class="field">
        <label>每月预算（USD，0 = 不限制）</label>
        <input type="number" id="cfg-budgetMonthlyUsd" min="0" step="0.5">
      </div>
    </div>
    <div class="hint">0 表示不限制；超出预算仅给出提醒，不会中断对话。</div>
    <div class="section-title">收藏模型</div>
    <div class="chip-row" id="favorites-list"></div>
    <div class="hint">收藏的模型会在模型选择器中带 ★ 标记并置顶显示。</div>
    <div class="section-title">最近工作目录</div>
    <div id="recent-list"></div>
    <div class="hint">点击任意一行即可将其设为默认工作目录。</div>
  </div>
</div>
<div class="status" id="status">就绪</div>
<div class="brand" title="Pi Heao GUI V1.1.3 — made by HEAOZIE">made by HEAOZIE</div>
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
    if (t.dataset.tab === 'diagnostics') loadDiagnosticsInfo();
    // Load the changelog on open: it used to show its "尚未读取" placeholder until
    // the user found the separate 刷新 button, which read as an empty tab.
    if (t.dataset.tab === 'changelog') loadChangelog();
    if (t.dataset.tab === 'skills') refreshSkills();
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
    if (!modelIds.length) mlist.innerHTML = '<div style="color:#666;font-size:var(--pi-fs-xs);padding:4px 0">无模型，点击「+ 模型」添加</div>';
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

// ── Extension packages (pi install / remove / list) ──
async function loadPackages() {
  const el = $('npm-packages');
  el.innerHTML = '<div class="empty-hint">读取中…</div>';
  try {
    const res = await window.pi.invoke('pi:pkg-list');
    renderNpmPackages((res && res.packages) || []);
    if (res && res.ok === false) setStatus('读取扩展失败: ' + (res.error || ''), false);
  } catch (err) {
    el.innerHTML = '';
    setStatus('读取扩展失败: ' + err.message, false);
  }
}

function renderNpmPackages(packages) {
  const el = $('npm-packages');
  el.innerHTML = '';
  if (!packages || !packages.length) {
    el.innerHTML = '<div class="empty-hint">未安装扩展包</div>';
    return;
  }
  for (const pkg of packages) {
    const source = typeof pkg === 'string' ? pkg : pkg.source || '';
    const path = typeof pkg === 'string' ? '' : pkg.path || '';
    const scope = typeof pkg === 'string' ? '' : pkg.scope || 'user';
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML =
      '<span class="name" title="' + esc(path || source) + '">' + esc(source.replace(/^npm:/, '')) + '</span>' +
      '<span class="meta">' + esc(scope === 'project' ? '项目' : '用户') + '</span>' +
      '<button class="btn-sm danger" data-pkg="' + esc(source) + '">移除</button>';
    const btn = item.querySelector('button');
    btn.onclick = async () => {
      if (!window.confirm('移除扩展 ' + source + '？')) return;
      btn.disabled = true;
      setStatus('正在移除 ' + source + '…', true);
      try {
        const r = await window.pi.invoke('pi:pkg-remove', source);
        setStatus(r && r.ok ? '已移除 ' + source : '移除失败: ' + ((r && r.error) || ''), !!(r && r.ok));
        await loadPackages();
      } catch (err) {
        setStatus('移除失败: ' + err.message, false);
        btn.disabled = false;
      }
    };
    el.appendChild(item);
  }
}

function wirePackages() {
  const installBtn = $('btn-pkg-install');
  const input = $('pkg-source');
  const refresh = $('btn-pkg-refresh');
  if (refresh) refresh.onclick = () => loadPackages();
  if (!installBtn || !input) return;
  installBtn.onclick = async () => {
    const source = input.value.trim();
    if (!source) { setStatus('请填写安装源', false); return; }
    installBtn.disabled = true;
    setStatus('正在安装 ' + source + '（可能需要几十秒）…', true);
    try {
      const r = await window.pi.invoke('pi:pkg-install', source);
      if (r && r.ok) {
        setStatus('已安装 ' + source + '，重启会话后生效', true);
        input.value = '';
        await loadPackages();
      } else {
        setStatus('安装失败: ' + ((r && r.error) || '未知错误'), false);
      }
    } catch (err) {
      setStatus('安装失败: ' + err.message, false);
    } finally {
      installBtn.disabled = false;
    }
  };
}

// ── Skills: create / edit / delete ──
const SKILL_TEMPLATE = [
  '---',
  'name: my-skill',
  'description: 一句话说明这个技能做什么、什么时候用',
  '---',
  '',
  '# My Skill',
  '',
  '在这里写指令：pi 会在这份 SKILL.md 被触发时读取它。',
  '',
].join('\\n');

async function refreshSkills() {
  const data = await window.pi.invoke('pi:get-env-info');
  renderSkills((data && data.skills) || []);
  return data;
}

function openSkillEditor(skill) {
  const isNew = !skill;
  showModal(isNew ? '新建技能' : '编辑技能：' + skill.name, [
    { key: 'name', label: '技能目录名（字母数字点下划线短横线）', value: isNew ? '' : skill.name, placeholder: 'my-skill' },
    { key: 'content', label: 'SKILL.md 内容', type: 'textarea', rows: 14, value: isNew ? SKILL_TEMPLATE : '' },
  ], async (vals) => {
    const name = (vals.name || '').trim();
    if (!name) { setStatus('技能名不能为空', false); return; }
    let content = vals.content || '';
    if (!isNew && !content.trim()) {
      const current = await window.pi.invoke('pi:read-skill', skill.name);
      content = (current && current.content) || '';
    }
    try {
      const r = await window.pi.invoke('pi:write-skill', { name, content, renameFrom: isNew ? undefined : skill.name });
      if (r && r.ok) {
        setStatus('已保存技能 ' + name + '（新会话生效）', true);
        await refreshSkills();
      } else {
        setStatus('保存失败: ' + ((r && r.error) || '未知错误'), false);
      }
    } catch (err) {
      setStatus('保存失败: ' + err.message, false);
    }
  });
  if (!isNew) {
    window.pi.invoke('pi:read-skill', skill.name).then((res) => {
      const ta = document.getElementById('mf-content');
      if (ta && res && res.ok) ta.value = res.content || '';
    });
  }
}

function wireSkills() {
  const add = $('btn-add-skill');
  if (add) add.onclick = () => openSkillEditor(null);
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
    card.innerHTML =
      '<div class="card-title">' + esc(s.name) + '</div>' +
      '<div class="card-desc">' + esc(s.description || '（无描述）') + '</div>' +
      '<div class="card-actions">' +
      '<button class="btn-sm" data-skill-edit="' + esc(s.name) + '">编辑</button>' +
      '<button class="btn-sm danger" data-skill-del="' + esc(s.name) + '">删除</button>' +
      '</div>';
    const edit = card.querySelector('[data-skill-edit]');
    const del = card.querySelector('[data-skill-del]');
    if (edit) edit.onclick = () => openSkillEditor({ name: s.name, description: s.description });
    if (del) {
      del.onclick = async () => {
        if (!window.confirm('删除技能 ' + s.name + '？目录及其 SKILL.md 会被移除。')) return;
        try {
          const r = await window.pi.invoke('pi:delete-skill', s.name);
          setStatus(r && r.ok ? '已删除 ' + s.name : '删除失败: ' + ((r && r.error) || ''), !!(r && r.ok));
          await refreshSkills();
        } catch (err) {
          setStatus('删除失败: ' + err.message, false);
        }
      };
    }
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

// ── Provider readiness (pi auth check) ──
async function checkAuth() {
  const el = $('auth-status-list');
  if (!el) return;
  const providers = new Set();
  for (const key of Object.keys((modelsJson && modelsJson.providers) || {})) providers.add(key);
  const authList = Array.isArray(authJson) ? authJson : [];
  for (const entry of authList) {
    if (entry && entry.provider) providers.add(String(entry.provider));
  }
  if (!providers.size) {
    el.innerHTML = '<div class="empty-hint">还没有配置任何提供商</div>';
    return;
  }
  el.innerHTML = '<div class="empty-hint">检查中…</div>';
  try {
    const res = await window.pi.invoke('pi:auth-status', [...providers]);
    const rows = (res && res.results) || [];
    if (!rows.length) {
      el.innerHTML = '<div class="empty-hint">没有可检查的提供商</div>';
      return;
    }
    el.innerHTML = '';
    for (const row of rows) {
      const ready = row.status === 'ready';
      const item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML =
        '<span class="name">' + esc(row.provider) + '</span>' +
        '<span class="card-badge ' + (ready ? 'ok' : 'muted') + '">' + esc(ready ? '就绪' : row.status || '未知') + '</span>' +
        (row.reason ? '<span class="meta">' + esc(row.reason) + '</span>' : '') +
        '<button class="btn-sm" data-login="' + esc(row.provider) + '">登录</button>';
      el.appendChild(item);
      const loginBtn = item.querySelector('[data-login]');
      if (loginBtn) {
        loginBtn.onclick = async () => {
          try {
            const r = await window.pi.invoke('pi:login-provider', row.provider);
            setStatus(
              r && r.ok
                ? '已在内置终端里运行 /login ' + row.provider + '，请在那里完成授权'
                : '登录失败: ' + ((r && r.error) || ''),
              !!(r && r.ok),
            );
          } catch (err) {
            setStatus('登录失败: ' + err.message, false);
          }
        };
      }
    }
  } catch (err) {
    el.innerHTML = '<div class="empty-hint">检查失败: ' + esc(err.message) + '</div>';
  }
}

function wireAuthCheck() {
  const btn = $('btn-auth-check');
  if (btn) btn.onclick = () => checkAuth();
}

// ── UI language (this app's own strings) ──
async function wireUiLanguage() {
  const sel = $('ui-language');
  if (!sel) return;
  try {
    const cfg = await window.pi.invoke('pi:get-config');
    if (cfg && cfg.uiLanguage) sel.value = cfg.uiLanguage;
  } catch (err) {
    // default stays "auto"
  }
  sel.onchange = async () => {
    try {
      await window.pi.invoke('pi:set-config', { uiLanguage: sel.value });
      setStatus('界面语言已更新，设置窗会重新打开', true);
    } catch (err) {
      setStatus('切换失败: ' + err.message, false);
    }
  };
}

// ── pi changelog ──
async function loadChangelog() {
  const body = $('changelog-body');
  const meta = $('changelog-meta');
  if (!body) return;
  body.textContent = '读取中…';
  try {
    const res = await window.pi.invoke('pi:changelog');
    if (res && res.ok) {
      body.textContent = res.content || '';
      if (meta) meta.textContent = 'pi ' + (res.version || '') + ' · ' + (res.root || '');
    } else {
      body.textContent = '读取失败：' + ((res && res.error) || '未知错误');
      if (meta) meta.textContent = '';
      setStatus('读取更新日志失败: ' + ((res && res.error) || '未知错误'), false);
    }
  } catch (err) {
    body.textContent = '读取失败：' + err.message;
    setStatus('读取更新日志失败: ' + err.message, false);
  }
}

function wireChangelog() {
  const btn = $('btn-changelog-refresh');
  if (btn) btn.onclick = () => loadChangelog();
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

// ── Appearance (外观) ──
const THEME_LABELS = { dark: '深色', light: '浅色', system: '跟随系统' };

function normHex(v) { return String(v || '').trim().toLowerCase(); }
function isHex(v) { return /^#[0-9a-f]{6}$/.test(v); }

function markTheme(theme) {
  document.querySelectorAll('#theme-group button').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

function markSwatch(accent) {
  const a = normHex(accent);
  document.querySelectorAll('#accent-swatches .swatch').forEach(s => {
    s.classList.toggle('active', normHex(s.dataset.accent) === a);
  });
}

function renderFontPreview(size) {
  const n = Math.round(Number(size));
  const px = Math.min(32, Math.max(8, Number.isFinite(n) ? n : 13));
  const p = $('ap-fontPreview');
  if (!p) return;
  p.style.fontSize = px + 'px';
  p.textContent = px + 'px · 预览文本 Aa 你好 0123';
}

function renderAppearance() {
  markTheme(currentConfig.theme || 'dark');
  const accent = normHex(currentConfig.accent) || '#4c8dff';
  markSwatch(accent);
  if (isHex(accent)) $('accent-custom').value = accent;
  const size = Number(currentConfig.chatFontSize) || 13;
  $('ap-fontSize').value = size;
  renderFontPreview(size);
}

// Merges a partial into the app config; main returns the merged config.
async function applyPartial(partial, okMsg) {
  const cfg = await window.pi.invoke('pi:set-config', partial);
  if (cfg && typeof cfg === 'object') currentConfig = cfg;
  if (okMsg) setStatus(okMsg, true);
  return currentConfig;
}

$('theme-group').onclick = async (e) => {
  const btn = e.target.closest('button[data-theme]');
  if (!btn) return;
  const theme = btn.dataset.theme;
  markTheme(theme);
  try {
    await applyPartial({ theme }, '已切换主题：' + (THEME_LABELS[theme] || theme));
  } catch (err) {
    setStatus('切换主题失败: ' + err.message, false);
    renderAppearance();
  }
};

async function setAccent(hex, quiet) {
  const value = normHex(hex);
  markSwatch(value);
  try {
    await applyPartial({ accent: value }, quiet ? '' : '已应用强调色 ' + value);
  } catch (err) {
    setStatus('设置强调色失败: ' + err.message, false);
    renderAppearance();
  }
}

$('accent-swatches').onclick = (e) => {
  const sw = e.target.closest('.swatch');
  if (!sw) return;
  setAccent(sw.dataset.accent, false);
};

// Native colour input writes live (debounced) while dragging, once on close.
let accentTimer = null;
$('accent-custom').oninput = () => {
  const value = normHex($('accent-custom').value);
  markSwatch(value);
  if (accentTimer) clearTimeout(accentTimer);
  accentTimer = setTimeout(() => setAccent(value, true), 220);
};
$('accent-custom').onchange = () => {
  if (accentTimer) clearTimeout(accentTimer);
  setAccent(normHex($('accent-custom').value), false);
};

$('ap-fontSize').oninput = () => renderFontPreview($('ap-fontSize').value);
$('ap-fontSize').onchange = async () => {
  let px = Math.round(Number($('ap-fontSize').value));
  if (!Number.isFinite(px)) px = 13;
  px = Math.min(32, Math.max(8, px));
  $('ap-fontSize').value = px;
  $('cfg-chatFontSize').value = px;
  renderFontPreview(px);
  try {
    await applyPartial({ chatFontSize: px }, '字体大小已设为 ' + px + 'px');
  } catch (err) {
    setStatus('设置字体大小失败: ' + err.message, false);
    renderAppearance();
  }
};

// ── General: launch / sidebar / budget ──
$('cfg-openAtLogin').onchange = async () => {
  const on = $('cfg-openAtLogin').checked;
  try {
    await applyPartial({ openAtLogin: on }, on ? '已开启开机自启' : '已关闭开机自启');
  } catch (err) {
    setStatus('设置开机自启失败: ' + err.message, false);
    $('cfg-openAtLogin').checked = !on;
  }
};

$('cfg-showArchived').onchange = async () => {
  const on = $('cfg-showArchived').checked;
  try {
    await applyPartial({ showArchived: on }, on ? '侧栏将显示已归档会话' : '侧栏已隐藏归档会话');
  } catch (err) {
    setStatus('设置失败: ' + err.message, false);
    $('cfg-showArchived').checked = !on;
  }
};

async function saveBudget() {
  const daily = Math.max(0, Number($('cfg-budgetDailyUsd').value) || 0);
  const monthly = Math.max(0, Number($('cfg-budgetMonthlyUsd').value) || 0);
  $('cfg-budgetDailyUsd').value = daily;
  $('cfg-budgetMonthlyUsd').value = monthly;
  try {
    await applyPartial({ budgetDailyUsd: daily, budgetMonthlyUsd: monthly }, '预算已保存');
  } catch (err) {
    setStatus('保存预算失败: ' + err.message, false);
  }
}
$('cfg-budgetDailyUsd').onchange = saveBudget;
$('cfg-budgetMonthlyUsd').onchange = saveBudget;

// ── General: favourite models (chips, removable) ──
function renderFavorites() {
  const el = $('favorites-list');
  const favs = Array.isArray(currentConfig.favoriteModels) ? currentConfig.favoriteModels : [];
  el.innerHTML = '';
  if (!favs.length) {
    el.innerHTML = '<div class="empty-hint">暂无收藏。在模型选择器中点击 ★ 即可收藏。</div>';
    return;
  }
  for (const id of favs) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = id;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = '移除收藏';
    rm.onclick = async () => {
      const next = favs.filter(x => x !== id);
      try {
        const cfg = await window.pi.invoke('pi:set-config', { favoriteModels: next });
        if (cfg && typeof cfg === 'object') currentConfig = cfg;
        renderFavorites();
        setStatus('已移除收藏 ' + id, true);
      } catch (err) {
        setStatus('移除收藏失败: ' + err.message, false);
      }
    };
    chip.appendChild(label);
    chip.appendChild(rm);
    el.appendChild(chip);
  }
}

// ── General: recent workspaces (click = set workspaceRoot) ──
function renderRecentWorkspaces() {
  const el = $('recent-list');
  const list = Array.isArray(currentConfig.recentWorkspaces)
    ? currentConfig.recentWorkspaces.filter(Boolean)
    : [];
  const current = currentConfig.workspaceRoot || '';
  el.innerHTML = '';
  if (!list.length) {
    el.innerHTML = '<div class="empty-hint">暂无最近工作目录。</div>';
    return;
  }
  for (const dir of list) {
    const row = document.createElement('div');
    row.className = 'list-item recent-row';
    row.title = '设为默认工作目录：' + dir;
    row.innerHTML = '<span class="name">' + esc(dir) + '</span>' +
      (dir === current ? '<span class="card-badge">当前</span>' : '<span class="meta">使用</span>');
    row.onclick = async () => {
      try {
        const cfg = await window.pi.invoke('pi:set-config', { workspaceRoot: dir });
        if (cfg && typeof cfg === 'object') currentConfig = cfg;
        $('cfg-workspaceRoot').value = currentConfig.workspaceRoot || dir;
        renderRecentWorkspaces();
        setStatus('默认工作目录已设为 ' + dir, true);
      } catch (err) {
        setStatus('切换工作目录失败: ' + err.message, false);
      }
    };
    el.appendChild(row);
  }
}

// ── Diagnostics (诊断) ──
let diagInfoText = '';
let diagTimer = null;

function flashDiag(msg, ok) {
  const el = $('diag-feedback');
  el.textContent = msg;
  el.className = 'diag-feedback' + (ok === true ? ' ok' : ok === false ? ' err' : '');
  if (diagTimer) clearTimeout(diagTimer);
  diagTimer = setTimeout(() => {
    el.textContent = '';
    el.className = 'diag-feedback';
  }, 4000);
}

async function loadDiagnosticsInfo() {
  const pre = $('diag-info');
  pre.textContent = '正在读取…';
  try {
    const r = await window.pi.invoke('pi:diagnostics', 'info');
    if (r && r.ok === false) throw new Error(r.error || '读取失败');
    diagInfoText = (r && r.info) || '（无内容）';
    pre.textContent = diagInfoText;
  } catch (err) {
    pre.textContent = '读取失败：' + err.message;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (err2) {
      return false;
    }
  }
}

$('btn-diag-refresh').onclick = () => loadDiagnosticsInfo();

$('btn-diag-log').onclick = async () => {
  const pre = $('diag-log');
  pre.textContent = '正在读取…';
  try {
    const r = await window.pi.invoke('pi:diagnostics', 'log');
    if (r && r.ok === false) throw new Error(r.error || '读取失败');
    pre.textContent = (r && r.info) || '（日志为空）';
    setStatus('已刷新日志', true);
  } catch (err) {
    pre.textContent = '读取失败：' + err.message;
    setStatus('读取日志失败: ' + err.message, false);
  }
};

$('btn-diag-copy').onclick = async () => {
  try {
    const r = await window.pi.invoke('pi:diagnostics', 'copy');
    if (r && r.ok === false) throw new Error(r.error || '读取失败');
    const text = (r && r.info) || diagInfoText || '';
    const ok = await copyText(text);
    flashDiag(ok ? '已复制' : '复制失败，请在下方文本框中手动选择', ok);
    setStatus(ok ? '诊断信息已复制到剪贴板' : '复制失败', ok);
  } catch (err) {
    flashDiag('复制失败：' + err.message, false);
    setStatus('复制失败: ' + err.message, false);
  }
};

$('btn-diag-report').onclick = async () => {
  setStatus('正在生成诊断包…');
  try {
    const r = await window.pi.invoke('pi:diagnostics', 'report');
    if (r && r.ok === false) throw new Error(r.error || '生成失败');
    const p = (r && r.path) || '';
    $('diag-report-path').textContent = p ? '诊断包已生成：' + p : '诊断包已生成（未返回路径）';
    setStatus('诊断包已生成', true);
  } catch (err) {
    $('diag-report-path').textContent = '';
    setStatus('生成诊断包失败: ' + err.message, false);
  }
};

$('btn-diag-openlogs').onclick = async () => {
  try {
    await window.pi.invoke('pi:diagnostics', 'open-logs');
    setStatus('已打开日志目录', true);
  } catch (err) {
    setStatus('打开日志目录失败: ' + err.message, false);
  }
};

// ── Updates ──
function describeUpdate(res) {
  if (!res || !res.state) return '未知状态';
  switch (res.state) {
    case 'idle': return '空闲';
    case 'checking': return '正在检查…';
    case 'available': return '发现新版本 ' + res.version + '，正在后台下载…';
    case 'downloading': return '正在下载 ' + (res.percent || 0) + '%';
    case 'ready': return '新版本 ' + res.version + ' 已下载，重启即可安装';
    case 'none': return '已是最新版本（' + res.current + '）';
    case 'unavailable': return res.reason || '当前环境不支持自动更新';
    case 'error': return '检查失败: ' + res.message;
    default: return String(res.state);
  }
}

const updateBox = $('update-status');
function showUpdate(res) {
  if (updateBox) updateBox.textContent = describeUpdate(res);
}

$('btn-update-check').onclick = async () => {
  if (updateBox) updateBox.textContent = '正在检查…';
  try {
    showUpdate(await window.pi.invoke('pi:update-check'));
  } catch (err) {
    if (updateBox) updateBox.textContent = '检查更新失败: ' + err.message;
  }
};

$('btn-update-install').onclick = async () => {
  try {
    const res = await window.pi.invoke('pi:update-install');
    setStatus(res && res.ok ? '正在重启以安装更新…' : ((res && res.error) || '无法安装更新'), !!res && res.ok);
  } catch (err) {
    setStatus('安装更新失败: ' + err.message, false);
  }
};

void (async () => {
  try {
    showUpdate(await window.pi.invoke('pi:update-status'));
  } catch {
    /* leave the placeholder text */
  }
})();

$('btn-diag-openuserdata').onclick = async () => {
  try {
    await window.pi.invoke('pi:diagnostics', 'open-userdata');
    setStatus('已打开数据目录', true);
  } catch (err) {
    setStatus('打开数据目录失败: ' + err.message, false);
  }
};

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

    $('cfg-openAtLogin').checked = !!currentConfig.openAtLogin;
    $('cfg-showArchived').checked = !!currentConfig.showArchived;
    $('cfg-budgetDailyUsd').value = Number(currentConfig.budgetDailyUsd) || 0;
    $('cfg-budgetMonthlyUsd').value = Number(currentConfig.budgetMonthlyUsd) || 0;
    renderAppearance();
    renderFavorites();
    renderRecentWorkspaces();

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
    void loadPackages();

    const data = await window.pi.invoke('pi:get-env-info');
    renderLocalExtensions(data.extensions || []);
    renderSkills(data.skills || []);
    wirePackages();
    wireSkills();
    wireAuthCheck();
    wireChangelog();
    void wireUiLanguage();

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
      openAtLogin: $('cfg-openAtLogin').checked,
      showArchived: $('cfg-showArchived').checked,
      budgetDailyUsd: Math.max(0, Number($('cfg-budgetDailyUsd').value) || 0),
      budgetMonthlyUsd: Math.max(0, Number($('cfg-budgetMonthlyUsd').value) || 0),
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
    renderAppearance();
    renderFavorites();
    renderRecentWorkspaces();
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
