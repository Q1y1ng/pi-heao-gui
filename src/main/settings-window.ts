/**
 * Settings window for Pi Standalone GUI.
 * Tabs: 模型配置 | 扩展插件 | 技能 | 系统提示词 | 常规
 */
export function buildSettingsHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pi Standalone 设置</title>
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
.list-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:5px;margin:3px 0;background:#2a2a2a}
.list-item:hover{background:#303030}
.list-item .name{flex:1;font-size:12px;color:#d4d4d4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list-item .meta{font-size:11px;color:#888;flex-shrink:0}
.json-editor{width:100%;min-height:250px;padding:10px;border-radius:5px;border:1px solid #454545;
  background:#1a1a1a;color:#d4d4d4;font-family:'Cascadia Code','Consolas',monospace;font-size:12px;resize:vertical}
.status{padding:6px 16px;border-top:1px solid #3c3c3c;font-size:11px;color:#888;background:#252526}
.status.ok{color:#4ec9b0}
.status.err{color:#f44747}
.checkbox-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.checkbox-row input[type=checkbox]{width:auto;accent-color:#0e639c}
.checkbox-row label{margin:0;color:#d4d4d4}
.empty-hint{text-align:center;padding:30px;color:#666;font-size:12px}
.section-title{font-size:13px;font-weight:600;color:#e0e0e0;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #333}
.section-title:first-child{margin-top:0}
.masked{font-family:monospace;letter-spacing:1px}
</style>
</head>
<body>
<div class="toolbar">
  <h1>⚙ Pi Standalone 设置</h1>
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
    <div class="section-title">已配置的模型提供商</div>
    <div id="models-list"></div>
    <div class="section-title">API 密钥</div>
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
      <input type="text" id="cfg-piPath" placeholder="例如 C:\\Users\\...\\npm\\pi.cmd">
    </div>
    <div class="field">
      <label>默认工作目录</label>
      <input type="text" id="cfg-workspaceRoot" placeholder="例如 E:\\AI\\my-project">
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
      <label>settings.json（~/.pi/agent/settings.json）</label>
      <textarea class="json-editor" id="agent-settings" rows="6"></textarea>
    </div>
  </div>
</div>
<div class="status" id="status">就绪</div>
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

function maskKey(k) {
  if (!k) return '（未设置）';
  if (k.length <= 8) return '••••••••';
  return k.slice(0, 4) + '••••••••' + k.slice(-4);
}

function renderModels(providers) {
  const el = $('models-list');
  const sel = $('default-provider');
  el.innerHTML = '';
  sel.innerHTML = '<option value="">（无）</option>';
  if (!providers || !Object.keys(providers).length) {
    el.innerHTML = '<div class="empty-hint">未配置模型提供商。请编辑 ~/.pi/agent/models.json</div>';
    return;
  }
  for (const [id, p] of Object.entries(providers)) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = p.name || id;
    sel.appendChild(opt);
    const models = p.models || {};
    const modelIds = Object.keys(models);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="card-title">' + esc(p.name || id) + ' <span class="card-badge">' + esc(id) + '</span></div>' +
      '<div class="card-desc">Base URL: ' + esc(p.baseUrl || '（默认）') + '<br>' +
      '模型 (' + modelIds.length + '): ' + esc(modelIds.slice(0, 5).join(', ') || '无') + (modelIds.length > 5 ? '…' : '') + '</div>';
    el.appendChild(card);
  }
}

function renderAuth(auth) {
  const el = $('auth-list');
  el.innerHTML = '';
  if (!auth || !Object.keys(auth).length) {
    el.innerHTML = '<div class="empty-hint">未配置 API 密钥。请编辑 ~/.pi/agent/auth.json</div>';
    return;
  }
  for (const [provider, key] of Object.entries(auth)) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = '<span class="name">' + esc(provider) + '</span><span class="meta masked">' + esc(maskKey(typeof key === 'string' ? key : key.apiKey)) + '</span>';
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

function renderLocalExtensions(exts) {
  const el = $('local-extensions');
  el.innerHTML = '';
  if (!exts || !exts.length) {
    el.innerHTML = '<div class="empty-hint">无本地扩展</div>';
    return;
  }
  for (const e of exts) {
    const item = document.createElement('div');
    item.className = 'list-item';
    const badge = e.endsWith('.disabled') || e.endsWith('.disabled-vscode') ? '<span class="card-badge muted">已禁用</span>' : '';
    item.innerHTML = '<span class="name">' + esc(e) + '</span>' + badge;
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

    // Parse models/auth/settings
    let modelsJson = {}, authJson = {}, settingsJson = {};
    try { modelsJson = JSON.parse(agent.models || '{}'); } catch {}
    try { authJson = JSON.parse(agent.auth || '{}'); } catch {}
    try { settingsJson = JSON.parse(agent.settings || '{}'); } catch {}

    renderModels(modelsJson.providers || {});
    renderAuth(authJson);
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
    const result = await window.pi.invoke('pi:write-agent-files', {
      append: $('agent-append').value,
      override: $('agent-override').value,
      settings: $('agent-settings').value,
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
