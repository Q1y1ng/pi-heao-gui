"use strict";

/**
 * Assert that a packaged build actually contains what the app reads at runtime.
 *
 * CI builds and smoke-tests the app but never packaged it, so a `files` glob that
 * drops a runtime dependency — the vendored chat UI, the bridge extensions, the
 * node-pty natives — shipped only as far as a human happening to launch it.
 * This reads the asar header (no asar dependency needed) and checks the paths
 * the code resolves at runtime.
 *
 * Usage: node scripts/check-package.cjs [path-to-app.asar]
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ASAR = path.join(
  __dirname,
  "..",
  "dist-electron",
  "win-unpacked",
  "resources",
  "app.asar",
);

/** Read the file list out of an asar archive's JSON header. */
function listAsar(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(12);
    if (headerSize <= 0 || headerSize > 64 * 1024 * 1024) {
      throw new Error(`implausible asar header size: ${headerSize}`);
    }
    const json = Buffer.alloc(headerSize);
    fs.readSync(fd, json, 0, headerSize, 16);
    const header = JSON.parse(json.toString("utf8"));
    const out = [];
    const walk = (node, prefix) => {
      for (const [name, value] of Object.entries(node.files || {})) {
        const p = `${prefix}/${name}`;
        if (value.files) walk(value, p);
        else out.push(p);
      }
    };
    walk(header, "");
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/** Paths the app reads at runtime. Each has a comment saying what breaks without it. */
const REQUIRED = [
  "/dist/main/main.js", // the main process itself
  "/dist/main/settings-window.js", // settings page generator
  "/dist/preload/preload.js", // chat window bridge
  "/dist/preload/preload-settings.js", // settings window bridge
  "/dist/renderer/vendor/xterm.js", // dock terminal
  "/dist/renderer/vendor/codemirror.js", // dock file editor
  "/studio/pi-chat/dist/", // the vendored chat UI (any file under it)
  "/studio/bridge/todo.ts", // bundled extensions, mounted via -e
  "/studio/bridge/permission-gate.ts",
  "/studio/bridge/permission-policy.mjs", // the gate's decision, imported by the above
  "/studio/bridge/rewind-code.ts",
  "/studio/bridge/subagent/index.ts",
  "/studio/bridge/mcp/index.js",
  "/node_modules/node-pty/", // native terminal module
];

/** Paths that must be present as a directory prefix rather than an exact file. */
const PREFIXES = new Set(["/studio/pi-chat/dist/", "/node_modules/node-pty/"]);

function main() {
  const asarPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ASAR;
  if (!fs.existsSync(asarPath)) {
    console.error(`✗ app.asar not found: ${asarPath}`);
    console.error("  build first: npm run dist   (or: npm run dist:portable)");
    process.exit(1);
  }

  const files = listAsar(asarPath);
  const missing = REQUIRED.filter((want) =>
    PREFIXES.has(want) ? !files.some((f) => f.startsWith(want)) : !files.includes(want),
  );

  console.log(`asar: ${asarPath}`);
  console.log(`entries: ${files.length}`);
  for (const want of REQUIRED) {
    const ok = !missing.includes(want);
    console.log(`${ok ? "  ✓" : "  ✗"} ${want}`);
  }

  if (missing.length) {
    console.error(`\n✗ ${missing.length} required path(s) missing from the build.`);
    console.error("  Check the electron-builder `files` globs in package.json.");
    process.exit(1);
  }
  console.log("\n✓ packaged build contains every runtime dependency checked");
}

main();
