/**
 * Killing what a timed-out CLI run left behind.
 *
 * The fix under test is `killProcessTree` (rpc-client.ts) as used by `runPiCli` (pi-cli.ts): a
 * timed-out `pi install` used to signal only the process the app spawned. On Windows that process
 * is an npm `.cmd` — a `cmd.exe` shim — so the real `node`/`npm` grandchild kept running and kept
 * writing into the agent package prefix, which is exactly the half-removed tree that makes every
 * later start-up fail (docs/KNOWN-ISSUES.md).
 *
 * Driven through the real path: `test/fake-pi.cmd` (so `resolveSpawnTarget` does its shim work),
 * a fake pi that spawns a grandchild and hangs, and `runPiCli` with a short timeout.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runPiCli } = require("../dist/main/pi-cli.js");

const FAKE_PI = path.join(__dirname, "fake-pi.cmd");

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Windows reports a live-but-not-ours process as EPERM; "no such process" is the answer we want.
    return e && e.code === "EPERM";
  }
}

async function waitForGone(pid, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (!isAlive(pid)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

test(
  "runPiCli: a timed-out install takes its npm grandchild with it",
  { skip: process.platform !== "win32" ? "the taskkill path is Windows-only" : false },
  async () => {
    const log = path.join(os.tmpdir(), `pi-grandchild-${process.pid}-${Date.now()}.log`);
    const previous = {
      hang: process.env.PI_FAKE_HANG_MS,
      log: process.env.PI_FAKE_GRANDCHILD_LOG,
      fail: process.env.PI_FAKE_FAIL_TIMES,
    };
    // The fake reads these from the environment it inherits: runPiCli spawns with process.env.
    process.env.PI_FAKE_HANG_MS = "60000";
    process.env.PI_FAKE_GRANDCHILD_LOG = log;
    delete process.env.PI_FAKE_FAIL_TIMES;

    let grandchildPid = 0;
    try {
      const result = await runPiCli(FAKE_PI, ["install", "npm:some-package"], {
        timeoutMs: 1500,
      });
      assert.equal(result.timedOut, true, "the run was killed by the timeout");

      // The fake writes the pid before it hangs; give it a moment to land.
      for (let i = 0; i < 40 && !grandchildPid; i++) {
        await new Promise((r) => setTimeout(r, 100));
        grandchildPid = Number((fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "").trim());
      }
      assert.ok(grandchildPid > 0, "the fake started a grandchild to be killed");
      assert.equal(
        await waitForGone(grandchildPid, 5000),
        true,
        `grandchild ${grandchildPid} outlived the timeout kill`,
      );
    } finally {
      // A failing assertion must not leave a 60-second process behind.
      if (grandchildPid > 0 && isAlive(grandchildPid)) {
        try {
          process.kill(grandchildPid);
        } catch {
          /* already gone */
        }
      }
      for (const [key, value] of [
        ["PI_FAKE_HANG_MS", previous.hang],
        ["PI_FAKE_GRANDCHILD_LOG", previous.log],
        ["PI_FAKE_FAIL_TIMES", previous.fail],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      try {
        fs.rmSync(log, { force: true });
      } catch {
        /* best effort */
      }
    }
  },
);
