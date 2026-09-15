/**
 * Unit tests for the tray's unread indicator (dist/main/tray.js).
 *
 * It used to be one global counter, so a child window finishing while you read
 * another one bumped the same number — with several sessions open the badge
 * stopped meaning anything. It is per window now, and this is what pins that.
 *
 * The tray itself does nothing without an icon (refreshTrayMenu returns early
 * when there is none), so the module is safe to require outside Electron.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { bumpUnread, clearUnread, getUnreadCount } = require("../dist/main/tray.js");

test("tray unread: marks are per window and summed for the badge", () => {
  clearUnread();
  assert.equal(getUnreadCount(), 0);

  bumpUnread(1);
  bumpUnread(1);
  bumpUnread(2);
  assert.equal(getUnreadCount(), 3);

  // Focusing one window clears only that window's marks: the whole point.
  clearUnread(1);
  assert.equal(getUnreadCount(), 1);
});

test("tray unread: clearing an idle window leaves the others alone", () => {
  clearUnread();
  bumpUnread(3);
  clearUnread(99);
  assert.equal(getUnreadCount(), 1);

  // Clearing a window twice is not an error, and neither is clearing everything.
  clearUnread(3);
  clearUnread(3);
  assert.equal(getUnreadCount(), 0);

  bumpUnread(4);
  clearUnread();
  assert.equal(getUnreadCount(), 0);
});
