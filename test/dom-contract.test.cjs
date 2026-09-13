"use strict";

/**
 * Contract test: the hooks our injected chrome reaches for.
 *
 * The chat UI comes from `studio/`, which we now own and may edit — and which we
 * may also update from upstream when that is useful. Either way, renaming one
 * element there does not break the page: the document still renders, and a feature
 * quietly stops working. That is not hypothetical here — an id was renamed once
 * during a duplicate-id fix, and it made `npm run verify` impossible to pass
 * without anyone noticing, because that script was not being run.
 *
 * This asserts the hooks exist in the generated document, so a rename fails a fast
 * unit test with the name of the hook that went missing.
 *
 * Caveat worth knowing: this greps the document text rather than the parsed DOM,
 * so an id that survives only inside a script body would still pass. It catches
 * renames, which is the failure mode that actually bit us.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { buildChatHtml } = require("../dist/main/chat-adapter.js");
const { DEFAULT_CONFIG } = require("../dist/shared/types.js");

const ROOT = path.join(__dirname, "..");
const UI_BUNDLE = path.join(ROOT, "studio", "pi-chat", "dist", "index.html");
const hasUi = fs.existsSync(UI_BUNDLE);
const html = hasUi ? buildChatHtml(ROOT, DEFAULT_CONFIG) : null;

/** Hooks that live in the UI code from `studio/`. */
const UPSTREAM_HOOKS = [
  ['id="input"', "the composer: paste handling and the dock's send-to-chat"],
  ["user-bubble", "user message bubbles"],
  // There is no `assistant-bubble` class in that UI — verify-features.cjs tries
  // `.assistant-bubble, .msg.assistant` defensively, which is where the wrong name
  // came from. Message nodes are identified through the class the UI does use.
  ["msg assistant", "assistant message nodes the palette and sidebar jump to"],
];

/** Hooks we inject ourselves — these break only if our own markup drifts. */
const OUR_HOOKS = [
  "pi-shell",
  "pi-main",
  "pi-dock",
  "pi-stat-ctx",
  "pi-stat-cost",
  "pi-files-list",
  "pi-git-branch",
];

test("the UI bundle exists (the rest of this file is meaningless without it)", {
  skip: !hasUi,
}, () => {
  assert.ok(html, "buildChatHtml returned null even though the bundle is present");
});

test("the generated document still has every hook we depend on", { skip: !hasUi }, () => {
  const missing = [];
  for (const [needle, why] of UPSTREAM_HOOKS) {
    if (!html.includes(needle)) missing.push(`${needle}  ← ${why}`);
  }
  for (const id of OUR_HOOKS) {
    if (!html.includes(id)) missing.push(`${id}  ← our own injected element`);
  }
  assert.deepEqual(
    missing,
    [],
    `hooks missing from the generated page (renamed upstream, or dropped by us?):\n  ${missing.join("\n  ")}`,
  );
});
