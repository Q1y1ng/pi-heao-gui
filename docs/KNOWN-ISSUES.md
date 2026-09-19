# Known issues

Open defects with their measured evidence, so the next person can continue instead of re-deriving.

---

## Our theme tokens are not visible in the sidebar's scope — **closed: a measurement taken across a theme switch**

**Status:** closed 2026-09-19 · not a defect · reproduced arithmetically from the two quoted readings

**What was recorded.** `--pi-text-dim` on the sidebar's ghost buttons measured **3:1** in the dark
theme (against `rgb(20,23,28)`), and switching that one rule to `var(--pi-text)` measured **1.12:1 in
the light theme and 1.1:1 in the dark one** — read at the time as "a token that reads fine everywhere
else does not resolve to a usable colour in this rule".

**What it actually was.** Both readings pair the **light** palette's text colours with the **dark**
theme's sidebar background:

| recorded | text colour | where that colour comes from | measured against | ratio |
| --- | --- | --- | --- | --- |
| 3:1 (dark) | `rgb(91,100,114)` | the **light** theme's `--pi-text-dim` | `rgb(20,23,28)`, the dark sidebar | **3.10:1** |
| 1.1:1 (dark) | `rgb(28,32,39)` | the **light** theme's `--pi-text` | `rgb(20,23,28)`, the dark sidebar | **1.11:1** |

Neither text colour belongs to the theme whose background it was measured against, so the reading was
taken either side of a theme switch. Nothing is wrong with the token: with one theme applied,
`--pi-text` resolves to `#e7eaf0` (dark) and `#1c2027` (light) **at the button itself**, and the same
rule measures **7.06:1 in the dark theme and 5.58:1 in the light one** — both above the 4.5:1 the gate
requires. `npm run e2e:isolated` passes its contrast section in both themes (113/0/1, 2026-09-19).

**Why it stayed open for a round.** It was never re-measured as one coherent reading. The rule also
carries `transition: color 130ms`, so reading `getComputedStyle(el).color` immediately after changing
it returns the **pre-change** colour — a probe reproduces that exactly. The entry then took on the
shape of the font-size defect and was filed under *"where do our tokens stop being visible?"*, which
made a measurement artifact look like a systemic cascade problem.

**Fixed on the gate, not in the theme.** The contrast section now asserts that the theme actually
landed (its `--pi-bg` token is the palette's background for the theme it asked for) **before** judging
any colour, and reports the tokens next to the numbers when it did not. `.pi-btn-ghost` keeps
`--pi-text-dim`, with those numbers in its comment in `src/main/sidebar.ts`.

> The original entry, kept as the record of how it read at the time:
>
> **Measured in 1.2.3, while trying to fix the contrast finding on `.pi-btn-ghost`.**
>
> - `--pi-text-dim` on the sidebar's ghost buttons measures **3:1** in the dark theme (against
>   `rgb(20,23,28)`) — below the 4.5:1 the accessibility gate requires for text.
> - Switching that one rule to `var(--pi-text)` measured **1.12:1 in the light theme and 1.1:1 in the
>   dark one** — text and background effectively the same colour. A token that reads fine everywhere
>   else does not resolve to a usable colour in this rule, so the value was left as it was.
>
> This has the same shape as the font-size defect, and is worth treating as one question: **where do
> our tokens stop being visible?** The font probe found `--pi-fs-md: 16px` at `:root` and all the way
> down `#pi-shell → .pi-body → #pi-main`, so the chain is healthy for the chat — and yet a chrome rule
> in the sidebar cannot use `--pi-text`. Answering that is likely to fix both.

## The isolated e2e suite is flaky in its window lookups — **closed: five consecutive green runs**

**Status:** closed 2026-09-19 · 116 checks, **0 failures in five consecutive runs** · the one
remaining skip states exactly why it skipped.

**What moved, and why.** *Same code, different results: 97/0, then 88/2, then 95/2* was three faults
wearing one symptom, and none of them was the app:

