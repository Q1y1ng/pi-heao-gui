/**
 * The pending-decision list.
 *
 * Two things are worth pinning here. The list itself is what every window's panel shows, so it has to
 * be right about *who* is still waiting — an entry that outlives its window is a person being sent to
 * a window that is not there any more. And `describeRequest` reads pi's wire, where any field can be
 * missing or of the wrong type, so a malformed request has to degrade into a readable line instead of
 * taking the panel (and the window's chrome with it) down.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createDecisionQueue, describeRequest, DECISION_MESSAGE_CHARS, MAX_PENDING_DECISIONS } =
  require(path.join(__dirname, "..", "dist", "main", "decisions.js"));

function entry(overrides = {}) {
  return {
    id: "req-1",
    windowId: 1,
    method: "confirm",
    title: "需要确认",
    askedAt: 1000,
    ...overrides,
  };
}

test("a request is described by its own title", () => {
  const described = describeRequest({
    method: "select",
    title: "Dangerous Command: rm -rf",
    message: "This will delete files.",
  });
  assert.equal(described.method, "select");
  assert.equal(described.title, "Dangerous Command: rm -rf");
  assert.equal(described.message, "This will delete files.");
});

test("a request without a title falls back to what it asks for", () => {
  assert.equal(describeRequest({ method: "confirm" }).title, "需要确认");
  assert.equal(describeRequest({ method: "select" }).title, "需要选择");
  assert.equal(describeRequest({ method: "input" }).title, "需要输入");
  assert.equal(describeRequest({ method: "editor" }).title, "需要输入");
  assert.equal(describeRequest({ method: "something-new" }).title, "需要处理");
});

test("a request that only carries a message says the message", () => {
  // The list has to say what is being asked, not merely which method asked it.
  const described = describeRequest({ method: "input", message: "Which branch should I use?" });
  assert.equal(described.title, "Which branch should I use?");
  assert.equal(described.message, undefined, "it is already the title");
});

test("a long message is clipped", () => {
  const long = "x".repeat(DECISION_MESSAGE_CHARS + 250);
  const described = describeRequest({ method: "confirm", title: "t", message: long });
  assert.equal(described.message.length, DECISION_MESSAGE_CHARS);
});

test("junk on the wire does not throw", () => {
  for (const junk of [null, undefined, 42, "confirm", [], { method: 7, title: {}, message: [] }]) {
    const described = describeRequest(junk);
    assert.equal(typeof described.title, "string");
    assert.equal(typeof described.method, "string");
    assert.ok(described.title.length > 0, `no title for ${JSON.stringify(junk)}`);
  }
});

test("an entry is listed once and replaced in place", () => {
  const queue = createDecisionQueue();
  queue.add(entry({ id: "a", askedAt: 1 }));
  queue.add(entry({ id: "b", askedAt: 2 }));
  assert.deepEqual(
    queue.list().map((d) => d.id),
    ["a", "b"],
    "oldest first",
  );
  queue.add(entry({ id: "a", title: "换了个说法", askedAt: 3 }));
  assert.deepEqual(
    queue.list().map((d) => d.id),
    ["b", "a"],
    "the same request is not listed twice, and it moves to the end",
  );
  assert.equal(queue.list()[1].title, "换了个说法", "the newer text wins");
});

test("an entry with no id is not a decision", () => {
  const queue = createDecisionQueue();
  queue.add(entry({ id: "" }));
  assert.deepEqual(queue.list(), []);
});

test("answering removes exactly that request", () => {
  const queue = createDecisionQueue();
  queue.add(entry({ id: "a", windowId: 1 }));
  queue.add(entry({ id: "b", windowId: 1 }));
  queue.add(entry({ id: "a", windowId: 2 }));
  queue.resolve(1, "a");
  assert.deepEqual(
    queue.list().map((d) => `${d.windowId}:${d.id}`),
    ["1:b", "2:a"],
    "the same request id in another window is a different decision",
  );
  queue.resolve(1, "not-there");
  assert.equal(queue.list().length, 2, "resolving something unknown changes nothing");
});

test("a window that goes away takes its own entries and no others", () => {
  const queue = createDecisionQueue();
  queue.add(entry({ id: "a", windowId: 1 }));
  queue.add(entry({ id: "b", windowId: 2 }));
  queue.add(entry({ id: "c", windowId: 1 }));
  queue.dropWindow(1);
  assert.deepEqual(
    queue.list().map((d) => d.id),
    ["b"],
  );
  queue.dropWindow(99);
  assert.equal(queue.list().length, 1, "dropping an unknown window changes nothing");
});

test("listeners hear every change, and stop when they unsubscribe", () => {
  const queue = createDecisionQueue();
  let calls = 0;
  const off = queue.onChange(() => calls++);
  queue.add(entry({ id: "a" }));
  assert.equal(calls, 1);
  queue.add(entry({ id: "a" }));
  assert.equal(calls, 2, "a replacement is a change");
  queue.resolve(1, "a");
  assert.equal(calls, 3);
  queue.resolve(1, "a");
  assert.equal(calls, 3, "nothing changed, so nothing was announced");
  off();
  queue.add(entry({ id: "b" }));
  assert.equal(calls, 3);
});

test("the list is bounded, oldest first out", () => {
  const queue = createDecisionQueue({ max: 3 });
  for (const id of ["a", "b", "c", "d"]) queue.add(entry({ id }));
  assert.deepEqual(
    queue.list().map((d) => d.id),
    ["b", "c", "d"],
    "a loop that keeps asking cannot grow the list without limit",
  );
  assert.equal(MAX_PENDING_DECISIONS, 50, "the default cap is the documented one");
});

test("stats count entries and the windows behind them", () => {
  const queue = createDecisionQueue();
  assert.deepEqual(queue.stats(), { pending: 0, windows: 0 });
  queue.add(entry({ id: "a", windowId: 1 }));
  queue.add(entry({ id: "b", windowId: 1 }));
  queue.add(entry({ id: "c", windowId: 2 }));
  assert.deepEqual(queue.stats(), { pending: 3, windows: 2 });
});
