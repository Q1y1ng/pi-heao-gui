# Pi Heao GUI

> 中文版见 [README.zh-CN.md](README.zh-CN.md) —— 中文版为准（若两版有出入，以中文版为准）。
[![CI](https://github.com/Q1y1ng/pi-heao-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/Q1y1ng/pi-heao-gui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Q1y1ng/pi-heao-gui)](https://github.com/Q1y1ng/pi-heao-gui/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)

## 1.2.4 — images, audio, and a readable editor in both themes

Released 2026-09-19 · [release notes](docs/release-notes-1.2.4.md) · [download](https://github.com/Q1y1ng/pi-heao-gui/releases/tag/v1.2.4)

- **The file panel previews images and audio.** PNG / JPG / GIF / WebP / BMP / ICO / AVIF / SVG render in
  place (scaled to fit, never stretched), and MP3 / WAV / OGG / M4A / AAC / FLAC / OPUS get a player with
  controls. The 10 MB cap rides on `data:` URLs, which the page's CSP already allows — no security policy
  was widened. Everything else still opens in the editor: the decision is made on the extension alone, so
  `logo.png.bak` stays text.
- **`Ctrl+S` can no longer overwrite a binary file with an empty editor.** The shortcut is global and does
  not know what the panel is showing. The e2e asserts a PNG's bytes are byte-identical after the keypress.
- **The editor and the file tree follow the theme.** CodeMirror's built-in colours are made for a white
  background and were unreadable on both themes — the accessibility gate measured line numbers at 2.85:1
  in light and strings at 2.59:1 in dark, the file tree's arrow column composited 5.59:1 down to 2.99:1
  behind 0.7 opacity, and the error banner's red text sat at 4.0:1 on its own 14% red background. Both
  themes now pass 4.5:1.
- **The Changes panel's refresh button refreshes the worktree dropdown**, so a working copy created by
  `git worktree add` while the app is running shows up without a page reload.

## 1.2.3 — the child shell, and a font size that finally moves

Released 2026-09-18 · [release notes](docs/release-notes-1.2.3.md) · [download](https://github.com/Q1y1ng/pi-heao-gui/releases/tag/v1.2.3)

- **The font-size setting now resizes the chat, live.** It had been recorded as a known defect since 1.2.0,
  and the earlier explanation was wrong: it was not a stylesheet outranking ours. The last layer is an
  inline `--chat-fs` written by the vendored chat at boot from `window.__PI_FONTSIZE__`, and an inline
  custom property beats every stylesheet — so the copy that won the cascade was the one written once and
  never again. The shell now re-points it at the master token. Measured: 16 gives 16px on a real message
  node, 22 gives 22px, and changing it while the app runs follows immediately. The e2e asserts it.
- **A dragged-out session window shows its conversation again.** `preload`'s `onMessage` is a single
  listener; the shell's own title script registered on the same channel and displaced the shim that
  forwards every host message, so the window was titled correctly and stayed empty — with no error
  anywhere. The stripped child shell is the default again, and `PI_MINIMAL_CHILD=0` brings back the full
  shell for comparison.
- **Worktrees are switchable from the Changes panel**: the dropdown lists every working copy (detached
  HEAD included) and switching moves the workspace, the terminal and new sessions with it.
- **`PI_DEBUG_WINDOW=1`** prints the child window's console, preload errors, load failures, a DOM
  fingerprint and a time series — off by default, for the next time something needs looking at rather
  than guessing about.

## 1.2.1 — multi-window, alerts, and a lighter shell

Released 2026-09-15 · [release notes](docs/release-notes-1.2.1.md) · [download](https://github.com/Q1y1ng/pi-heao-gui/releases/tag/v1.2.1)

- **Drag a session out of the sidebar** and it opens in its own window, at the pointer, clamped to the
  display it lands on. Electron has no native API for that gesture, so this one is ours.
- **The window that comes out is stripped**: a title bar with the session name, and the chat. No sidebar,
  no dock, no palette — one window, one session. The main window stays the control centre.
- **It makes a sound when it needs you.** Rising three notes when a turn finishes, a falling pair when the
  agent is waiting on a decision (permission, elevation, confirmation) — synthesized in a hidden renderer,
  so there are no audio assets and no reliance on the OS notification sound Focus Assist silences. A
  decision is heard even when its window has focus, because the turn is blocked until someone answers.
- **Windows come back on restart**, the tray lists them, and Ctrl+Shift+N opens a fresh session in a window
  of its own. Session windows are capped at six, with the reason shown instead of a drag that does nothing.

### What this round measured

- **0 dependency vulnerabilities**; Electron 43.7.0, the newest of its line; **0 blocking findings** in this
  project's own code under a full security and engineering scan.
- **0% idle CPU**, no leak over 45 seconds (+3.9 MB drift), **631 MB** idle for one window — of which the
  pi process is 247 MB. Hence the honest summary of the shell trim: cleaner, not much lighter.
- Session-list polling backs off with the window (15 s focused → 30 s background → nothing while hidden),
  and the temp-directory sweep now happens after first paint instead of in front of it.

## 1.2.0 — the readability release

Released 2026-09-14 · [release notes](docs/release-notes-1.2.0.md) · [download](https://github.com/Q1y1ng/pi-heao-gui/releases/tag/v1.2.0)

This release is entirely about the interface being *correct*: text that was unreadable in the light theme,
colours hardcoded to the dark one, and appearance settings that only applied once at startup.

- **Light-theme text is readable again.** Message headings and bold text were a hardcoded `#f2f4f8` —
  **1.1:1** on white. Code blocks were a hardcoded near-black. Links used the raw accent (**3.20:1**).
  All of them now follow the theme; links measure **6.54:1**.
- **A contrast gate now runs in the test suite.** `npm run e2e` walks every element in both themes and
  fails below 4.5:1 (3:1 for large text and UI components, per WCAG 1.4.11). Building it found four real
  defects — `.pi-tb-brand` 2.2:1, `empty-hint` 4.31:1, `pi-dock-meta` 3.50:1, `pi-git-del` 4.20:1 —
  all fixed and re-verified at zero failures.
- **Appearance changes apply live.** A theme, accent or size change after startup landed in a document
  that ignored it, and the accent only ever applied on the first change. Both fixed.
- **Answers start expanded**, with a Show less toggle, and the reply body is no longer a click target —
  selecting text in it no longer collapses the block.
- **Known issue, with measurements:** the font-size setting still does not resize chat text — **fixed in
  1.2.3**. See [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) for the evidence.

Installed copies self-update; the portable build needs a manual swap.

A **Windows desktop client for the [pi](https://github.com/earendil-works/pi) coding agent**: chat, a real
terminal, file browser, git panel, command palette, auto-update and a Chinese/English interface, in one
standalone Electron shell.

The chat interface in `studio/` is **this project's own code** — it can be changed like anything else
here. Its origin, and the MIT notice it carries, are recorded in [NOTICE.md](NOTICE.md).

![Feature tour](docs/images/tour.gif)

## Features

### Chat

- Streaming replies, thinking blocks, tool calls, diffs, images, markdown.
- **Answers arrive expanded**, with a 收起 / Show less toggle. The reply body is not a click target,
  so selecting text in it no longer collapses the block.
- **Ctrl+Z undoes a paste.** Pasting a large block used to be one irreversible edit; pastes now go in as a
  native undo entry, so Ctrl+Z removes exactly what you pasted. Pasting *files* is untouched.
- Attach files, drag and drop, slash commands, model picker, per-session token/cost readout.

### Sessions

- pi's own session files — history, resume, rename, fork, export. Nothing is stored twice.
- Project trust is pi's, not ours: an untrusted workspace is prompted the same way the CLI prompts.

### Dock (terminal / files / changes)

- **Terminal**: a real PTY (node-pty), multiple tabs, the shell of your choice.
- **Files**: browse and open the workspace without leaving the window.
- **Changes**: git status and diffs; commit from the app.

### Telemetry

Off by default in the sense that matters: **nothing about your code, prompts, or sessions is ever sent**.
What is recorded locally is UI-level counters (which panel you opened, etc.). See SECURITY.md.

### Settings and appearance

- Light/dark/system themes, accent colour, font size, window behaviour — all in a settings window that applies
  live. Settings are stored in `~/.pi/standalone/config.json`.
- **Both themes are covered by an automated contrast pass** (`npm run e2e` walks every element in light
  and dark and fails below 4.5:1, or 3:1 for large text and UI components). It found two real defects the
  first time it ran.

### Platform integration

- Tray icon with quick actions, single-instance handling, deep links, auto-update on startup (~20 seconds in),
  native menus, and a command palette (Ctrl+Shift+P).

## How it compares

| | This project | pivot-ui | pi-gui |
| --- | --- | --- | --- |
| Runtime | Electron shell + pi CLI | Browser workspace | Electron |
| Platform | **Windows** (installer + portable) | any browser | macOS / Linux |
| Chat UI | ✓ **the same UI code** (maintained here) | own implementation | own implementation |
| Terminal / files / git dock | ✓ | partial | partial |
| Auto-update | ✓ | — | ✓ |

**Who it is for**: people who already use pi, want a real window instead of a TUI, and are on Windows.
**Who it is not for**: macOS/Linux users (the shell is Windows-first), anyone who wants a redesigned agent
UI rather than the one the extension shipped, and anyone who wants a GUI *instead of* the CLI — pi remains
the engine, and the app assumes it is installed.

## Quick start

1. **Install pi** (the app drives the real CLI; it does not embed a model of its own):

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. **Install the app** — download `Pi-Heao-GUI-Setup-<version>.exe` from
   [Releases](https://github.com/Q1y1ng/pi-heao-gui/releases/latest) (or the `-Portable.exe` for a no-install
   run; the portable build does not self-update).

3. **Sign in** — start the app and use the built-in terminal to run `pi` once, or write credentials to
   `~/.pi/agent/auth.json`. The app reads pi's own config and session directories; it does not keep a second
   copy of your credentials.

> **Not signed yet.** First launch triggers SmartScreen ("Windows protected your PC") → *More info* →
> *Run anyway*, or check the SHA-256 against `SHA256SUMS.txt` on the release page first. Signing through the
> [SignPath Foundation](https://signpath.org/foundation) is applied for; the repository side
> (`signpath/artifact-configuration.xml`, `.github/workflows/sign-windows.yml`) is already in place.

## Requirements

- Windows 10 / 11 (x64)
- Node.js ≥ 22
- `pi` CLI installed and signed in
- A provider credential (cloud or local)

## Dependencies and upstream

| Dependency | Nature | If it breaks |
| --- | --- | --- |
| `pi` CLI (RPC protocol) | **hard** — the app is a client of its JSON-RPC surface | the app cannot work at all |
| pi config/session formats on disk | **hard** — read directly, not copied | sessions may fail to list |
| pi-agent-studio UI | **ours now** — a fork, not a pinned copy | we fix it ourselves |
| Electron | replaceable | framework upgrade |

`studio/` holds that fork (`pi-chat/` chat UI, `bridge/` extensions, `pi-mcp/`, `assets/`), taken from
upstream tag `v1.3.8` / commit `8c50c0a`. It is **our code**: change it freely, align with no upstream
version. To deliberately adopt something new from upstream, follow [docs/UPSTREAM.md](docs/UPSTREAM.md) —
diff first, take part or all of it. CI and the build no longer touch the upstream repository, so an upstream
release cannot turn this project red.

Honestly: **the ceiling on the experience is pi's.** This shell does not fix pi's behaviour and cannot add
capabilities pi does not have.

## Building from source

```bash
npm ci
npm run build:renderer   # our pi-chat single-file UI (5.4 MB artifact, not in the repo)
npm run build:mcp        # the bundled MCP extension
npm run build            # main + preload + renderer placeholder
npm run dist             # NSIS installer + portable exe into dist-electron/
```

The source zip attached to each release already contains the UI artifact, so
`npm ci && npm run build` works offline there.

## Configuration

`~/.pi/standalone/config.json` — theme, window geometry, dock visibility, telemetry toggle, update channel.
The settings window is the supported way to edit it. CLI paths are resolved like pi does: a `pi.cmd` shim is
turned into `node <cli.js>` directly, with a `cmd.exe` fallback only when the path contains no shell
metacharacters.

## Architecture

```text
main process (Electron)
  ├─ chat-session  ...... spawns/logs the pi RPC session, routes extension UI requests
  ├─ chat-adapter  ..... injects our CSS/JS into the shipped UI (the only way to extend it)
  ├─ dock  ............. terminal (node-pty), files, git
  ├─ stats-store ....... token/cost counters, atomic writes
  ├─ fs-path ........... workspace path confinement (realpath + junction-safe, fail-closed)
  └─ updater ........... electron-updater controller
preload (sandboxed, contextIsolation)
  └─ a narrow, typed bridge — no node integration in any renderer
renderer
  ├─ pi-chat UI (our fork, single-file HTML)
  └─ settings / palette windows
```

Why the shell had to be rewritten rather than reused as-is, and the traps hit while doing it, are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Scripts

```bash
npm test              # unit tests (172, none skipped)
npm run lint          # biome
npm run typecheck     # tsc --noEmit
npm run verify        # 38 DOM assertions against a real window
npm run smoke         # 22 end-to-end checks
npm run test:daily    # 20 checks driving a real model end-to-end
npm run check:package # asserts the packaged asar contains all 13 runtime paths
npm run shots         # regenerates the README screenshots in a throwaway sandbox
```

`.github/workflows/ci.yml` runs `lint + typecheck + test` and `package` (the packaged build contains every
runtime dependency) as **blocking** jobs, with `smoke` advisory.

## Troubleshooting

- **"pi not found"** — install the CLI globally, or point the app at it in Settings.
- **Blank window on first run** — check `%TEMP%/pi-standalone-rpc.log` (spawn/exit/stderr lines only).
- **Agent stops mid-turn** — usually a provider error surfaced in the transcript; the app does not retry
  silently.
- **SmartScreen** — expected; see the signing note above.
- **Font size not resizing chat text** — fixed in 1.2.3. The vendored chat writes an inline `--chat-fs` on
  `<html>` at boot, and an inline custom property beats every stylesheet; the shell now re-points that copy
  at the master token. Measurements and the trail: [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).

## Security model

- Every renderer runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- The preload exposes a narrow typed API only; there is no generic `ipcRenderer` passthrough.
- File operations are confined to the workspace via realpath-checked paths, and fail closed.
- `openPath`/`showItemInFolder` go through a blocklist (executables and script extensions), so a crafted
  filename cannot turn a "reveal in folder" into a launch.
- The renderer CSP still allows `script-src 'unsafe-inline'` because the shipped UI is a single-file HTML
  bundle that inlines scripts; this tradeoff is documented rather than hidden.
- Details and the reporting process: [SECURITY.md](SECURITY.md).

## Differences from the VS Code extension

| | Extension | This app |
| --- | --- | --- |
| Install | VS Code + extension | installer / portable |
| Terminal | VS Code's | own PTY + tabs |
| Editor | VS Code's | open-with / reveal (no embedded editor) |
| Chat UI | ✓ (the original) | ✓ **the same UI code** (maintained here) |
| Git | VS Code's | own dock (status, diff, commit) |
| Auto-update | extension marketplace | electron-updater |

## Docs

- [docs/README.md](docs/README.md) — documentation index
- [CHANGELOG.md](CHANGELOG.md) — release history (Chinese)
- [docs/RELEASING.md](docs/RELEASING.md) — release checklist
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — why the shell was rewritten
- [docs/FIDELITY.md](docs/FIDELITY.md) — symbol-level audit of the UI fork
- [docs/UPSTREAM.md](docs/UPSTREAM.md) — how to deliberately adopt upstream changes
- [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) — open defects with their measured evidence

Screenshots in this README come from `npm run shots`, which builds a disposable sandbox HOME and a synthetic
project — no real credentials, sessions, or model names are ever photographed.

## License

MIT. The chat UI originates from [pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio)
(MIT, JohnnyZ93) and is maintained here. See [NOTICE](NOTICE).