| What failed | What it really was | What it is now |
| --- | --- | --- |
| *a session opens in its own window* (skipped) | The archive/delete sections legitimately empty the sandbox's session store, so the check reported "no sessions" — about another section's cleanup, not the app. | The harness refills the store it seeded (`seedSessions`) and looks again. The check has passed in every run since. |
| *no text below 4.5:1* — the ghost button at 3:1 / 1.12:1 | A frozen CSS transition. The theme is switched **through the settings window**, which occludes the chat window, and Chromium does not advance a transition in a window it considers occluded. A frozen frame is a colour no stylesheet asks for. | The measurement asserts the theme landed, then reads the **cascaded** value with transitions and animations frozen for the duration. It also parses `color(srgb …)` and composites semi-transparent backgrounds — both of which it read wrongly, reporting an error banner at 1.28:1 where the real figure is ~13:1. |
| *terminal runs a command and shows its output* | The same throttling: an occluded window's renderer can hold an xterm write back, and an unrendered window's `innerText` is empty. | `foreground(win)` before the checks that read rendered output. |

**The measurement was the thing under test.** Every failure above was the harness reading a window
that was not being painted, while its answer to "which window, in which state" was "whatever exists
right now". The contrast section now names the window it measured in every message
(`win#1 pi-heao-chat-*.html …`), which is what made the ghost button's colour traceable to a frozen
frame rather than to the token.

**The same fault lived in the daily suite, where it cost more.** *an assistant reply arrived* failed
about half of all runs, with `assistant reply (first 300):` empty — while the turn was streaming
`outputTokens=288` and **the user's own message** read empty too. `innerText` is layout-dependent and
an occluded window is throttled. The harness now reads `textContent` (that check means "the reply
reached the conversation", not "it is painted"), and it compares against the session file the app
itself is writing before deciding: file has the text and the window does not → a regression, and it
fails; neither has it → the turn produced no text to render, and it skips with that reason. The daily
suite has run **25/25** since.

> **The app-level pass has the same shape, less often.** On 2026-09-19 one read-only run reported two
> failures in its post-report multi-window section (*the session window actually shows the conversation*,
> conversation nodes 0; and the font-size check that reads those nodes), and the next run of the same
> code was clean (82/0, exit 0). Same class as above — a window being read before it has painted, or a
> session picked before it has content — and the same answer: the check reports what it saw (the node
> count and the window body text) rather than only failing.

**Also fixed while in there:** the export check used to skip with "no file was produced (session may
be empty)" — a guess. The application's own log said what it was: `export conversation failed: Pi RPC
process is not running` (a state the app supports — Reload re-spawns it) or a resumed sandbox session
with nothing in it. The check now reports which of those it hit, and the assertion that the exported
markdown *contains* the conversation moved to the daily suite, where a real turn has just produced one.

> The original entry, kept as the record of how it read at the time:
>
> **Same code, different results: 97/0, then 88/2, then 95/2 — root-caused to a genuinely empty
> session list.** The check asked `pi:list-sessions` in the sandbox and got `[]`: the sandbox is a
> throwaway profile, and a cold pi child may not have written any session by that point. Asking once
> and polling for 40 seconds failed identically, which is what rules out timing as the cause. The
> section now skips with that reason instead of failing, so the checks after it no longer report a
> failure about something they do not test.
>
> The checks that move are *a session is available to open in its own window* and, as a consequence,
> the contrast check that sees the error banner it puts on screen. The cause is which window the
> section ends up talking to: a stripped child has no sidebar, and the settings window cannot answer
> for the app. The lookup now asks for the main window structurally (`#pi-sidebar`), which is more
> correct than matching a URL and falling back to "any window", but the failure still reproduces, so
> the harness is what needs to be made deterministic. The app-level e2e (87/0, run twice) does not
> move this way.

## A pi child can exit with code 1 on its own — what that does and does not mean

**Investigated 2026-09-19, after a report of "Pi process exited (code 1). Click reload or send a
message to restart." appearing repeatedly.**

**What is established.**

- `code 1` with `signal=null` and **no stderr at all** is what this app's own teardown produces:
  closing a window, reloading a session or quitting calls `taskkill /PID <pid> /T /F`
  (`rpc-client.ts`), and Windows reports a force-killed process as exit code 1. In the RPC log's
  03:51–07:26 span that day, **140 of 150 exits were exactly that**, every one of them from test runs
  opening and closing windows. So the code on its own is not evidence that anything went wrong —
  which is why the banner now carries pi's last stderr lines instead (`CHANGELOG`, 未发布).
