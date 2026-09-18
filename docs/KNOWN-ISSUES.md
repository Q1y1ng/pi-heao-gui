# Known issues

Open defects with their measured evidence, so the next person can continue instead of re-deriving.

---

## Our theme tokens are not visible in the sidebar's scope

**Measured in 1.2.3, while trying to fix the contrast finding on `.pi-btn-ghost`.**

- `--pi-text-dim` on the sidebar's ghost buttons measures **3:1** in the dark theme (against
  `rgb(20,23,28)`) — below the 4.5:1 the accessibility gate requires for text.
- Switching that one rule to `var(--pi-text)` measured **1.12:1 in the light theme and 1.1:1 in the
  dark one** — text and background effectively the same colour. A token that reads fine everywhere
  else does not resolve to a usable colour in this rule, so the value was left as it was.

This has the same shape as the font-size defect, and is worth treating as one question: **where do
our tokens stop being visible?** The font probe found `--pi-fs-md: 16px` at `:root` and all the way
down `#pi-shell → .pi-body → #pi-main`, so the chain is healthy for the chat — and yet a chrome rule
in the sidebar cannot use `--pi-text`. Answering that is likely to fix both.

## The isolated e2e suite is flaky in its window lookups

**Same code, different results: 97/0, then 88/2, then 95/2 — root-caused to a genuinely empty session
list.** The check asked `pi:list-sessions` in the sandbox and got `[]`: the sandbox is a throwaway
profile, and a cold pi child may not have written any session by that point. Asking once and polling
for 40 seconds failed identically, which is what rules out timing as the cause. The section now skips
with that reason instead of failing, so the checks after it no longer report a failure about
something they do not test.

The checks that move are *a session is available to open in its own window* and, as a consequence,
the contrast check that sees the error banner it puts on screen. The cause is which window the
section ends up talking to: a stripped child has no sidebar, and the settings window cannot answer
for the app. The lookup now asks for the main window structurally (`#pi-sidebar`), which is more
correct than matching a URL and falling back to "any window", but the failure still reproduces, so
the harness is what needs to be made deterministic. The app-level e2e (87/0, run twice) does not
move this way.

## The stripped child shell did not load the session — **fixed in 1.2.3**

**Status:** fixed · the root cause was found by measurement, after two code-reading guesses turned out wrong.

**Cause.** `preload.ts`'s `onMessage` is a **single** listener. The shim holds it and re-emits every
host message as a window `"message"` event — which is what the vendored chat app listens to. This
shell's own `MINIMAL_TITLE_SCRIPT` registered on that same channel, so it **replaced the shim** and
the app received nothing at all: the window opened with the correct title and an empty conversation,
and nothing logged an error. The title worked precisely because the script that took the channel was
the one reading `sessionInfo` from it. The title script now listens for the forwarded event, like the
app and every other chrome script.

**Ruled out by measurement — both were plausible from the code, both were wrong:** a missing global
or a thrown error (there were no console errors, the bridge reported ready, the re-parent had put the
app exactly where it belonged), and the host never pushing state (the host pushed the **same 16
messages** to both shells, `messages` and `sessionInfo` included).

**What decided it:** sampling the child's DOM over time — `#pi-main` stayed at 5470 bytes from 6 s to
26 s with every conversation selector at zero, i.e. the app never re-rendered — plus the preload's own
"single listener" note. The instrumentation is kept behind `PI_DEBUG_WINDOW=1` (child console, load
failures, DOM fingerprint, time series) and `PI_MINIMAL_CHILD=0` (compare against the full shell).

**Proof:** the e2e assertion *"the session window actually shows the conversation"* failed on the
stripped shell before the fix and passes after it (87/0), with the full shell still at 87/0.

> The original investigation is kept below, as the record of what was tried and ruled out.

`buildChatHtml(appPath, config, { minimal: true })` builds a shell with only a title bar and the chat
— no sidebar, no dock, no palette, no token chip. Wired into `openSessionWindow` in 1.2.1, it produced a
window that opened, carried the right title, and **showed no session at all**. Child windows went back to
the full shell in 1.2.2 (`main.ts`, `chatShellFile("full")`).

**Ruled out by measurement, not by taste:**

- **Layout / CSS.** The three skipped stylesheets (`STATS_CSS`, `PALETTE_CSS`, `DOCK_CSS`) were scanned
  for selectors touching the chat or the document at large — `body`, `html`, `:root`, `*`, `.app`,
  `.root`, `.messages`, `.msg`, `.composer`, `.toolbar`, `#app`, `#root`, `#input`: **zero hits**.
  `#pi-main`'s own layout lives in `CHROME_CSS`, which the stripped shell keeps.
- **The bootstrap signal.** The re-parent and paste-undo scripts are both kept, and the vendored UI still
  sends `webviewReady` on its own (`studio/pi-chat/src/main.ts:63`).

**Next step is measurement.** Add `SIDEBAR_SCRIPT`, `TITLEBAR_SCRIPT`, `TOKENS_SCRIPT`, `STATS_SCRIPT`,
`PALETTE_SCRIPT`, `DOCK_SCRIPT` back one at a time until the session appears — or log from each at load
and diff what actually runs. The pass/fail signal already exists: the e2e assertion *"the session window
actually shows the conversation"*, which was added because every earlier check passed while the window was
empty.

---

## The font-size setting does not resize chat text — **measured working in 1.2.3**

**The chat text follows the setting. Verified by measuring a real message node in a running app.**

The child shell renders the conversation, so its sample probe now reports the chat's own tokens and
the computed font size of an actual `.text-block`, once per sample:

