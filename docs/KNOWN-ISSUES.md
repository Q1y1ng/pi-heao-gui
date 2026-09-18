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

**Two runs, same code, different results: 97/0, then 88/2, then 95/2.**

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

## The font-size setting does not resize chat text

**Measured again in 1.2.3 — the variable chain is healthy; a real message node has not been measured yet.**

The earlier notes said `--chat-fs` stayed at 16px while `--pi-fs-md` moved. What the running app
actually reports, read off the document in the main window with `PI_DEBUG_WINDOW=1`:

- `--pi-fs-md: 16px` and `--chat-fs: 16px` at `:root`, and the upstream's own rule
  (`:root` with `--chat-fs: var(--pi-fs-md, 13px)`) computing `--chat-fs-12: calc(16px * 12 / 13)` —
  **our value is the one being used**, so the variable plumbing works.
- The chain `#pi-shell → .pi-body → #pi-main → …` reports the same values at every level: nothing
  redeclares them in between.

**Two measurements were wrong, and that is why this is still open.** A probe asked for
`.text-block, .messages .msg, p` and got `p.pi-stats-note`: the first match in document order is the
stats panel's paragraph, whose 11px is its own font size and not the chat's — which briefly looked
like a broken cascade. And the main window's chat had no message nodes at all during the run, so
`.text-block` measured `null` there.

**The next measurement is specific, then:** read a `.text-block` in a window that actually shows a
conversation (the child windows do), with the configured size changed. The config file is *not* one
of `~/.pi/agent/*.json` — find it through `CONFIG_PATH` in `main.ts` before changing anything.

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
