# Known issues

Open defects with their measured evidence, so the next person can continue instead of re-deriving.

---

## The font-size setting does not resize chat text

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
