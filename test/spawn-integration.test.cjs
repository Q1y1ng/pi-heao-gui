/**
 * The two start-up behaviours a unit test cannot reach: the one retry, and the queue actually
 * serialising two start-ups.
 *
 * Both live in `createChatSession`/`createRpcClient` around a real spawned process, so these tests
 * drive that path with a fake pi (`test/fake-pi.cmd`, resolved through the app's own `.cmd` shim
 * handling) instead of a real one. `bridge-extract` is the only electron import in the chain and is
 * stubbed before anything else is required.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// Stub electron before the app modules load (only bridge-extract wants it, and only for a path).
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === "electron") {
    return { app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { createChatSession } = require(
  path.join(__dirname, "..", "dist", "main", "chat-session.js"),
);
const { getSpawnQueue } = require(path.join(__dirname, "..", "dist", "main", "spawn-queue.js"));

const FAKE_PI = path.join(__dirname, "fake-pi.cmd");
const REPO = path.join(__dirname, "..");

let tmpRoot;
test.beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-spawn-test-"));
});
test.afterEach(() => {
  // The sandbox is a plain temp directory of this process's own making.
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function config(env) {
  return {
    piPath: FAKE_PI,
    language: "en",
    env,
    args: [],
    disabledTools: [],
    permissionMode: "AskForApproval",
    dangerousPatterns: [],
    mcpEnabled: false,
    mcpIdleTimeout: 10,
    chatFontSize: 14,
    chatSendShortcut: "enter",
    chatMermaidTheme: "default",
    chatBackgroundImage: "",
    chatBackgroundOpacity: 0,
    rpcTrace: false,
    workspaceRoot: REPO,
    pinnedSessions: [],
    theme: "dark",
    accent: "#3b82f6",
    favoriteModels: [],
    budgetDailyUsd: 0,
    budgetMonthlyUsd: 0,
    openAtLogin: false,
    showArchived: false,
    restoreWindows: false,
    autoCheckUpdates: false,
    recentWorkspaces: [],
    uiLanguage: "en",
    lastOnboardedVersion: "",
    commitLanguage: "en",
    commitMessagePrompt: "",
    alerts: {},
  };
}

function events(logPath) {
  try {
    return fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ")[0]);
  } catch {
    return [];
  }
}

/** First timestamp logged for an event, or undefined. */
function at(logPath, event) {
  try {
    const line = fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${event} `));
    return line ? Number(line.split(" ")[1]) : undefined;
  } catch {
    return undefined;
  }
}

async function startSession(env, host = { postToRenderer: () => {} }) {
  return createChatSession({
    appPath: REPO,
    config: config(env),
    cwd: REPO,
    host,
  });
}

/** Wait until `predicate` holds, or the deadline passes. The retry runs behind the session. */
async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

test("a start-up that dies before it is ready is retried exactly once", async () => {
  const log = path.join(tmpRoot, "spawn.log");
  const agentDir = path.join(tmpRoot, "agent");
  const session = await startSession({
    PI_FAKE_LOG: log,
    PI_FAKE_FAIL_TIMES: "1",
    // Keep the queue key unique to this test so nothing else is holding it.
    PI_AGENT_DIR: agentDir,
  });
  // The session exists before the retry happens: the window must not wait for a start-up to be over.
  assert.ok(session, "the session is handed back as soon as pi is spawned");
  assert.ok(await waitUntil(() => events(log).includes("ready")), "the retry ran");
  assert.deepEqual(
    events(log),
    // `cwd` is the fake reporting where it was started (see test/fake-pi.cjs): one line per process.
    ["spawn", "cwd", "fail", "spawn", "cwd", "ready"],
    "one failure, then a start that works",
  );
  session.dispose();
  getSpawnQueue().release(agentDir);
});

test("a start-up that fails twice is reported, not retried forever", async () => {
  const log = path.join(tmpRoot, "spawn.log");
  const agentDir = path.join(tmpRoot, "agent");
  const posted = [];
  const session = await startSession(
    {
      PI_FAKE_LOG: log,
      PI_FAKE_FAIL_TIMES: "2",
      PI_AGENT_DIR: agentDir,
    },
    { postToRenderer: (msg) => posted.push(msg) },
  );
  assert.ok(
    await waitUntil(() => events(log).filter((e) => e === "fail").length === 2),
    "both attempts ran",
  );
  assert.deepEqual(
    events(log),
    ["spawn", "cwd", "fail", "spawn", "cwd", "fail"],
    "a second failure is the end of it",
  );
  // The session still exists, and the window is told why pi is not there: that is the shape a person
  // recovers from (reload, or send a message). A throw here would leave the window with no session
  // to recover in at all.
  assert.ok(session, "a failed start-up still leaves a session behind");
  assert.ok(
    await waitUntil(() => posted.some((m) => m.type === "error")),
    "the window is told why pi is not running",
  );
  session.dispose();
  getSpawnQueue().release(agentDir);
});

test("a second start-up waits for the first to report ready", async () => {
  const logA = path.join(tmpRoot, "a.log");
  const logB = path.join(tmpRoot, "b.log");
  const agentDir = path.join(tmpRoot, "agent");
  const first = await startSession({
    PI_FAKE_LOG: logA,
    PI_FAKE_STARTUP_MS: "1200",
    PI_AGENT_DIR: agentDir,
  });
  assert.ok(first);
  const second = await startSession({
    PI_FAKE_LOG: logB,
    PI_FAKE_STARTUP_MS: "0",
    PI_AGENT_DIR: agentDir,
  });
  assert.ok(second);

  // The child writes its own log line; give it the moment it takes to start.
  assert.ok(
    await waitUntil(() => events(logB).length >= 1),
    "the second start-up logged its spawn",
  );
  const firstReadyAt = at(logA, "ready");
  const secondSpawnAt = at(logB, "spawn");
  assert.notEqual(firstReadyAt, undefined, "the first start-up reported ready");
  assert.notEqual(secondSpawnAt, undefined, "the second start-up ran");
  // The evidence that the queue worked: the second pi was spawned only after the first was ready.
  assert.ok(
    secondSpawnAt >= firstReadyAt,
    `second start-up must wait for the first (ready ${firstReadyAt}, second spawn ${secondSpawnAt})`,
  );
  first.dispose();
  second.dispose();
  getSpawnQueue().release(agentDir);
});
