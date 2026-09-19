/**
 * One pi start-up at a time, per profile.
 *
 * The queue exists because two pi children installing the agent packages from settings into one
 * prefix lose the race on Windows, and the loser can leave the prefix half-removed — after which
 * every start fails the same way. These tests pin the two shapes that matter: a start-up that
 * reports ready lets the next one through, and one that never reports ready cannot wedge the queue.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createSpawnQueue, profileKey } = require(
  path.join(__dirname, "..", "dist", "main", "spawn-queue.js"),
);

/** Deterministic clock: tests advance it by hand. */
function fakeClock() {
  let time = 0;
  const timers = new Set();
  return {
    now: () => time,
    setTimer(fn, ms) {
      const timer = { fn, at: time + ms };
      timers.add(timer);
      return {
        cancel: () => timers.delete(timer),
      };
    },
    /** Fire every timer that is due at or before `time + ms`. */
    advance(ms) {
      time += ms;
      for (const timer of [...timers]) {
        if (timer.at <= time) {
          timers.delete(timer);
          timer.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

/** Records whether a promise has settled, without awaiting it. */
function watch() {
  const state = { settled: false };
  return {
    state,
    attach(promise) {
      promise.then(() => {
        state.settled = true;
      });
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the first caller starts immediately", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  let started = false;
  await queue.acquire("home").then(() => {
    started = true;
  });
  assert.equal(started, true);
  assert.deepEqual(queue.stats(), [{ key: "home", waiting: 0, watching: 0, holding: true }]);
  assert.equal(clock.pending(), 1, "the holder gets a safety timer");
});

test("a second caller waits until the first reports ready", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  await queue.acquire("home");
  const second = watch();
  second.attach(queue.acquire("home"));
  await tick();
  assert.equal(second.state.settled, false, "second start-up must not run yet");
  assert.deepEqual(queue.stats(), [{ key: "home", waiting: 1, watching: 0, holding: true }]);

  queue.release("home");
  await tick();
  assert.equal(second.state.settled, true);
  assert.deepEqual(queue.stats(), [{ key: "home", waiting: 0, watching: 0, holding: true }]);
});

test("callers queue in the order they arrived", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  await queue.acquire("home");
  const order = [];
  for (const name of ["b", "c", "d"]) {
    queue.acquire("home").then(() => order.push(name));
  }
  for (let i = 0; i < 3; i++) {
    queue.release("home");
    await tick();
  }
  assert.deepEqual(order, ["b", "c", "d"]);
});

test("a start-up that never reports ready cannot wedge the queue", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer, maxHoldMs: 30_000 });
  await queue.acquire("home");
  const second = watch();
  second.attach(queue.acquire("home"));
  await tick();
  assert.equal(second.state.settled, false);

  clock.advance(29_999);
  await tick();
  assert.equal(second.state.settled, false, "still inside the ceiling");
  clock.advance(1);
  await tick();
  assert.equal(second.state.settled, true, "the ceiling lets the next start-up through");
});

test("the ceiling is measured from when the holder was let through", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer, maxHoldMs: 1000 });
  await queue.acquire("home");
  clock.advance(900);
  queue.release("home"); // first holder is done before the ceiling
  await tick();
  const second = watch();
  second.attach(queue.acquire("home"));
  await tick();
  clock.advance(999);
  await tick();
  assert.equal(second.state.settled, true, "the second caller gets its own full window");
});

test("release from a caller that is not holding is ignored", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  queue.release("home");
  assert.deepEqual(queue.stats(), []);
  await queue.acquire("home");
  queue.release("home");
  queue.release("home"); // second release must not release somebody else
  assert.deepEqual(queue.stats(), []);
});

test("profiles do not wait for each other", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  await queue.acquire("profile-a");
  const other = watch();
  other.attach(queue.acquire("profile-b"));
  await tick();
  assert.equal(other.state.settled, true, "a different prefix installs in a different place");
});

test("whenIdle resolves at once when nobody is starting pi", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  const idle = watch();
  idle.attach(queue.whenIdle("home"));
  await tick();
  assert.equal(idle.state.settled, true);
  assert.deepEqual(queue.stats(), [], "an idle call leaves nothing behind");
});

test("whenIdle waits for the holder and never takes the turn", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  await queue.acquire("home");
  const watcher = watch();
  watcher.attach(queue.whenIdle("home"));
  const queued = watch();
  queued.attach(queue.acquire("home"));
  await tick();
  assert.equal(watcher.state.settled, false);
  assert.equal(queued.state.settled, false);

  queue.release("home");
  await tick();
  assert.equal(watcher.state.settled, true, "the watcher is told the queue is clear");
  assert.equal(queued.state.settled, true, "and the queued start-up still gets the turn");
  assert.deepEqual(queue.stats(), [{ key: "home", waiting: 0, watching: 0, holding: true }]);
  assert.equal(clock.pending(), 1, "only the new holder has a timer");
});

test("the queue forgets a key once nobody holds or wants it", async () => {
  const clock = fakeClock();
  const queue = createSpawnQueue({ now: clock.now, setTimer: clock.setTimer });
  await queue.acquire("home");
  const watcher = watch();
  watcher.attach(queue.whenIdle("home"));
  queue.release("home");
  await tick();
  assert.deepEqual(queue.stats(), []);
  assert.equal(clock.pending(), 0, "the holder's timer was cancelled");
});

test("profileKey follows the environment the child gets", () => {
  assert.equal(profileKey({ USERPROFILE: "C:\\Users\\a" }), "C:\\Users\\a|default");
  assert.equal(profileKey({ HOME: "/home/a" }), "/home/a|default");
  assert.equal(
    profileKey({ HOME: "/home/a", PI_AGENT_DIR: "/custom/agent" }),
    "/custom/agent",
    "an explicit agent dir decides where the install goes",
  );
  assert.equal(profileKey({ PI_CONFIG_DIR: "/custom/config" }), "/custom/config");
  assert.equal(profileKey({}), "default");
  assert.equal(
    profileKey({ USERPROFILE: "C:\\Users\\a", PI_AGENT_DIR: "" }),
    "C:\\Users\\a|default",
  );
});
