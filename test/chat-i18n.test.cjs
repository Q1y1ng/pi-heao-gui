/**
 * Coverage of the chat-window surfaces we inject (sidebar, dock, palette,
 * telemetry panel). They are assembled as HTML/script fragments, so their text
 * is translated by exact phrase substitution — and this test is what makes that
 * honest: it lists the phrases still missing from CHAT_STRINGS instead of
 * failing with "something is untranslated".
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const DIST = path.join(__dirname, "..", "dist", "main");
const { CHAT_STRINGS, translateFragment, untranslatedRuns } = require(path.join(DIST, "i18n.js"));

function fragments() {
  const { SIDEBAR_HTML, SIDEBAR_SCRIPT } = require(path.join(DIST, "sidebar.js"));
  const { DOCK_HTML, DOCK_SCRIPT } = require(path.join(DIST, "dock.js"));
  const { STATS_HTML, STATS_SCRIPT } = require(path.join(DIST, "stats-panel.js"));
  const { DECISIONS_HTML, DECISIONS_SCRIPT } = require(path.join(DIST, "decisions-panel.js"));
  const { WINDOWS_HTML, WINDOWS_SCRIPT } = require(path.join(DIST, "windows-panel.js"));
  const { PALETTE_HTML, PALETTE_SCRIPT } = require(path.join(DIST, "palette.js"));
  return [
    ["SIDEBAR_HTML", SIDEBAR_HTML],
    ["SIDEBAR_SCRIPT", SIDEBAR_SCRIPT],
    ["DOCK_HTML", DOCK_HTML],
    ["DOCK_SCRIPT", DOCK_SCRIPT],
    ["STATS_HTML", STATS_HTML],
    ["STATS_SCRIPT", STATS_SCRIPT],
    ["DECISIONS_HTML", DECISIONS_HTML],
    ["DECISIONS_SCRIPT", DECISIONS_SCRIPT],
    ["WINDOWS_HTML", WINDOWS_HTML],
    ["WINDOWS_SCRIPT", WINDOWS_SCRIPT],
    ["PALETTE_HTML", PALETTE_HTML],
    ["PALETTE_SCRIPT", PALETTE_SCRIPT],
  ];
}

/** Comments are not UI text; they are allowed to stay in the source language. */
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("every phrase in our fragments has an English entry", () => {
  const missing = new Set();
  for (const [name, fragment] of fragments()) {
    const english = stripComments(translateFragment(fragment, "en"));
    for (const run of untranslatedRuns(english)) missing.add(`${run}   (in ${name})`);
  }
  const list = [...missing];
  assert.deepEqual(list, [], `phrases still missing from CHAT_STRINGS:\n  ${list.join("\n  ")}`);
});

test("Chinese is never rewritten", () => {
  for (const [name, fragment] of fragments()) {
    assert.equal(translateFragment(fragment, "zh-cn"), fragment, `${name} was modified`);
  }
});

test("translated fragments are still valid JavaScript", () => {
  // The fragments carry scripts, so a translation can break code, not just text:
  // an apostrophe inside a single-quoted literal takes the whole injected script
  // down and the panel it drives goes dead, silently.
  const vm = require("node:vm");
  const problems = [];
  for (const [name, fragment] of fragments()) {
    // Pure markup fragments (the HTML shells) carry no code at all.
    if (!/<script[\s>]/i.test(fragment)) continue;
    const english = translateFragment(fragment, "en");
    const bodies = [];
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let m = re.exec(english);
    while (m !== null) {
      bodies.push(m[2]);
      m = re.exec(english);
    }
    const sources = bodies.length > 0 ? bodies : [english];
    sources.forEach((body, i) => {
      try {
        new vm.Script(body, { filename: `${name}#${i + 1}.en` });
      } catch (e) {
        problems.push(`${name}#${i + 1}: ${e.message}`);
      }
    });
  }
  assert.deepEqual(problems, [], `translated fragments do not parse:\n  ${problems.join("\n  ")}`);
});

test("no translation can break the script it lands in", () => {
  // The fragments are JavaScript too: a value is substituted into single-quoted
  // string literals there, so an apostrophe ends the literal and takes the whole
  // injected script down with it (that is exactly how the telemetry panel and the
  // command palette stopped working once).
  const offenders = Object.entries(CHAT_STRINGS)
    .filter(([, en]) => en.includes("'"))
    .map(([zh, en]) => `${zh} => ${en}`);
  assert.deepEqual(offenders, [], `values with an apostrophe:\n  ${offenders.join("\n  ")}`);
});

test("dictionary entries are non-empty and actually English", () => {
  // A few entries deliberately become empty in English: they are the punctuation
  // of a Chinese date ("3 月 5 日") or a search hit's position (" · 第 12 行").
  const REMOVED_IN_ENGLISH = new Set([" 日", " 行"]);
  const offenders = Object.entries(CHAT_STRINGS)
    .filter(([zh, en]) => {
      if (/[\u4e00-\u9fff]/.test(en)) return true;
      if (REMOVED_IN_ENGLISH.has(zh)) return false;
      return !en || en.trim() === "";
    })
    .map(([zh, en]) => `${zh} => ${en}`);
  assert.deepEqual(offenders, [], `bad entries:\n  ${offenders.join("\n  ")}`);
});
