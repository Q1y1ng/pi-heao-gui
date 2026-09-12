/**
 * Settings window document: every control the script talks to must exist, and
 * every config field the new panels promise must be wired to pi:set-config.
 * This is a cheap structural test — the real window is verified by `npm run shot`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSettingsHtml } = require("../dist/main/settings-window.js");

const html = buildSettingsHtml();

test("all tabs have a matching panel", () => {
  const tabs = [...html.matchAll(/class="tab[^"]*" data-tab="([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(tabs.length >= 7, `expected at least 7 tabs, got ${tabs.length}`);
  for (const tab of tabs) {
    assert.ok(html.includes(`id="panel-${tab}"`), `missing panel for tab ${tab}`);
  }
  for (const required of [
    "models",
    "extensions",
    "skills",
    "sysprompt",
    "appearance",
    "diagnostics",
    "general",
  ]) {
    assert.ok(tabs.includes(required), `tab ${required} is missing`);
  }
});

test("every control id the script uses exists in the document", () => {
  const ids = [
    ...new Set([...html.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map((m) => m[1])),
  ];
  const orphans = ids.filter((id) => !id.startsWith("mf-") && !html.includes(`id="${id}"`));
  assert.deepEqual(orphans, [], `script references missing elements: ${orphans.join(", ")}`);
  // `mf-*` ids are generated at runtime by showModal() from the field key, so
  // they only exist while a modal is open — assert the factory instead.
  if (ids.some((id) => id.startsWith("mf-"))) {
    assert.match(html, /'mf-'\s*\+\s*f\.key/, "modal fields must build mf-<key> ids");
  }
});

test("appearance panel wires theme, accent and font size", () => {
  for (const id of [
    "theme-group",
    "accent-swatches",
    "accent-custom",
    "ap-fontSize",
    "ap-fontPreview",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
  }
  for (const theme of ["dark", "light", "system"]) {
    assert.ok(html.includes(`data-theme="${theme}"`), `missing theme choice ${theme}`);
  }
  const swatches = [...html.matchAll(/class="swatch" data-accent="(#[0-9a-f]{6})"/g)].map(
    (m) => m[1],
  );
  assert.ok(swatches.length >= 6, "expected at least six accent presets");
  assert.ok(html.includes("ap-fontSize"), "font size control missing");
});

test("config fields promised by the new panels are referenced", () => {
  for (const key of [
    "theme",
    "accent",
    "chatFontSize",
    "budgetDailyUsd",
    "budgetMonthlyUsd",
    "openAtLogin",
    "showArchived",
    "favoriteModels",
    "recentWorkspaces",
  ]) {
    assert.ok(html.includes(key), `config field ${key} is not surfaced in the UI`);
  }
});

test("extension packages and skills are manageable from the settings window", () => {
  for (const id of ["pkg-source", "btn-pkg-install", "btn-pkg-refresh", "pkg-status"]) {
    assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
  }
  assert.ok(html.includes('id="btn-add-skill"'), "missing skill creation button");
  for (const channel of [
    "pi:pkg-list",
    "pi:pkg-install",
    "pi:pkg-remove",
    "pi:read-skill",
    "pi:write-skill",
    "pi:delete-skill",
    "pi:auth-status",
  ]) {
    assert.ok(html.includes(channel), `channel ${channel} is never used`);
  }
});

test("diagnostics panel offers every supported operation", () => {
  for (const id of [
    "diag-info",
    "diag-log",
    "diag-feedback",
    "diag-report-path",
    "btn-diag-refresh",
    "btn-diag-log",
    "btn-diag-copy",
    "btn-diag-report",
    "btn-diag-openlogs",
    "btn-diag-openuserdata",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing diagnostics control ${id}`);
  }
  assert.ok(html.includes("pi:diagnostics"), "diagnostics channel is never called");
});

test("no template leakage in the generated markup", () => {
  // Only the static markup is checked: the injected script legitimately compares
  // against `undefined` and builds strings at runtime.
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.equal(/\bundefined\b/.test(markup), false, "literal undefined in markup");
  assert.equal(/\bNaN\b/.test(markup), false, "literal NaN in markup");
  assert.equal(/\$\{[a-zA-Z]/.test(markup), false, "uninterpolated template expression");
});

test("the settings document loads nothing from the network", () => {
  assert.match(html, /Content-Security-Policy/);
  // A bare example URL in a placeholder is fine; a loadable remote resource is not.
  const loadable = [
    ...html.matchAll(/<(?:script|link|img|iframe|source)[^>]*(?:src|href)="(https?:)?\/\/[^"]+"/g),
  ];
  assert.deepEqual(
    loadable.map((m) => m[0]),
    [],
  );
});
