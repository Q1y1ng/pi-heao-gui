/**
 * pi changelog reader (port of upstream `src/chat/pi-changelog.ts`).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  findPackageRoot,
  readPiChangelog,
  truncate,
  PI_PACKAGE_NAME,
  MAX_CHARS,
} = require("../dist/main/changelog.js");

function makePackageTree({ withChangelog = true, name = PI_PACKAGE_NAME, version = "9.9.9" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-changelog-"));
  // <root>/lib/node_modules/<pkg>/dist/bundle/cli.js
  const pkgDir = path.join(root, "lib", "node_modules", ...name.split("/"));
  fs.mkdirSync(path.join(pkgDir, "dist", "bundle"), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, version }), "utf8");
  const cli = path.join(pkgDir, "dist", "bundle", "cli.js");
  fs.writeFileSync(cli, "// cli", "utf8");
  if (withChangelog) {
    fs.writeFileSync(
      path.join(pkgDir, "CHANGELOG.md"),
      "# Changelog\n\n## 1.0.0\n- did a thing\n",
      "utf8",
    );
  }
  return { root, pkgDir, cli };
}

/**
 * Windows reports temp dirs in 8.3 form on some runners (C:\Users\RUNNER~1\...)
 * while realpath() expands them (C:\Users\runneradmin\...), and realpathSync
 * does not always do the same expansion. Comparing the tail of the path keeps the
 * assertion meaningful without depending on how the OS chooses to spell it.
 */
function expectSameLocation(actual, expected, label) {
  const tail = (p) => path.resolve(String(p)).split(/[\\/]/).slice(-4).join("/").toLowerCase();
  assert.equal(tail(actual), tail(expected), `${label}: ${actual} vs ${expected}`);
}

test("finds the package root by walking up from the binary", async () => {
  const { pkgDir, cli } = makePackageTree();
  const found = await findPackageRoot(path.dirname(cli));
  assert.ok(found, "expected a package root");
  expectSameLocation(found, pkgDir, "package root");
});

test("stops at a package.json with a different name", async () => {
  const { root } = makePackageTree({ name: "some-other-package" });
  assert.equal(
    await findPackageRoot(path.join(root, "lib", "node_modules", "some-other-package")),
    null,
  );
});

test("reads the changelog next to the resolved binary", async () => {
  const { cli, pkgDir } = makePackageTree();
  const res = await readPiChangelog(cli);
  assert.equal(res.ok, true);
  assert.match(res.content, /# Changelog/);
  assert.ok(res.root, "expected a resolved package root");
  expectSameLocation(res.root, pkgDir, "changelog root");
  assert.equal(res.version, "9.9.9");
});

test("reports a clear error when the changelog is missing", async () => {
  const { cli } = makePackageTree({ withChangelog: false });
  const res = await readPiChangelog(cli);
  assert.equal(res.ok, false);
  assert.match(res.error, /CHANGELOG/);
});

test("a missing pi path is a clean failure, not a throw", async () => {
  const res = await readPiChangelog(undefined);
  assert.equal(res.ok, false);
  assert.match(res.error, /pi/);
});

test("truncates long content with a marker", () => {
  const long = "x".repeat(MAX_CHARS + 500);
  const out = truncate(long);
  assert.ok(out.length < long.length);
  assert.match(out, /已截断/);
  assert.equal(truncate("short"), "short");
});