| `config.chatFontSize` | `--pi-fs-md` / `--chat-fs` | `.text-block` font size | nodes |
| --- | --- | --- | --- |
| 16 | 16px / 16px | **16px** | 39 |
| 22 | 22px / 22px | **22px** | 39 |

The plumbing is the fix that was already in `broadcastTheme()`: the chat lives in a `<webview>`, a
webview is not a `BrowserWindow` and never appeared in `getAllWindows()`, so the token stylesheet was
never delivered and every appearance setting silently did nothing in the chat pane. Sending to
`getAllWebContents()` (the `window` **and** `webview` kinds) is what makes the message text read
`--pi-fs-md` at all.

**Two measurements had it wrong, and they are the reason this stayed open.** A probe asked for
`.text-block, .messages .msg, p` and got `p.pi-stats-note` — the first match in document order is the
stats panel's paragraph, whose 11px briefly looked like a broken cascade. And the second read the
tokens off our own chrome, where they are healthy and say nothing about the text.

The live path is **not** the same story, and the e2e now measures exactly where it stops. Setting
the size from the settings window, in the chat's own document:

- `--pi-fs-md` **does** follow the setting — 16px becomes 24px — so the tokens do reach a running
  chat. An earlier note in this file guessed otherwise.
- `--chat-fs` does **not** follow: it stayed at 16px, and at 13px in the sandbox. pi-chat sizes its
  text from `--chat-fs`, and our renderer block is the last stylesheet in the document, so the
  declaration that wins the cascade is **not** the one this app writes. Changing that block to derive
  the chain (`--chat-fs: var(--pi-fs-md)`) was therefore necessary and **not sufficient**.
- The message text stays put (16px) as a result, while a **restart** with a changed config works — the
  table at the top is from exactly that.

The next step is to find which declaration wins `--chat-fs` in the chat document: `getMatchedCSSRules`
is gone, so walk `document.styleSheets` for the variable and check whether pi-chat sets it inline. The
e2e asserts the half that works ("the chat's document receives the font token while the app runs") and
skips the text half with these numbers, so the split stays visible instead of hiding in a red check.

**Status:** open as of 1.2.0 · reproducible · root cause measured · two fix attempts reverted.

设置 → 外观 → 字号 accepts a value, the settings window shows it, and the CSS custom property
`--pi-fs-md` updates inside the chat page — but the chat text stays at whatever size the window
started with.

Measured in a running window (probe over `webContents`, `getComputedStyle` on `:root`), switching
16 → 22:

| value | before | after |
| --- | --- | --- |
| `--pi-fs-md` (ours, injected) | 16px | **22px** ✓ |
| `--chat-fs` (pi-chat's derived variable) | 16px | 16px ✗ |
| `.text-block p` computed font-size | 16px | 16px ✗ |

**Why.** `studio/pi-chat/src/style.css` declares `--chat-fs: var(--pi-fs-md, 13px)` in its own
`:root` block, and every chat size is derived from `--chat-fs`. That stylesheet sits far later in the
generated document than anything this project injects: `</head>` is at character 485,964 of
`studio/pi-chat/dist/index.html`, while pi-chat's `<style>` is at character 5,610,234. At equal
specificity the later declaration wins — and, unlike an ordinary property, a **custom-property
declaration cannot be forced with `!important`**. So `--pi-fs-md` updates and the derivation from it
never re-resolves. (Every colour fix in 1.2.0 works precisely because colours *do* have that lever.)

**Two paths already ruled out** — both attempted, both reverted; do not repeat them blind:

1. **Inject before `</body>` instead of before `</head>`.** The generated page is effectively one
   5.6-million-character line, so the line-based search for `</body>` matches the whole document and
   injects at position 0. Doing it character-wise with `html.lastIndexOf("</body>")` does place it
   correctly, but it shifts pi-chat's own `<script type="module">` in the scan order and breaks
   `test/injected-scripts.test.cjs` → *generated chat page: every inline script parses*
   (`vm.Script` cannot parse `import.meta`). If this road is taken again, teach the test to skip
   `type="module"` scripts **first**, and keep the suite green between every step.
2. **Mirror `--chat-fs` as an inline custom property on `<html>`** from the shim
   (`documentElement.style.setProperty`), which outranks every stylesheet. The startup call does run
   — an inline `--chat-fs` carrying the load-time value is present — but the same call on the live
   `pi:theme` message has no effect, even though it is present in `dist/main/chat-adapter.js` (four
   occurrences: definition + the live call + the two startup calls). Passing the freshly received CSS
   string directly into the helper changed nothing.

**Next step is measurement, not another guess.** Add a `console.log` to the shim's `onMessage`
handler and capture the chat window's renderer console via `webContents.on('console-message')`. That
shows which lines actually execute at load and on a live theme message, and settles the contradiction
above (the branch demonstrably runs, since `--pi-fs-md` updates — yet the statement next to it
apparently does not).

**Relevant code.** `src/main/chat-adapter.ts` (`SHIM_SCRIPT`, which applies a live theme message to
`#pi-heao-tokens`), `src/main/theme.ts` (`buildTokensCss`, which emits `--pi-fs-md`, `--chat-fs` and
`--chat-fs-8…15`), `studio/pi-chat/src/style.css` (`--chat-fs`). Note that commit `3d86504`
("pass the font size on the initial theme injection") already forwards the size on the first
injection, and the measurements above were taken on top of it — so the startup path is not the
remaining gap; the live-update path is.
