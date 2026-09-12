/**
 * UI language for the app's OWN strings.
 *
 * Scope today (accurate, not aspirational):
 *   - COVERED: the settings window (all eight tab labels) plus the language
 *     selector itself. `buildSettingsHtml(lang)` renders them through t().
 *   - NOT COVERED YET: the chat-window surfaces this project adds — dock
 *     (terminal/files/changes), sidebar, command palette, telemetry panel — and
 *     the tray/menu/dialog strings. Those still carry Chinese literals.
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
};

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
