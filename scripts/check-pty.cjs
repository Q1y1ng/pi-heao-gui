/**
 * Does the terminal actually work under Electron?
 *
 * `npm run smoke` boots a real window but never spawns a PTY (it has no terminal
 * references at all), and `check-package.cjs` only asserts that node-pty's files
 * are *present* in the asar. So the whole terminal stack — the native module
 * loading under Electron's ABI, ConPTY starting, a line of output coming back —
 * was covered by nothing in CI: a broken prebuild shipped as "the dock is blank".
 *
 * Run with:  npm run check:pty
 *
 * Exits 0 when a PTY spawned, echoed and exited cleanly; non-zero with the reason
 * otherwise. Never waits longer than the hard timeout.
 */
const { app } = require("electron");

if ("ELECTRON_RUN_AS_NODE" in process.env) {
  console.error("ELECTRON_RUN_AS_NODE is set: this must run under Electron, not plain Node.");
  process.exit(3);
}

const HARD_TIMEOUT_MS = 30_000;
const MARKER = "pi-pty-ok";

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
}

const hardTimeout = setTimeout(() => {
  console.error(`FAIL  terminal did not answer within ${HARD_TIMEOUT_MS} ms`);
  // Not `app.exit(1)` straight away: if a PTY was spawned, the ConPTY teardown wants a moment (see
  // the note in finish()). The forced exit below is what guarantees the code CI reads.
  app.quit();
  setTimeout(() => app.exit(1), 1500);
}, HARD_TIMEOUT_MS);

app.whenReady().then(() => {
  let pty;
  try {
    // The same load the app does (src/main/terminal.ts): resolved the same way, in the same
    // runtime, so an ABI or prebuild problem fails here instead of in a user's dock.
    pty = require("node-pty");
  } catch (e) {
    fail(`node-pty did not load under Electron ${process.versions.electron}: ${e?.message}`);
    clearTimeout(hardTimeout);
    app.exit(1);
    return;
  }
  if (typeof pty?.spawn !== "function") {
    fail("node-pty loaded but exposes no spawn()");
    clearTimeout(hardTimeout);
    app.exit(1);
    return;
  }

  const win = process.platform === "win32";
  const shell = win ? process.env.COMSPEC || "cmd.exe" : "/bin/sh";
  let proc;
  try {
    proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.env.TEMP || process.cwd(),
      env: process.env,
    });
  } catch (e) {
    fail(`pty.spawn failed: ${e?.message}`);
    clearTimeout(hardTimeout);
    app.exit(1);
    return;
  }

  let output = "";
  let answered = false;
  const finish = (ok, detail) => {
    if (answered) return;
    answered = true;
    clearTimeout(hardTimeout);
    if (ok) {
      console.log(`PASS  pty spawned (pid ${proc.pid}) and echoed "${MARKER}"`);
      console.log(`      shell: ${shell}  electron: ${process.versions.electron}`);
      // End the shell by asking it to, not by `proc.kill()`: node-pty's kill forks a helper to
      // enumerate the console's processes, and on this platform that helper dies
      // (`AttachConsole failed`) and takes this process's exit code with it — measured 127 from a
      // probe that kills and then exits, 0 from one where the shell exits on its own. The app still
      // calls kill() where it must (its own shutdown); a check that reports the wrong exit code is
      // a check that fails for the wrong reason.
      try {
        proc.write(win ? "exit\r\n" : "exit\n");
      } catch {
        /* nothing to end */
      }
      setTimeout(() => {
        app.quit();
        setTimeout(() => app.exit(0), 1500);
      }, 400);
      return;
    }
    fail(detail);
    // Same exit discipline as the other Electron scripts: never outlive the answer.
    app.quit();
    setTimeout(() => app.exit(1), 1500);
  };

  proc.onData((data) => {
    output += data;
    if (output.includes(MARKER)) finish(true);
  });
  proc.onExit(({ exitCode }) => {
    // The shell exiting before the echo is a failure worth reporting as itself.
    finish(output.includes(MARKER), `shell exited (code ${exitCode}) without echoing the marker`);
  });

  // `echo` is a builtin in both cmd.exe and sh, so this needs no PATH and no temp file.
  try {
    proc.write(win ? `echo ${MARKER}\r\n` : `echo ${MARKER}\n`);
  } catch (e) {
    finish(false, `writing to the pty failed: ${e?.message}`);
  }
});
