/**
 * Every `invoke("pi:…")` a renderer makes must be in that window's preload
 * allowlist. A missing entry does not throw in the UI — the bridge rejects with
 * "blocked channel", the feature silently does nothing, and the only trace is a
 * console line. Session rename shipped broken exactly this way.
 *
 * This test diffs the channels each window's code uses against the allowlist its
 * preload actually grants.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");

function allowlistOf(preloadFile) {
  const src = fs.readFileSync(path.join(SRC, "preload", preloadFile), "utf8");
  const block = /ALLOWED[\s\S]*?new Set<string>\(\[([\s\S]*?)\]\)/.exec(src);
  assert.ok(block, `${preloadFile}: could not find the ALLOWED set`);
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function channelsUsedBy(files) {
  const used = new Map(); // channel -> first file that uses it
  for (const file of files) {
    const src = fs.readFileSync(path.join(SRC, "main", file), "utf8");
    const re = /invoke\(\s*["']([a-z0-9:-]+)["']/gi;
    let m = re.exec(src);
    while (m !== null) {
      if (!used.has(m[1])) used.set(m[1], file);
      m = re.exec(src);
    }
  }
  return used;
}

/** Channels each window is allowed to reach are declared here on purpose. */
const WINDOWS = [
  {
    name: "settings window",
    preload: "preload-settings.ts",
    files: ["settings-window.ts"],
  },
  {
    name: "chat window",
    preload: "preload.ts",
    files: ["chat-adapter.ts", "sidebar.ts", "dock.ts", "palette.ts", "stats-panel.ts"],
  },
];

test("every channel a window invokes is granted by its preload", () => {
  const problems = [];
  for (const win of WINDOWS) {
    const allowed = allowlistOf(win.preload);
    for (const [channel, file] of channelsUsedBy(win.files)) {
      if (!allowed.has(channel)) problems.push(`${win.name}: ${channel} (used in ${file})`);
    }
  }
  assert.deepEqual(problems, [], `channels blocked by the preload allowlist:\n  ${problems.join("\n  ")}`);
});

test("every granted channel has a main-process handler", () => {
  // A stale, over-broad grant is the quiet half of the same problem: it hands a
  // renderer powers nothing answers. Handlers live in several main modules, and
  // channel names are also declared as constants, so scan them all.
  const mainDir = path.join(SRC, "main");
  const sources = fs
    .readdirSync(mainDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(mainDir, f), "utf8"));
  sources.push(fs.readFileSync(path.join(SRC, "shared", "types.ts"), "utf8"));

  const handlers = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/"(pi:[a-z0-9-]+)"/g)) handlers.add(m[1]);
    for (const m of src.matchAll(/"([a-z0-9-]+)"/g)) handlers.add(`pi:${m[1]}`);
  }
  const problems = [];
  for (const win of WINDOWS) {
    for (const channel of allowlistOf(win.preload)) {
      if (!handlers.has(channel)) problems.push(`${win.name}: ${channel} granted with no handler`);
    }
  }
  assert.deepEqual(problems, [], `dangling grants:\n  ${problems.join("\n  ")}`);
});
