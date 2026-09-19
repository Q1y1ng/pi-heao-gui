/**
 * The window board: what every window is doing.
 *
 * The registry is small on purpose — it holds what the app observed, and the only things worth
 * pinning are the ones that would show a person the wrong picture: a row that outlives its window, a
 * row that says "idle" while a turn is streaming, and the order (the window that needs a person comes
 * first, because a list is read top-down).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createWindowStatusBoard, stateOf } = require(
  path.join(__dirname, "..", "dist", "main", "window-status.js"),
);

test("a window that has never been seen gets a usable row", () => {
  const board = createWindowStatusBoard({ now: () => 1000 });
  board.update(7, {});
  const [row] = board.list();
  assert.equal(row.windowId, 7);
  assert.equal(row.label, "窗口 #7");
  assert.equal(row.running, false);
  assert.equal(row.waiting, 0);
  assert.equal(row.touchedAt, 1000);
});

test("a patch only announces itself when something actually changed", () => {
  const board = createWindowStatusBoard({ now: () => 1 });
  let calls = 0;
  board.onChange(() => calls++);
  board.update(1, { running: true });
  assert.equal(calls, 1);
  board.update(1, { running: true });
  assert.equal(calls, 1, "the same value twice is not news");
  board.update(1, { running: false });
  assert.equal(calls, 2);
});

test("a window that is gone takes its row with it", () => {
  const board = createWindowStatusBoard();
  board.update(1, {});
  board.update(2, {});
  board.remove(1);
  assert.deepEqual(
    board.list().map((w) => w.windowId),
    [2],
  );
  board.remove(99);
  assert.equal(board.list().length, 1, "removing an unknown window changes nothing");
});

test("waiting beats running, and the freshest row comes first inside a group", () => {
  const board = createWindowStatusBoard();
  board.update(1, { label: "idle old", touchedAt: 10 });
  board.update(2, { label: "idle new", touchedAt: 30 });
  board.update(3, { label: "running", running: true, touchedAt: 20 });
  board.update(4, { label: "waiting", running: true, waiting: 2, touchedAt: 5 });
  assert.deepEqual(
    board.list().map((w) => w.label),
    ["waiting", "running", "idle new", "idle old"],
  );
});

test("the state a row is shown in follows the same order", () => {
  assert.equal(
    stateOf({ windowId: 1, label: "", running: true, waiting: 1, unread: 0, touchedAt: 0 }),
    "waiting",
  );
  assert.equal(
    stateOf({ windowId: 1, label: "", running: true, waiting: 0, unread: 0, touchedAt: 0 }),
    "running",
  );
  assert.equal(
    stateOf({ windowId: 1, label: "", running: false, waiting: 0, unread: 3, touchedAt: 0 }),
    "idle",
  );
});

test("a listener that unsubscribes stops hearing about changes", () => {
  const board = createWindowStatusBoard();
  let calls = 0;
  const off = board.onChange(() => calls++);
  board.update(1, { running: true });
  off();
  board.update(1, { running: false });
  assert.equal(calls, 1);
});