- One failure mode that *is* real and reproducible: pi installs the agent packages listed in
  `~/.pi/agent/settings.json` at start-up with `npm install … --prefix <agentDir>/npm`. **Two pi
  children starting at once install into the same prefix**, and on Windows that loses the race:
  `npm warn tar TAR_ENTRY_ERROR ENOENT … lstat '…\node_modules\ajv\dist'`, then
  `npm error code ENOTEMPTY … rmdir '…\node_modules\zod\src\v4\locales'`, then pi exits 1.
  Reproduced in an e2e sandbox that same day (a fresh profile installs 11 packages, and the harness
  opens a second window while the install is still running). A profile that hits this can be left
  with a half-removed tree that fails the same way on every later start — which would match "it keeps
  dying".
- The reporting machine's own profile was checked and is healthy: all 11 packages present under
  `~/.pi/agent/npm/node_modules` (`zod`, `ajv`, `pi-mcp-adapter`, `undici` included), no `.staging`
  leftovers, and `npm install` into that prefix is not failing. So that instance's exit was not this.

**What to collect next time it happens.** The banner now shows pi's last lines; the full log is
`%TEMP%\pi-standalone-rpc.log`, and the diagnostics bundle (**设置 → 诊断 → 生成诊断包**) contains it.
With the reason in hand the next step differs: a failed install wants the prefix repaired
(`npm install <packages> --prefix ~/.pi/agent/npm --legacy-peer-deps`), a killed process wants the
cause of the kill (memory pressure or Task Manager), and an app crash wants the stack in that log.

**Fixed in the 未发布 build — both halves, and the measurement came first.** The race is now
serialised (`spawn-queue.ts`) and a start-up that dies before it is ready is retried **once**
(`chat-session.ts`). What decided the design:

| Question | Measurement | What it settled |
| --- | --- | --- |
| How long can a start-up hold the queue? | 11 packages against an empty prefix: first stdout line at **+70.9 s** (warm npm cache) and **past +170 s** (cold cache, under load); nothing to install: **+1.0 s** | the ceiling is **300 s**, above the slow end — letting the next start-up through early would recreate the race, so waiting is the cheaper mistake |
| Is "pi answered the app's first request" an honest "past start-up"? | a request written at **+1.0 s** was answered at **+70.9 s**, after the last `npm install` finished | yes — pi does not read stdin until its start-up work is behind it, so the queue releases on that answer |
| What about a profile with no packages at all? | pi prints **nothing, ever** (260 s of silence, no install, no `settings.json` written) | the ready signal cannot be an extension's own event: the session provokes one instead, or that start-up would hold the queue for its whole ceiling |

Two defects the tests then found, both real and both fixed: a start-up that fails twice used to
`throw`, which would have left the window with **no session at all** — it now keeps the shape the app
recovers from (session stays, banner says why, the next message or a reload restarts it); and a write
to a pi that had just died raised `EPIPE` on the stdin pipe with **no `error` listener**, which is an
uncaught exception in the main process.

**Not fixed here:** a pi that dies *after* start-up is still not restarted automatically — the banner
and "click reload or send a message" remain the way back, by design.

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

## The font-size setting does not resize chat text — **fixed in 1.2.3**

**Status:** fixed in 1.2.3 · both halves (delivery to the webview, and the live update) are asserted
by the e2e · the status line below is the stale one, kept quoted with the rest of the original entry.

**The chat text follows the setting. Verified by measuring a real message node in a running app.**

The child shell renders the conversation, so its sample probe now reports the chat's own tokens and
the computed font size of an actual `.text-block`, once per sample:

| `config.chatFontSize` | `--pi-fs-md` / `--chat-fs` | `.text-block` font size | nodes |
| --- | --- | --- | --- |
| 16 | 16px / 16px | **16px** | 39 |
| 22 | 22px / 22px | **22px** | 39 |

The tokens reaching the chat is one half of it: the chat lives in a `<webview>`, a webview is not a
`BrowserWindow` and never appeared in `getAllWindows()`, so the token stylesheet was never delivered at
all. Sending to `getAllWebContents()` (the `window` **and** `webview` kinds) is what makes the chat read
`--pi-fs-md` in the first place — necessary, and on its own not enough. What the message text was
actually sized from is in the live-path paragraphs below.

**Two measurements had it wrong, and they are the reason this stayed open.** A probe asked for
`.text-block, .messages .msg, p` and got `p.pi-stats-note` — the first match in document order is the
stats panel's paragraph, whose 11px briefly looked like a broken cascade. And the second read the
tokens off our own chrome, where they are healthy and say nothing about the text.

The live path is **fixed as well**, and the cause was one line in the vendored chat. Both halves are
now asserted by the e2e, through the settings window:

