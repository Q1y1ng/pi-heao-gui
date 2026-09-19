#!/usr/bin/env node
/**
 * A stand-in for `pi --mode rpc`, for the session start-up tests.
 *
 * It exists to answer the two questions a unit test cannot: does a start-up that dies before it is
 * ready get retried exactly once, and does a second start-up wait for the first to finish? Both need
 * the real spawn path (`resolveSpawnTarget`, the RPC client, the spawn queue) without a real pi.
 *
 * Environment:
 *   PI_FAKE_LOG        file to append what happened to (one line per event)
 *   PI_FAKE_FAIL_TIMES exit 1 before printing anything, while fewer than this many failures are on
 *                      record (simulates a start-up that keeps failing)
 *   PI_FAKE_STARTUP_MS how long to stay quiet before reporting ready (simulates the install window)
 */
const fs = require("node:fs");
const readline = require("node:readline");

const logPath = process.env.PI_FAKE_LOG || "";
const record = (event) => {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `${event} ${Date.now()}\n`);
  } catch {
    /* the test will notice the missing evidence */
  }
};

const attempts = () => {
  try {
    return fs
      .readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("fail ")).length;
  } catch {
    return 0;
  }
};

record("spawn");
const failTimes = Number(process.env.PI_FAKE_FAIL_TIMES || 0);
if (attempts() < failTimes) {
  process.stderr.write("fake pi: simulated start-up failure\n");
  record("fail");
  process.exit(1);
}

const sessionArg = (() => {
  const i = process.argv.indexOf("--session");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

const readyAfter = Number(process.env.PI_FAKE_STARTUP_MS || 0);
setTimeout(() => {
  // What pi really emits first: an extension event, unprompted, after its start-up work.
  process.stdout.write(
    `${JSON.stringify({
      type: "extension_ui_request",
      id: "fake-ready",
      method: "setStatus",
      statusKey: "fake-pi",
    })}\n`,
  );
  record("ready");
  // Reading stdin only now is also what pi does: it does not look at a request until its start-up
  // work is behind it (measured — a request written at +1.0 s was answered at +70.9 s, after the
  // last `npm install`). A fake that answered earlier would look ready before it had "installed",
  // and the queue test would pass for the wrong reason.
  readCommands();
}, readyAfter);

function readCommands() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      return;
    }
    const data = {
      sessionFile: sessionArg,
      sessionName: "fake session",
      isStreaming: false,
      messages: [],
      commands: [],
      models: [],
      thinkingLevels: [],
    };
    process.stdout.write(
      `${JSON.stringify({
        id: command.id,
        type: "response",
        command: command.type,
        success: true,
        data,
      })}\n`,
    );
  });
  rl.on("close", () => process.exit(0));
}
