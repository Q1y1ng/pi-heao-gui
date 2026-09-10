/**
 * Settings window for Pi Standalone GUI.
 * Self-contained HTML that edits local config + pi agent files via IPC.
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
  background:#1e1e1e;color:#ccc;font-size:13px;height:100vh;display:flex;flex-direction:column}
.toolbar{padding:14px 20px;border-bottom:1px solid #333;display:flex;align-items:center;gap:12px}
.toolbar h1{font-size:16px;font-weight:500;flex:1}
.toolbar button{padding:6px 14px;border-radius:6px;border:1px solid #444;background:#2a2a2a;color:#ccc;cursor:pointer;font-size:12px}
.toolbar button.primary{background:#0e639c;border-color:#0e639c;color:#fff}
.toolbar button:hover{background:#333}
.toolbar button.primary:hover{background:#1177bb}
.tabs{display:flex;border-bottom:1px solid #333;padding:0 12px}
.tab{padding:10px 16px;cursor:pointer;border-bottom:2px solid transparent;color:#888;font-size:12px}
.tab:hover{color:#ccc}
.tab.active{color:#4ec9b0;border-bottom-color:#4ec9b0}
.content{flex:1;overflow-y:auto;padding:20px}
.panel{display:none}
.panel.active{display:block}
.field{margin-bottom:16px}
.field label{display:block;margin-bottom:6px;color:#999;font-size:12px}
.field input,.field select,.field textarea{
  width:100%;padding:8px 10px;border-radius:6px;border:1px solid #444;
  background:#2a2a2a;color:#ccc;font-size:13px;font-family:inherit;
}
.field textarea{min-height:100px;resize:vertical;font-family:'Cascadia Code','Consolas',monospace}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:#0e639c}
.field .hint{margin-top:4px;font-size:11px;color:#666}
.row{display:flex;gap:12px}
.row .field{flex:1}
.json-editor{width:100%;min-height:300px;padding:12px;border-radius:6px;border:1px solid #444;
  background:#1a1a1a;color:#ccc;font-family:'Cascadia Code','Consolas',monospace;font-size:12px;resize:vertical}
.status{padding:8px 20px;border-top:1px solid #333;font-size:11px;color:#666}
.status.ok{color:#4ec9b0}
.status.err{color:#f44747}
.checkbox-row{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.checkbox-row input{width:auto}
.checkbox-row label{margin:0}
</style>
</head>
<body>
<div class="toolbar">
  <h1>⚙ Pi Standalone 设置</h1>
  <button id="btn-reload">重新加载</button>
  <button id="btn-save" class="primary">保存</button>
</div>
<div class="tabs">
  <div class="tab active" data-tab="general">常规</div>
  <div class="tab" data-tab="chat">聊天</div>
  <div class="tab" data-tab="permission">权限</div>
  <div class="tab" data-tab="agent">pi agent</div>
  <div class="tab" data-tab="raw">原始 JSON</div>
</div>
<div class="content">
  <!-- General -->
  <div class="panel active" id="panel-general">
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
        <option value="auto">自动</option>
        <option value="en">English</option>
        <option value="zh-cn">简体中文</option>
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
  </div>
  <!-- Chat -->
  <div class="panel" id="panel-chat">
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
    <div class="field">
      <label>背景图片路径（可选）</label>
      <input type="text" id="cfg-chatBackgroundImage" placeholder="留空则无背景">
    </div>
    <div class="field">
      <label>背景不透明度 (0-1)</label>
      <input type="number" id="cfg-chatBackgroundOpacity" min="0" max="1" step="0.1">
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="cfg-mcpEnabled">
      <label for="cfg-mcpEnabled">启用 MCP</label>
    </div>
    <div class="field">
      <label>MCP 空闲断开（分钟，0=不断开）</label>
      <input type="number" id="cfg-mcpIdleTimeout" min="0">
    </div>
    <div class="checkbox-row">
      <input type="checkbox" id="cfg-rpcTrace">
      <label for="cfg-rpcTrace">RPC 调试日志</label>
    </div>
  </div>
  <!-- Permission -->
  <div class="panel" id="panel-permission">
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
      <label>危险命令模式（每行一个正则，留空用默认）</label>
      <textarea id="cfg-dangerousPatterns" placeholder="\\\\brm\\\\s+-rf\\\\b"></textarea>
    </div>
  </div>
  <!-- pi agent -->
  <div class="panel" id="panel-agent">
    <div class="field">
      <label>系统提示词追加（~/.pi/agent/APPEND_SYSTEM.md）</label>
      <textarea id="agent-append" placeholder="追加到 pi 默认系统提示词之后"></textarea>
    </div>
    <div class="field">
      <label>系统提示词覆盖（~/.pi/agent/SYSTEM.md）</label>
      <textarea id="agent-override" placeholder="完全替换 pi 默认系统提示词（慎用）"></textarea>
    </div>
    <div class="field">
      <label>models.json（只读预览）</label>
      <textarea id="agent-models" readonly></textarea>
    </div>
    <div class="field">
      <label>settings.json（~/.pi/agent/settings.json）</label>
      <textarea id="agent-settings"></textarea>
    </div>
  </div>
  <!-- Raw -->
  <div class="panel" id="panel-raw">
    <div class="field">
      <label>config.json（~/.pi/standalone/config.json）</label>
      <textarea class="json-editor" id="raw-config"></textarea>
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

// Tabs
document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('panel-' + t.dataset.tab).classList.add('active');
  };
});

let currentConfig = {};

async function loadAll() {
  try {
    currentConfig = await window.pi.invoke('pi:get-config');
    $('cfg-piPath').value = currentConfig.piPath || '';
    $('cfg-workspaceRoot').value = currentConfig.workspaceRoot || '';
    $('cfg-language').value = currentConfig.language || 'auto';
    $('cfg-args').value = (currentConfig.args || []).join('\\n');
    $('cfg-env').value = JSON.stringify(currentConfig.env || {}, null, 2);
    $('cfg-chatFontSize').value = currentConfig.chatFontSize || 13;
    $('cfg-chatSendShortcut').value = currentConfig.chatSendShortcut || 'enter';
    $('cfg-chatMermaidTheme').value = currentConfig.chatMermaidTheme || 'default';
    $('cfg-chatBackgroundImage').value = currentConfig.chatBackgroundImage || '';
    $('cfg-chatBackgroundOpacity').value = currentConfig.chatBackgroundOpacity ?? 1;
    $('cfg-mcpEnabled').checked = !!currentConfig.mcpEnabled;
    $('cfg-mcpIdleTimeout').value = currentConfig.mcpIdleTimeout ?? 10;
    $('cfg-rpcTrace').checked = !!currentConfig.rpcTrace;
    $('cfg-permissionMode').value = currentConfig.permissionMode || 'AskForApproval';
    $('cfg-disabledTools').value = (currentConfig.disabledTools || []).join(', ');
    $('cfg-dangerousPatterns').value = (currentConfig.dangerousPatterns || []).join('\\n');
    $('raw-config').value = JSON.stringify(currentConfig, null, 2);

    const agent = await window.pi.invoke('pi:read-agent-files');
    $('agent-append').value = agent.append || '';
    $('agent-override').value = agent.override || '';
    $('agent-models').value = agent.models || '{}';
    $('agent-settings').value = agent.settings || '{}';
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
    const dangerousPatterns = $('cfg-dangerousPatterns').value.split('\\n').map(s => s.trim()).filter(Boolean);
    const partial = {
      piPath: $('cfg-piPath').value.trim(),
      workspaceRoot: $('cfg-workspaceRoot').value.trim(),
      language: $('cfg-language').value,
      args, env,
      chatFontSize: Number($('cfg-chatFontSize').value) || 13,
      chatSendShortcut: $('cfg-chatSendShortcut').value,
      chatMermaidTheme: $('cfg-chatMermaidTheme').value,
      chatBackgroundImage: $('cfg-chatBackgroundImage').value.trim(),
      chatBackgroundOpacity: Number($('cfg-chatBackgroundOpacity').value) || 1,
      mcpEnabled: $('cfg-mcpEnabled').checked,
      mcpIdleTimeout: Number($('cfg-mcpIdleTimeout').value) || 0,
      rpcTrace: $('cfg-rpcTrace').checked,
      permissionMode: $('cfg-permissionMode').value,
      disabledTools, dangerousPatterns,
    };
    await window.pi.invoke('pi:set-config', partial);
    await window.pi.invoke('pi:write-agent-files', {
      append: $('agent-append').value,
      override: $('agent-override').value,
      settings: $('agent-settings').value,
    });
    currentConfig = await window.pi.invoke('pi:get-config');
    $('raw-config').value = JSON.stringify(currentConfig, null, 2);
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
