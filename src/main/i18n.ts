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
export function tParams(key: string, lang: UiLang, params: Record<string, string | number>): string {
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
