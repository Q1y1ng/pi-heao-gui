/**
 * The update state machine, driven by hand through a fake autoUpdater.
 *
 * The controller takes its updater as a dependency precisely so this can be
 * tested without a packaged app, a network, or an update server — and so the
 * failure modes (a throwing check, a source checkout, installing too early) are
 * covered rather than hoped for.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createUpdateController } = require(
  path.join(__dirname, "..", "dist", "main", "updater.js"),
);

function fakeUpdater() {
  const handlers = new Map();
  const calls = { check: 0, install: 0 };
  return {
    autoDownload: false,
    calls,
    on(event, fn) {
      handlers.set(event, fn);
    },
    async checkForUpdates() {
      calls.check++;
    },
    quitAndInstall() {
      calls.install++;
    },
    emit(event, arg) {
      const fn = handlers.get(event);
      assert.ok(fn, `no handler registered for ${event}`);
      fn(arg);
    },
  };
}

const make = (overrides = {}) => {
  const updater = fakeUpdater();
  const statuses = [];
  const controller = createUpdateController({
    updater,
    currentVersion: "1.0.0",
    isPackaged: true,
    onStatus: (s) => statuses.push(s),
    logWarn: () => {},
    ...overrides,
  });
  return { updater, statuses, controller };
};

test("a packaged build reports checking, then no update", async () => {
  const { updater, controller } = make();
  controller.init();
  const pending = controller.check();
  assert.equal(controller.status().state, "checking");
  updater.emit("update-not-available");
  await pending;
  assert.deepEqual(controller.status(), { state: "none", current: "1.0.0" });
  assert.equal(updater.calls.check, 1);
});

test("an available update downloads and becomes ready", async () => {
  const { updater, controller } = make();
  controller.init();
  const pending = controller.check();
  updater.emit("update-available", { version: "1.1.0" });
  assert.equal(controller.status().state, "available");
  updater.emit("download-progress", { percent: 42.6 });
  assert.deepEqual(controller.status(), { state: "downloading", percent: 43, version: "1.1.0" });
  updater.emit("update-downloaded", { version: "1.1.0" });
  await pending;
  assert.deepEqual(controller.status(), { state: "ready", version: "1.1.0" });

  assert.deepEqual(controller.install(), { ok: true });
  assert.equal(updater.calls.install, 1);
});

test("the download percentage stays inside 0..100", () => {
  const { updater, controller } = make();
  controller.init();
  updater.emit("download-progress", { percent: -5 });
  assert.equal(controller.status().percent, 0);
  updater.emit("download-progress", { percent: 250 });
  assert.equal(controller.status().percent, 100);
});

test("a source checkout never checks and says why", async () => {
  const { updater, controller } = make({ isPackaged: false });
  controller.init();
  const status = await controller.check();
  assert.equal(status.state, "unavailable");
  assert.match(status.reason, /源码/);
  assert.equal(updater.calls.check, 0, "a checkout must not hit the update server");
});

test("a throwing check becomes an error status instead of crashing", async () => {
  const { updater, controller } = make();
  updater.checkForUpdates = async () => {
    throw new Error("network down");
  };
  controller.init();
  const status = await controller.check();
  assert.equal(status.state, "error");
  assert.match(status.message, /network down/);
});

test("the error event is surfaced too", () => {
  const { updater, controller } = make();
  controller.init();
  updater.emit("error", new Error("bad signature"));
  assert.deepEqual(controller.status(), { state: "error", message: "bad signature" });
});

test("installing is refused until an update is ready", () => {
  const { updater, controller } = make();
  controller.init();
  const res = controller.install();
  assert.equal(res.ok, false);
  assert.match(res.error, /下载完成/);
  assert.equal(updater.calls.install, 0);
});

test("concurrent checks are collapsed into one request", async () => {
  const { updater, controller } = make();
  let release;
  updater.checkForUpdates = () => {
    updater.calls.check++;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  controller.init();
  const first = controller.check();
  const second = controller.check();
  assert.equal(updater.calls.check, 1);
  release();
  await Promise.all([first, second]);
});

test("a status listener that throws does not break the update flow", () => {
  const updater = fakeUpdater();
  const controller = createUpdateController({
    updater,
    currentVersion: "1.0.0",
    isPackaged: true,
    logWarn: () => {},
    onStatus: () => {
      throw new Error("listener is broken");
    },
  });
  controller.init();
  updater.emit("update-available", { version: "1.1.0" });
  assert.equal(controller.status().state, "available");
});

test("autoDownload follows the caller's choice", () => {
  const updater = fakeUpdater();
  const controller = createUpdateController({
    updater,
    currentVersion: "1.0.0",
    isPackaged: true,
    autoDownload: false,
    logWarn: () => {},
  });
  controller.init();
  assert.equal(updater.autoDownload, false);
});

test("a portable build is told to download, not offered the installer", () => {
  // The portable target shares the installer's release channel: latest.yml lists the NSIS setup
  // program, so the updater must not even ask — downloading it would leave a second, installed
  // copy behind instead of replacing the file being run.
  const updater = fakeUpdater();
  const controller = createUpdateController({
    updater,
    currentVersion: "1.0.0",
    isPackaged: true,
    isPortable: true,
    logWarn: () => {},
  });
  controller.init();
  assert.equal(controller.status().state, "unavailable");
  assert.match(controller.status().reason, /便携版/);
  assert.equal(
    updater.calls.check,
    0,
    "the updater was never even asked — nothing was downloaded",
  );
  return controller.check({ manual: true }).then((status) => {
    assert.equal(status.state, "unavailable");
    assert.equal(updater.calls.check, 0, "a manual check is refused too");
    const install = controller.install();
    assert.equal(install.ok, false);
    assert.match(install.error, /便携版/);
    assert.equal(updater.calls.install, 0);
  });
});
