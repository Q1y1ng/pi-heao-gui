/**
 * The permission gate's decision, tested without a pi session.
 *
 * The extension itself (`studio/bridge/permission-gate.ts`) only exists inside a pi
 * process, so the decision lives in `studio/bridge/permission-policy.mjs` — plain ESM,
 * no pi, no Electron, importable from here. What is worth pinning is exactly what the
 * audit found missing: that an *empty* pattern list is distinguishable from a *shipped*
 * one, and that a write leaving the working directory is a question rather than a
 * silent write.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const policyUrl = require("node:url").pathToFileURL(
  path.join(__dirname, "..", "studio", "bridge", "permission-policy.mjs"),
).href;

let policy;

test("policy module loads", async () => {
  policy = await import(policyUrl);
  assert.equal(typeof policy.decideToolCall, "function");
});

async function load() {
  if (!policy) policy = await import(policyUrl);
  return policy;
}

function decide(event, options = {}) {
  return policy.decideToolCall(event, {
    mode: options.mode ?? policy.ASK_MODE,
    regexes: options.patterns ? policy.compilePatterns(options.patterns).regexes : [],
    cwd: options.cwd ?? path.resolve("C:/work/repo"),
    realpath: options.realpath,
  });
}

test("env parsing: a malformed blob cannot silently turn the gate off", async () => {
  await load();
  assert.equal(policy.parsePermissionEnv("not json").mode, "AskForApproval");
  assert.deepEqual(policy.parsePermissionEnv("not json").patterns, []);
  assert.equal(policy.parsePermissionEnv('{"mode":"root"}').mode, "AskForApproval");
  assert.equal(policy.parsePermissionEnv('{"mode":"FullAccess"}').mode, "FullAccess");
  assert.deepEqual(policy.parsePermissionEnv('{"patterns":["a",1,null,"b"]}').patterns, ["a", "b"]);
  assert.deepEqual(policy.parsePermissionEnv(undefined).patterns, []);
});

test("compilePatterns reports what it dropped instead of dropping it silently", async () => {
  await load();
  const { regexes, invalid } = policy.compilePatterns(["\\brm\\b", "[unclosed", "("]);
  assert.equal(regexes.length, 1);
  assert.deepEqual(invalid, ["[unclosed", "("]);
  assert.equal(regexes[0].flags.includes("i"), true, "commands are matched case-insensitively");
});

test("bash: a matching command asks, a clean one does not", async () => {
  await load();
  const patterns = ["\\brm\\s+-rf\\b", "\\bsudo\\b"];

  const dangerous = decide({ toolName: "bash", input: { command: "rm -rf build" } }, { patterns });
  assert.equal(dangerous.kind, "ask");
  assert.match(dangerous.title, /rm -rf build/, "the person sees the command");
  assert.match(dangerous.title, /rm\\s\+-rf/, "and which rule matched");

  assert.equal(
    decide({ toolName: "bash", input: { command: "npm test" } }, { patterns }).kind,
    "allow",
  );
  assert.equal(decide({ toolName: "bash", input: {} }, { patterns }).kind, "allow");
  // No patterns at all = the shipped-list-missing case. It still allows, but the
  // /permission status line is what says so out loud (see the extension).
  assert.equal(decide({ toolName: "bash", input: { command: "rm -rf /" } }, {}).kind, "allow");
});

test("FullAccess allows everything, both shapes", async () => {
  await load();
  assert.equal(
    decide(
      { toolName: "bash", input: { command: "rm -rf /" } },
      { mode: "FullAccess", patterns: ["rm"] },
    ).kind,
    "allow",
  );
  assert.equal(
    decide({ toolName: "write", input: { path: "C:/elsewhere/file.txt" } }, { mode: "FullAccess" })
      .kind,
    "allow",
  );
});

test("write/edit inside the working directory stays automatic", async () => {
  await load();
  const cwd = path.resolve("C:/work/repo");
  for (const toolName of ["write", "edit"]) {
    assert.equal(decide({ toolName, input: { path: "src/a.ts" } }, { cwd }).kind, "allow");
    assert.equal(
      decide({ toolName, input: { path: path.join(cwd, "src", "a.ts") } }, { cwd }).kind,
      "allow",
    );
    assert.equal(decide({ toolName, input: { path: "." } }, { cwd }).kind, "allow");
  }
  // Another tool's path argument is not this rule's business.
  assert.equal(
    decide({ toolName: "read", input: { path: "C:/Windows/win.ini" } }, { cwd }).kind,
    "allow",
  );
});

test("write/edit outside the working directory asks, with the resolved path", async () => {
  await load();
  const cwd = path.resolve("C:/work/repo");
  const outside = decide({ toolName: "write", input: { path: "C:/Users/me/.bashrc" } }, { cwd });
  assert.equal(outside.kind, "ask");
  assert.match(outside.title, /\.bashrc/);
  assert.equal(outside.detail, path.resolve("C:/Users/me/.bashrc"));

  // `..` is resolved, not string-matched: a path that reads as "inside" and is not
  // is the whole reason this rule exists.
  assert.equal(
    decide({ toolName: "edit", input: { path: "../sibling/file.ts" } }, { cwd }).kind,
    "ask",
  );
  assert.equal(
    decide({ toolName: "edit", input: { path: "sub/../../outside.ts" } }, { cwd }).kind,
    "ask",
  );
  assert.equal(
    decide({ toolName: "edit", input: { path: "~/.pi/agent/settings.json" } }, { cwd }).kind,
    "allow",
  );
  // `~` is not expanded here, and must not be: pi hands these tools a real path, so a
  // literal "~" is a directory named "~" inside the workspace, not the home directory.
  // A path argument under another name is still the target.
  assert.equal(
    decide({ toolName: "write", input: { file_path: "C:/temp/x" } }, { cwd }).kind,
    "ask",
  );
});

test("a junction inside the workspace is not 'inside' once real paths are compared", async () => {
  await load();
  const cwd = "C:\\work\\repo";
  const link = path.resolve("C:\\work\\repo\\link");
  const target = "C:\\Users\\me\\.pi\\agent";
  // What fs.realpathSync.native does for a junction: the link and everything under it
  // resolve elsewhere. Windows needs no privileges to create one.
  const realpath = (p) => {
    const resolved = path.resolve(p);
    if (resolved === link) return target;
    if (resolved.startsWith(link + path.sep)) return target + resolved.slice(link.length);
    return p;
  };
  const decision = decide(
    { toolName: "write", input: { path: "link/settings.json" } },
    { cwd, realpath },
  );
  assert.equal(decision.kind, "ask");
  assert.match(decision.title, /agent/);

  // …and without a realpath to check, the textual answer is the one it gives: this rule
  // is a prompt, not the last line of defence (the host's fs guard is that).
  assert.equal(
    decide({ toolName: "write", input: { path: "link/settings.json" } }, { cwd }).kind,
    "allow",
  );
});

test("isInsideWorkspace: siblings and prefixes are not containment", async () => {
  await load();
  const cwd = path.resolve("C:/work/repo");
  assert.equal(policy.isInsideWorkspace(cwd, cwd), true);
  assert.equal(policy.isInsideWorkspace(cwd, "a/b"), true);
  // "repo-old" starts with "repo" and is a different directory.
  assert.equal(policy.isInsideWorkspace(cwd, path.resolve("C:/work/repo-old/x")), false);
  assert.equal(policy.isInsideWorkspace(cwd, ".."), false);
  assert.equal(policy.isInsideWorkspace(cwd, ""), false);
  assert.equal(policy.isInsideWorkspace("", "a"), false);
});

test("tools the gate knows nothing about are left alone", async () => {
  await load();
  assert.equal(decide({ toolName: "subagent", input: {} }).kind, "allow");
  assert.equal(decide({ toolName: "", input: {} }).kind, "allow");
  assert.equal(decide({}, {}).kind, "allow");
});
