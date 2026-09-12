/**
 * The pi CLI bridge: package list parsing and the install-source validator.
 * The fixture below mirrors the real `pi list` output (verified against the
 * installed CLI), including the project section and a scoped package.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseInstalledPackages,
  parseAuthStatus,
  isSafePackageSource,
} = require("../dist/main/pi-cli.js");

const REAL_LIST = `User packages:
  npm:pi-opencode-go-cache
    C:\\Users\\me\\.pi\\agent\\npm\\node_modules\\pi-opencode-go-cache
  npm:@narumitw/pi-statusline
    C:\\Users\\me\\.pi\\agent\\npm\\node_modules\\@narumitw\\pi-statusline
  npm:pi-mcp-adapter
    C:\\Users\\me\\.pi\\agent\\npm\\node_modules\\pi-mcp-adapter
Project packages:
  npm:local-helper
    E:\\work\\proj\\.pi\\npm\\node_modules\\local-helper
`;

test("parses user and project packages with their install paths", () => {
  const pkgs = parseInstalledPackages(REAL_LIST);
  assert.equal(pkgs.length, 4);
  assert.deepEqual(
    pkgs.map((p) => p.source),
    [
      "npm:pi-opencode-go-cache",
      "npm:@narumitw/pi-statusline",
      "npm:pi-mcp-adapter",
      "npm:local-helper",
    ],
  );
  assert.equal(pkgs[0].scope, "user");
  assert.equal(pkgs[3].scope, "project");
  assert.match(pkgs[1].path, /@narumitw\\pi-statusline$/);
  assert.ok(
    pkgs.every((p) => p.path.length > 0),
    "every entry must carry a path",
  );
});

test("tolerates CRLF, blank lines, notices and an empty list", () => {
  assert.equal(parseInstalledPackages(REAL_LIST.replace(/\n/g, "\r\n")).length, 4);
  assert.deepEqual(parseInstalledPackages(""), []);
  assert.deepEqual(parseInstalledPackages("User packages:\n"), []);
  // unindented chatter must never turn into a package entry
  assert.deepEqual(parseInstalledPackages("no packages here"), []);
  assert.deepEqual(parseInstalledPackages("User packages:\nno packages installed"), []);
});

test("parses the auth check JSON line", () => {
  const ready = parseAuthStatus('{"status":"ready","provider":"google"}');
  assert.deepEqual(ready, { provider: "google", status: "ready", reason: undefined });
  const notReady = parseAuthStatus(
    '{"status":"not_ready","provider":"google","reason":"credentials_not_configured"}',
  );
  assert.equal(notReady.status, "not_ready");
  assert.equal(notReady.reason, "credentials_not_configured");
  assert.equal(parseAuthStatus("no json here"), null);
  assert.equal(parseAuthStatus('{"provider":"x"}'), null); // status missing
});

test("accepts the documented source forms", () => {
  for (const source of [
    "npm:@scope/pkg",
    "npm:pkg",
    "git:github.com/user/repo",
    "https://github.com/user/repo",
    "ssh://git@github.com/user/repo",
    "./local/path",
    "../sibling",
    "pi-mcp-adapter",
  ]) {
    assert.equal(isSafePackageSource(source), true, `${source} should be accepted`);
  }
});

test("rejects sources that could turn into flags or shell noise", () => {
  for (const source of [
    "",
    "   ",
    "-rf",
    "--global",
    "npm:pkg; rm -rf /",
    "npm:pkg && echo pwned",
    "npm:pkg|cat /etc/passwd",
    "`whoami`",
    "$(whoami)",
    "npm:pkg name",
    "npm:pkg\nrm -rf /",
    "a".repeat(500),
  ]) {
    assert.equal(isSafePackageSource(source), false, `${JSON.stringify(source)} must be rejected`);
  }
});