- `studio/pi-chat/src/main.ts` sets `--chat-fs` **inline** on boot, from `window.__PI_FONTSIZE__`, which
  this app fills in with `config.chatFontSize` when it builds the chat HTML.
- An inline custom property beats every stylesheet, so the copy that won the cascade was the one written
  **once at load and never again**. Our tokens did arrive — measured: `--pi-fs-md` went 16px to 24px in
  the chat's own document — and changed nothing, because `--chat-fs` never moved.
- Deriving the chain in our renderer block, which the previous round did, could not have helped: that
  block loses to the inline copy whatever it says.

The fix is in our shim, next to the bridge that delivers `theme` messages: when the token element is
replaced it re-points the inline property at the master (`--chat-fs: var(--pi-fs-md, 13px)`), so the
winning copy is a reference that follows. The vendored upstream is left untouched.

> The original entry, kept as the record of how it read at the time — status line included, because
> that line is the part that went stale:
>
> **Status:** open as of 1.2.0 · reproducible · root cause measured · two fix attempts reverted.
>
> 设置 → 外观 → 字号 accepts a value, the settings window shows it, and the CSS custom property
> `--pi-fs-md` updates inside the chat page — but the chat text stays at whatever size the window
> started with.
>
> Measured in a running window (probe over `webContents`, `getComputedStyle` on `:root`), switching
> 16 → 22:
>
> | value | before | after |
> | --- | --- | --- |
> | `--pi-fs-md` (ours, injected) | 16px | **22px** ✓ |
> | `--chat-fs` (pi-chat's derived variable) | 16px | 16px ✗ |
> | `.text-block p` computed font-size | 16px | 16px ✗ |
>
> **Why.** `studio/pi-chat/src/style.css` declares `--chat-fs: var(--pi-fs-md, 13px)` in its own
> `:root` block, and every chat size is derived from `--chat-fs`. That stylesheet sits far later in the
> generated document than anything this project injects: `</head>` is at character 485,964 of
> `studio/pi-chat/dist/index.html`, while pi-chat's `<style>` is at character 5,610,234. At equal
> specificity the later declaration wins — and, unlike an ordinary property, a **custom-property
> declaration cannot be forced with `!important`**. So `--pi-fs-md` updates and the derivation from it
> never re-resolves. (Every colour fix in 1.2.0 works precisely because colours *do* have that lever.)
>
> **Two paths already ruled out** — both attempted, both reverted; do not repeat them blind:
>
> 1. **Inject before `</body>` instead of before `</head>`.** The generated page is effectively one
>    5.6-million-character line, so the line-based search for `</body>` matches the whole document and
>    injects at position 0. Doing it character-wise with `html.lastIndexOf("</body>")` does place it
>    correctly, but it shifts pi-chat's own `<script type="module">` in the scan order and breaks
>    `test/injected-scripts.test.cjs` → *generated chat page: every inline script parses*
>    (`vm.Script` cannot parse `import.meta`). If this road is taken again, teach the test to skip
>    `type="module"` scripts **first**, and keep the suite green between every step.
> 2. **Mirror `--chat-fs` as an inline custom property on `<html>`** from the shim
>    (`documentElement.style.setProperty`), which outranks every stylesheet. The startup call does run
>    — an inline `--chat-fs` carrying the load-time value is present — but the same call on the live
>    `pi:theme` message has no effect, even though it is present in `dist/main/chat-adapter.js` (four
>    occurrences: definition + the live call + the two startup calls). Passing the freshly received CSS
>    string directly into the helper changed nothing.
>
> **Next step is measurement, not another guess.** Add a `console.log` to the shim's `onMessage`
> handler and capture the chat window's renderer console via `webContents.on('console-message')`. That
> shows which lines actually execute at load and on a live theme message, and settles the contradiction
> above (the branch demonstrably runs, since `--pi-fs-md` updates — yet the statement next to it
> apparently does not).
>
> **Relevant code.** `src/main/chat-adapter.ts` (`SHIM_SCRIPT`, which applies a live theme message to
> `#pi-heao-tokens`), `src/main/theme.ts` (`buildTokensCss`, which emits `--pi-fs-md`, `--chat-fs` and
> `--chat-fs-8…15`), `studio/pi-chat/src/style.css` (`--chat-fs`). Note that commit `3d86504`
> ("pass the font size on the initial theme injection") already forwards the size on the first
> injection, and the measurements above were taken on top of it — so the startup path is not the
> remaining gap; the live-update path is.
>