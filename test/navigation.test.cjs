/**
 * Navigation guards: the decision, and the wiring, both without a window.
 *
 * These matter because the chat renders model output, and markdown-it turns a bare URL into a real
 * `<a href>`. A click that navigated a window would hand the remote origin `window.pi` — Electron
 * injects the preload into every navigation — and that bridge can write to the terminal.
 *
 * The pure half is asserted case by case; the wiring half is driven by hand through a fake
 * WebContents, the way the updater's tests drive their autoUpdater.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { classifyNavigation, installNavigationGuards } = require(
  path.join(__dirname, "..", "dist", "main", "navigation.js"),
);

const CHAT_PAGE = "file:///C:/Users/x/AppData/Local/Temp/pi-heao-chat-1234.html";

test("navigation: the page already on screen stays allowed", () => {
  assert.equal(classifyNavigation(CHAT_PAGE, CHAT_PAGE).action, "allow");
});

test("navigation: an in-page anchor is the same document, not a navigation away", () => {
  assert.equal(classifyNavigation(`${CHAT_PAGE}#messages`, CHAT_PAGE).action, "allow");
  assert.equal(classifyNavigation(CHAT_PAGE, `${CHAT_PAGE}#messages`).action, "allow");
});

test("navigation: about:blank is how a window starts life, and leaks nothing", () => {
  assert.equal(classifyNavigation("about:blank", "").action, "allow");
});

test("navigation: http, https and mailto leave for the OS browser", () => {
  for (const url of ["https://example.com/a", "http://example.com/", "mailto:heao@example.com"]) {
    const verdict = classifyNavigation(url, CHAT_PAGE);
    assert.equal(verdict.action, "open-external", url);
    assert.equal(verdict.url, url);
  }
});

test("navigation: the scheme check is case-insensitive", () => {
  assert.equal(classifyNavigation("HTTPS://example.com/", CHAT_PAGE).action, "open-external");
});

test("navigation: a file: link is refused and is not handed to the OS either", () => {
  // pi:open-file validates paths through checkOpenPath (no executables, no escaping the
  // workspace); passing a raw file: navigation to the shell would be a way around that.
  const verdict = classifyNavigation("file:///C:/Windows/System32/calc.exe", CHAT_PAGE);
  assert.equal(verdict.action, "deny");
  assert.equal(verdict.url, undefined);
});

test("navigation: other schemes stay out of the window", () => {
  for (const url of [
    "data:text/html,<script>1</script>",
    "javascript:alert(1)",
    "ms-settings:privacy",
    "vbscript:msgbox(1)",
    "chrome://settings",
  ]) {
    assert.equal(classifyNavigation(url, CHAT_PAGE).action, "deny", url);
  }
});

test("navigation: junk is denied rather than guessed at", () => {
  for (const url of ["", "   ", "not a url", "/tmp/relative.html", "\\\\server\\share\\x.html"]) {
    assert.equal(classifyNavigation(url, CHAT_PAGE).action, "deny", JSON.stringify(url));
  }
});

test("navigation: an unparseable current url falls back to the scheme rules", () => {
  // Then nothing is "the same document", so even our own page has to pass the scheme test.
  assert.equal(classifyNavigation(CHAT_PAGE, ":::").action, "deny");
  assert.equal(classifyNavigation("https://example.com/", ":::").action, "open-external");
});

/** A WebContents narrow enough to drive by hand. */
function fakeContents(currentUrl = CHAT_PAGE) {
  const listeners = [];
  const state = { windowOpenHandler: null, opened: [], prevented: 0, warned: [] };
  return {
    state,
    getURL: () => currentUrl,
    setURL: (u) => {
      currentUrl = u;
    },
    on(event, listener) {
      listeners.push({ event, listener });
    },
    setWindowOpenHandler(handler) {
      state.windowOpenHandler = handler;
    },
    /** Fire `will-navigate` the way Electron does, and report whether it was cancelled. */
    navigate(url) {
      const entry = listeners.find((l) => l.event === "will-navigate");
      assert.ok(entry, "no will-navigate listener registered");
      let prevented = false;
      entry.listener(
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        url,
      );
      if (prevented) state.prevented++;
      return prevented;
    },
  };
}

const install = (contents, overrides = {}) => {
  const opened = [];
  installNavigationGuards(contents, {
    openExternal: (url) => opened.push(url),
    logInfo: () => {},
    logWarn: (...args) => contents.state.warned.push(args.join(" ")),
    ...overrides,
  });
  return opened;
};

test("guards: an external navigation is cancelled and handed to the OS browser", () => {
  const contents = fakeContents();
  const opened = install(contents);

  assert.equal(contents.navigate("https://example.com/pwn"), true);
  assert.deepEqual(opened, ["https://example.com/pwn"]);
  assert.equal(contents.state.prevented, 1);
});

test("guards: reloading our own page is not cancelled", () => {
  const contents = fakeContents();
  const opened = install(contents);

  assert.equal(contents.navigate(CHAT_PAGE), false);
  assert.deepEqual(opened, []);
  assert.equal(contents.state.prevented, 0);
});

test("guards: a file: navigation is cancelled without reaching the shell", () => {
  const contents = fakeContents();
  const opened = install(contents);

  assert.equal(contents.navigate("file:///C:/Windows/System32/calc.exe"), true);
  assert.deepEqual(opened, [], "file: must not be handed to the OS");
  assert.match(contents.state.warned.join("\n"), /blocked/);
});

test("guards: window.open is always refused, and external urls still leave for the browser", () => {
  const contents = fakeContents();
  const opened = install(contents);

  const response = contents.state.windowOpenHandler({ url: "https://example.com/tab" });
  assert.deepEqual(response, { action: "deny" });
  assert.deepEqual(opened, ["https://example.com/tab"]);

  // Our own page is refused too: a second window is the app's decision to make, not a link's.
  const local = contents.state.windowOpenHandler({ url: CHAT_PAGE });
  assert.deepEqual(local, { action: "deny" });
  assert.deepEqual(opened, ["https://example.com/tab"]);
});

test("guards: a throwing openExternal does not break the cancellation", () => {
  const contents = fakeContents();
  install(contents, {
    openExternal: () => {
      throw new Error("no browser association");
    },
  });

  assert.equal(contents.navigate("https://example.com/pwn"), true);
  assert.match(contents.state.warned.join("\n"), /openExternal failed/);
});

test("guards: the window's current url is read per decision, not captured once", () => {
  const contents = fakeContents();
  const opened = install(contents);

  assert.equal(contents.navigate(CHAT_PAGE), false);
  contents.setURL("file:///C:/Users/x/AppData/Local/Temp/pi-heao-child-99.html");
  // The page it is on now is not the page it was on at install time, so the old url navigates away.
  assert.equal(contents.navigate(CHAT_PAGE), true);
  assert.deepEqual(opened, []);
});
