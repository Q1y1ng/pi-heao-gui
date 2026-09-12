/**
 * UI language (this app's own strings; the upstream chat UI has its own locales).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { t, resolveUiLang, translateAll, UI_STRINGS } = require("../dist/main/i18n.js");

test("every entry carries both languages and no empty string", () => {
  const keys = Object.keys(UI_STRINGS);
  assert.ok(keys.length >= 8, `expected a real dictionary, got ${keys.length} keys`);
  for (const key of keys) {
    const entry = UI_STRINGS[key];
    for (const lang of ["zh-cn", "en"]) {
      assert.equal(typeof entry[lang], "string", `${key}.${lang} must be a string`);
      assert.ok(entry[lang].trim().length > 0, `${key}.${lang} must not be empty`);
    }
  }
});

test("t() returns the requested language", () => {
  assert.equal(t("settings.tab.models", "zh-cn"), "模型配置");
  assert.equal(t("settings.tab.models", "en"), "Models");
  assert.equal(t("settings.tab.changelog", "en"), "Changelog");
});

test("unknown keys degrade to the key instead of throwing", () => {
  assert.equal(t("settings.does.not.exist", "en"), "settings.does.not.exist");
  assert.equal(t("settings.does.not.exist", "zh-cn"), "settings.does.not.exist");
});

test("resolveUiLang honours auto/zh/en and the OS locale", () => {
  assert.equal(resolveUiLang("zh-cn"), "zh-cn");
  assert.equal(resolveUiLang("en"), "en");
  assert.equal(resolveUiLang("auto", "zh-CN"), "zh-cn");
  assert.equal(resolveUiLang("auto", "zh-Hans-CN"), "zh-cn");
  assert.equal(resolveUiLang("auto", "en-US"), "en");
  assert.equal(resolveUiLang("auto", "de-DE"), "en");
  assert.equal(resolveUiLang("auto", ""), "en");
});

test("translateAll covers the whole dictionary", () => {
  const zh = translateAll("zh-cn");
  const en = translateAll("en");
  assert.equal(Object.keys(zh).length, Object.keys(UI_STRINGS).length);
  assert.equal(Object.keys(en).length, Object.keys(UI_STRINGS).length);
  assert.notEqual(zh["settings.tab.models"], en["settings.tab.models"]);
});
