/**
 * UI language (this app's own strings; the upstream chat UI has its own locales).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { t, tParams, resolveUiLang, translateAll, UI_STRINGS } = require("../dist/main/i18n.js");

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

test("English entries never fall back to Chinese text", () => {
  // A half-translated key looks fine in tests and wrong in the UI: the English
  // build would silently show the Chinese string for that control.
  const cjk = /[\u4e00-\u9fff]/;
  // A language's own name stays in that language on purpose.
  const allowed = new Set(["settings.language.zh"]);
  const offenders = Object.entries(UI_STRINGS)
    .filter(([key, entry]) => !allowed.has(key) && cjk.test(entry.en))
    .map(([key, entry]) => `${key} = ${entry.en}`);
  assert.deepEqual(offenders, [], `untranslated English entries:\n  ${offenders.join("\n  ")}`);
});

test("tParams interpolates placeholders in every language", () => {
  for (const lang of ["zh-cn", "en"]) {
    const out = tParams("tray.showUnread", lang, { n: 3 });
    assert.match(out, /3/, `${lang}: placeholder was not substituted`);
    assert.ok(!out.includes("{"), `${lang}: a placeholder was left behind: ${out}`);
  }
});
