/**
 * UI language for the app's OWN strings.
 *
 * Scope today (accurate, not aspirational):
 *   - COVERED: the settings window (all eight tab labels and its shell) plus the
 *     language selector; the chat window's title bar and its empty-state button;
 *     the tray menu and the about dialog. Each renders through t(key, lang),
 *     with lang resolved from `uiLanguage` (auto = OS locale).
 *   - NOT COVERED YET: the sidebar, the dock (terminal/files/changes), the
 *     command palette and the telemetry panel. Those still carry Chinese
 *     literals, so choosing English today gives an English settings window,
 *     title bar and tray with the rest in Chinese.
 *
 * The upstream chat UI is unaffected either way: it has its own locales under
 * vendor/upstream/pi-chat/src/locales, driven by PI_LANG_PLACEHOLDER.
 *
 * Extending coverage is mechanical: add keyed entries here, then replace the
 * literal in the module with t("key", lang). Modules that build HTML strings
 * must take `lang` as a parameter (buildSettingsHtml already does).
 *
 * Usage: `t("settings.tab.models", lang)`. Missing keys fall back to zh-cn and
 * then to the key itself, so a half-translated surface degrades instead of
 * breaking. `uiLanguage: "auto"` resolves from the OS locale.
 */
export type UiLang = "zh-cn" | "en";
export type UiLanguageSetting = "auto" | UiLang;

interface Entry {
  "zh-cn": string;
  en: string;
}

export const UI_STRINGS: Record<string, Entry> = {
  // settings window — tabs and shell
  "settings.title": { "zh-cn": "Pi Heao 设置", en: "Pi Heao Settings" },
  "settings.tab.models": { "zh-cn": "模型配置", en: "Models" },
  "settings.tab.extensions": { "zh-cn": "扩展插件", en: "Extensions" },
  "settings.tab.skills": { "zh-cn": "技能", en: "Skills" },
  "settings.tab.sysprompt": { "zh-cn": "系统提示词", en: "System prompt" },
  "settings.tab.appearance": { "zh-cn": "外观", en: "Appearance" },
  "settings.tab.diagnostics": { "zh-cn": "诊断", en: "Diagnostics" },
  "settings.tab.changelog": { "zh-cn": "更新日志", en: "Changelog" },
  "settings.tab.general": { "zh-cn": "常规", en: "General" },
  "settings.language": { "zh-cn": "界面语言", en: "Interface language" },
  "settings.language.auto": { "zh-cn": "跟随系统", en: "Follow system" },
  "settings.language.zh": { "zh-cn": "简体中文", en: "简体中文" },
  "settings.language.en": { "zh-cn": "English", en: "English" },

  // chat window — title bar
  "tb.currentSession": { "zh-cn": "当前会话", en: "Current session" },
  "tb.tokenUsage": { "zh-cn": "Token 用量", en: "Token usage" },
  "tb.context": { "zh-cn": "上下文占用", en: "Context usage" },
  "tb.ttft": { "zh-cn": "首 token 延迟", en: "First-token latency" },
  "tb.tps": { "zh-cn": "输出速度", en: "Output speed" },
  "tb.cost": { "zh-cn": "本次会话花费", en: "Cost of this session" },
  "tb.new": { "zh-cn": "新建会话", en: "New session" },
  "tb.newHint": { "zh-cn": "新建会话 (Ctrl+N)", en: "New session (Ctrl+N)" },
  "tb.dockHint": {
    "zh-cn": "终端 / 文件 / 变更 (Ctrl+&#96;)",
    en: "Terminal / Files / Changes (Ctrl+&#96;)",
  },
  "tb.openDock": { "zh-cn": "打开终端面板", en: "Open the terminal panel" },
  "tb.history": { "zh-cn": "会话历史 (Ctrl+H)", en: "Session history (Ctrl+H)" },
  "tb.historyLabel": { "zh-cn": "会话历史", en: "Session history" },
  "tb.search": { "zh-cn": "搜索会话 (Ctrl+F)", en: "Search sessions (Ctrl+F)" },
  "tb.searchLabel": { "zh-cn": "搜索会话", en: "Search sessions" },
  "tb.refresh": { "zh-cn": "重新加载会话", en: "Reload the session" },
  "tb.export": { "zh-cn": "导出当前会话", en: "Export this session" },
  "tb.exportLabel": { "zh-cn": "导出会话", en: "Export session" },
  "tb.settings": { "zh-cn": "设置 (Ctrl+,)", en: "Settings (Ctrl+,)" },
  "tb.settingsLabel": { "zh-cn": "设置", en: "Settings" },
  "tb.expandSidebar": { "zh-cn": "展开侧栏", en: "Expand the sidebar" },

  // tray menu
  "tray.show": { "zh-cn": "显示主窗口", en: "Show window" },
  "tray.showUnread": { "zh-cn": "显示主窗口（{n} 条未读）", en: "Show window ({n} unread)" },
  "tray.newSession": { "zh-cn": "新建会话", en: "New session" },
  "tray.recent": { "zh-cn": "最近会话", en: "Recent sessions" },
  "tray.settings": { "zh-cn": "设置", en: "Settings" },
  "tray.about": { "zh-cn": "关于 Pi Heao GUI", en: "About Pi Heao GUI" },
  "tray.quit": { "zh-cn": "退出", en: "Quit" },
  "tray.noSessions": { "zh-cn": "（暂无会话）", en: "(no sessions yet)" },
  "tray.aboutTitle": { "zh-cn": "关于", en: "About" },
  "tray.ok": { "zh-cn": "好", en: "OK" },
};

