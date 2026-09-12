
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
  };
});

// ── State ──
let modelsJson = {};
let authJson = {};
let settingsJson = {};

function maskKey(k) {
  if (!k) return '（未设置）';
  // main already masks secrets before they reach this window — don't mask twice
  if (k.indexOf('•') !== -1) return k;
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
    const base = e.replace(/\.disabled(-vscode)?$/, '');
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
].join('
');

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
      body.textContent = '';
      if (meta) meta.textContent = '';
      setStatus('读取更新日志失败: ' + ((res && res.error) || '未知错误'), false);
    }
  } catch (err) {
    body.textContent = '';
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
    $('cfg-args').value = (currentConfig.args || []).join('\n');
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
    const args = $('cfg-args').value.split('\n').map(s => s.trim()).filter(Boolean);
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
