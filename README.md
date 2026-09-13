# Pi Heao GUI

> 中文版见 [README.zh-CN.md](README.zh-CN.md) —— 中文版为准（若两版有出入，以中文版为准）。
[![CI](https://github.com/Q1y1ng/pi-heao-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/Q1y1ng/pi-heao-gui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Q1y1ng/pi-heao-gui)](https://github.com/Q1y1ng/pi-heao-gui/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)

A **Windows desktop client for the [pi](https://github.com/earendil-works/pi) coding agent** — the same chat UI
as the `pi-agent-studio` VS Code extension, in a standalone Electron shell, with a built-in terminal, file
browser, git panel, command palette, auto-update, and a Chinese/English interface.

The chat UI is not a reimplementation: it is the MIT-licensed
[`pi-agent-studio`](https://github.com/JohnnyZ93/pi-agent-studio) UI, now **maintained in this repository**
(`studio/`) as our own code. [docs/FIDELITY.md](docs/FIDELITY.md) records what was kept when it was first
split out of the extension — **143 of 253 symbols (57%)**; what was dropped was almost entirely VS Code
host API surface that cannot exist outside an extension.

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
npm test              # unit tests (127, none skipped)
npm run lint          # biome
npm run typecheck     # tsc --noEmit
npm run verify        # 35 DOM assertions against a real window
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
- **The font-size setting does not resize chat text** — a known, measured limitation of 1.2.0. The vendored
  chat stylesheet declares `--chat-fs` in its own `:root`, sits after everything this project injects, and a
  custom-property declaration cannot be forced with `!important`. Evidence and the next measurement to run:
  [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).

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