/** Interpolate {name} placeholders — keeps translators away from string code. */
export function tParams(
  key: string,
  lang: UiLang,
  params: Record<string, string | number>,
): string {
  let out = t(key, lang);
  for (const [name, value] of Object.entries(params)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

/** Resolve "auto" against the OS locale. */
export function resolveUiLang(language: UiLanguageSetting, systemLocale?: string): UiLang {
  if (language === "en") return "en";
  if (language === "zh-cn") return "zh-cn";
  const locale = (systemLocale ?? process.env.LANG ?? "").toLowerCase();
  return locale.startsWith("zh") ? "zh-cn" : "en";
}

/** Translate a key; falls back to zh-cn, then to the key itself. */
export function t(key: string, lang: UiLang): string {
  const entry = UI_STRINGS[key];
  if (!entry) return key;
  return entry[lang] ?? entry["zh-cn"] ?? key;
}

/** All keys translated for a language (used by tests and the settings preview). */
export function translateAll(lang: UiLang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(UI_STRINGS)) out[key] = t(key, lang);
  return out;
}

/**
 * Phrases used by the chat-window surfaces we inject (sidebar, dock, palette,
 * telemetry panel). Those surfaces are built as HTML/script fragments inside
 * template literals, so they are translated by exact phrase substitution when a
 * fragment is assembled — the Chinese literal itself is the key, which keeps the
 * diff local and cannot half-translate a control: either the phrase is in this
 * table or the coverage test below lists it.
 *
 * Search keywords are included deliberately: they are what the palette matches
 * against, so an English user needs English keywords too.
 *
 * Longest match wins, so "新建会话 (Ctrl+N)" is translated as a whole rather than
 * leaving "(Ctrl+N)" orphaned behind "新建会话".
 */
export const CHAT_STRINGS: Record<string, string> = {
  // ── sidebar
  "会话": "Sessions",
  "新建会话": "New session",
  "工作目录": "Workspace",
  "选择工作目录": "Choose a working directory",
  "选择工作目录…": "Choose a working directory…",
  "切换工作目录…": "Switch working directory…",
  "搜索会话…": "Search sessions…",
  "最近会话": "Recent sessions",
  "已归档": "Archived",
  "显示 / 隐藏已归档会话": "Show / hide archived sessions",
  "显示已归档会话": "Show archived sessions",
  "（暂无会话）": "(no sessions yet)",
  "没有匹配的会话": "No matching sessions",
  "还没有会话": "No sessions yet",
  "点击「新建会话」开始": "Click “New session” to start",
  "重命名会话": "Rename session",
  "重命名…": "Rename…",
  "取消置顶": "Unpin",
  "置顶": "Pin",
  "归档（从列表隐藏）": "Archive (hide from the list)",
  "恢复到会话列表": "Restore to the session list",
  "删除…": "Delete…",
  "删除该会话文件？此操作不可撤销。": "Delete this session file? This cannot be undone.",
  "复制会话路径": "Copy the session path",
  "在新窗口打开": "Open in a new window",
  "导出对话为 Markdown": "Export the conversation as Markdown",
  "载入会话…": "Loading the session…",
  "切换失败: ": "Switch failed: ",
  "切换出错: ": "Switch error: ",
  "操作失败: ": "Operation failed: ",
  "操作失败": "Operation failed",
  "折叠侧栏": "Collapse the sidebar",
  "展开侧栏": "Expand the sidebar",
  "折叠 / 展开侧栏": "Collapse / expand the sidebar",
  "刚刚": "just now",
  "更早": "earlier",
  " 分钟前": " min ago",
  " 小时前": " h ago",

  // ── dock
  "终端": "Terminal",
  "文件": "Files",
  "变更": "Changes",
  "重启": "Restart",
  "重启终端": "Restart the terminal",
  "系统 shell": "System shell",
  "在 pi TUI 与系统 shell 之间切换": "Switch between the pi TUI and a system shell",
  "拖动调整高度": "Drag to resize",
  "上一级": "Up one level",
  "保存 (Ctrl+S)": "Save (Ctrl+S)",
  "插入到对话输入框": "Insert into the chat input",
  "从左侧选择一个文件…": "Pick a file on the left…",
  "非 git 仓库": "Not a git repository",
  "当前工作目录不是 git 仓库。": "The working directory is not a git repository.",
  "没有匹配项": "No matches",
  "空目录": "Empty directory",
  "已生成": "Generated",
  "生成中": "Generating…",
  "生成失败: ": "Generation failed: ",
  "生成失败": "Generation failed",
  "正在生成提交信息…": "Generating the commit message…",
  "生成后会显示在这里，可以直接编辑…": "The message appears here, ready to edit…",
  "给模型的备注（可选）": "Note for the model (optional)",
  "尚未暂存": "Unstaged",
  "已暂存": "Staged",
  "已生成（diff 过大，按文件截断）": "Generated (diff too large, truncated per file)",
  "保存失败: ": "Save failed: ",
  "文件: ": "File: ",
  "先在编辑器里选择一段内容": "Select something in the editor first",
  " 个字符到对话输入框": " characters to the chat input",
  "把选中的内容发送到对话输入框": "Send the selection to the chat input",
  "无法解析拖入文件的路径": "Could not resolve the dropped file path",
  "终端启动失败: ": "Terminal failed to start: ",
  "终端不可用": "Terminal unavailable",
  "xterm.js 未加载": "xterm.js did not load",
  "终端尚未就绪": "The terminal is not ready yet",
  "进程已退出": "process exited",
  "桥接未就绪": "Bridge not ready",
  "终端不可用，无法启动登录": "Terminal unavailable, cannot start the login",
  "已发送 /login ": "Sent /login ",
  " —— 请在终端里完成授权": " — finish authorizing in the terminal",

  // ── palette (titles and the keywords it matches on)
  "命令面板": "Command palette",
  "搜索会话、历史消息、命令…": "Search sessions, history, commands…",
  "打开设置": "Open settings",
  "Token 与性能统计": "Token and performance stats",
  "会话历史": "Session history",
  "export 导出 md": "export Export md",
  "reload 重载 重启": "reload Reload restart",
  "archive 归档 隐藏": "archive Archive hide",
  "sidebar 侧栏 折叠": "sidebar Sidebar collapse",
  "new session 新 清空": "new session New clear",
  "settings 配置 模型 密钥": "settings Config models keys",
  "theme 主题 深色 浅色 亮色": "theme Theme dark light bright",
  "workspace cwd 目录 项目": "workspace cwd directory project",
  "token 统计 性能 ttft 速度 用量": "token stats performance ttft speed usage",
  "diagnostics 日志 log 诊断 反馈": "diagnostics Logs log feedback",

  // ── telemetry panel
  "Token 用量": "Token usage",
  "首 token 延迟": "First-token latency",
  "输出速度": "Output speed",
  "缓存读 / 写": "Cache read / write",
  "本次会话花费": "Cost of this session",
  "总 tokens": "Total tokens",
  "输入 tokens": "Input tokens",
  "输出 tokens": "Output tokens",
  "总花费": "Total cost",
  "工具调用": "Tool calls",
  "轮次": "Turns",
  "本轮输出": "Output this turn",
  "本轮 / 会话均值": "This turn / session average",
  "output tokens / 解码秒": "output tokens / decode second",
  "今日 / 本月": "today / this month",
  "（今日 ": "(today ",
  "，本月 ": ", this month ",
  "（含推理 ": "(incl. reasoning ",
  "与上下文长度不同：含全部历史轮次": "Differs from the context length: it covers every turn",
  "本轮会话还没有完成的轮次": "This session has no completed turns yet",
  "关闭": "Close",
  "刷新": "Refresh",

  // ── remaining sidebar / dock / palette / telemetry strings
  "搜索会话": "Search sessions",
  "显示/隐藏已归档会话": "Show / hide archived sessions",
  "导出": "Export",
  "设置": "Settings",
  "已导出到: ": "Exported to: ",
  "昨天": "yesterday",
  "今天": "today",
  "本周": "this week",
  // The date is assembled as "3 月 5 日"; English drops that punctuation.
  " 月 ": "/",
  " 日": "",
  "未命名": "Untitled",
  "未知错误": "Unknown error",
  "取消": "Cancel",
  "确定": "OK",
  "没有已归档会话": "No archived sessions",
  "恢复": "Restore",
  "关闭面板": "Close panel",
  "未打开文件": "No file open",
  "发送选中到对话": "Send the selection to the chat",
  "保存": "Save",
  "生成提交信息": "Generate the commit message",
  "默认使用已暂存改动（git add 后）；没有暂存则用工作区改动。":
    "Uses the staged changes (after git add), and falls back to the working tree when nothing is staged.",
  "提交信息": "Commit message",
  "复制": "Copy",
  "插入到对话": "Insert into the chat",
  "读取失败": "Read failed",
  "已保存": "Saved",
  "已发送": "Sent",
  "未暂存": "Unstaged",
  "解码速度": "Decode speed",
  "缓存命中率": "Cache hit rate",
  "花费": "Cost",
  "累计": "total",
  "最近轮次": "Recent turns",
  "解码": "Decode",
  "输出": "Output",
  "推理": "Reasoning",
  "缓存读": "Cache read",
  "输入": "Input",
  "工具": "Tool",
  "均值": "average",
  "今日": "today",
  "本月": "this month",
  "读": "read",
  "写": "write",
  "（当前会话尚未写入磁盘）": "(this session is not on disk yet)",
  "执行": "Run",
  "选择": "select",
  "分组": "group",
  "仅搜会话名": "sessions only",
  "导出当前对话": "Export this conversation",
  "重新加载会话": "Reload the session",
  "切换深色": "Switch dark",
  "浅色主题": "light theme",
  "打开诊断信息": "Open diagnostics",
  "命令": "commands",
  "指令": "prompts",
  "搜索历史消息…": "Search message history…",
  "条历史命中": "message hits",
  "你": "You",
  // A search hit is described as "<session> · 第 12 行".
  " · 第 ": " · line ",
  " 行": "",
  "数据来自 pi 的 RPC 事件（message_update 携带累计 usage）。价格按 provider 回报计算；":
    "Numbers come from the pi RPC events (message_update carries cumulative usage). Prices follow what the provider reports;",
  "未提供 reasoning 拆分或缓存计费的模型会显示 –。":
    "models that report neither reasoning splits nor cache billing show –.",
};

let chatKeysByLength: string[] | null = null;

/**
 * Translate one of our injected fragments. Only exact phrases from
 * CHAT_STRINGS are replaced, and only when English was asked for.
 */
export function translateFragment(text: string, lang: UiLang): string {
  if (lang !== "en" || !text) return text;
  if (!chatKeysByLength) {
    chatKeysByLength = Object.keys(CHAT_STRINGS).sort((a, b) => b.length - a.length);
  }
  let out = text;
  for (const zh of chatKeysByLength) {
    if (out.includes(zh)) out = out.split(zh).join(CHAT_STRINGS[zh]);
  }
  return out;
}

/**
 * Chinese runs left in a fragment. Used by the coverage test to list exactly
 * which phrases still need an entry, instead of failing with "something is
 * untranslated".
 */
export function untranslatedRuns(text: string): string[] {
  const found = new Set<string>();
  const re = /[^\s<>"'`=(){}]{0,40}[\u4e00-\u9fff][^\s<>"'`=(){}]{0,40}/g;
  let m = re.exec(text);
  while (m !== null) {
    found.add(m[0]);
    m = re.exec(text);
  }
  return [...found];
}
