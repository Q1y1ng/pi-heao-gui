# Changelog

All notable changes to this project. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are `MAJOR.MINOR.PATCH`.

## [1.0.0] — 2026-09-13

First release intended for download-and-use.

### Added

**Chat and sessions**

- Streaming chat (the upstream pi-chat UI), model and thinking-level switching,
  fork/revert, `@file` completion, Mermaid/KaTeX rendering.
- Session sidebar: new, switch, rename, pin, delete, archive, restore, drag &
  drop, plus full keyboard navigation (arrows, Home/End, Enter, F2, Delete).
- Multi-window support: every window owns its own pi process and working
  directory.
- Full-text search across session history, with a jump-to-message highlight.

**Dock (the original extension's terminal / editor bridge / commit flow)**

- Terminal: a real PTY (node-pty + ConPTY) rendered with xterm.js, running the
  `pi` TUI by default (same bridge extension args and `--session` as the chat),
  with a system-shell toggle.
- Files: workspace file tree with a CodeMirror editor, save, and
  send-selection-to-chat.
- Changes: git branch/staged state and conventional-commit message generation
  using upstream's prompts and per-file diff truncation.

**Telemetry**

- Token and performance panel: first-token latency, decode wall time,
  tokens/second, cache hit rate, reasoning share, p50/p95 TTFT, per-turn table,
  per-day/month spend and budget warnings (Ctrl+Shift+S).
- Stats are persisted per session and reloaded when a session is reopened.

**Shell and platform**

- Command palette (Ctrl+K) over commands, sessions, slash commands and history
  hits.
- Settings window: theme (dark/light/system) with an accent picker, chat font
  size, spend budgets, launch at login, workspace and recent workspaces,
  extension packages (`pi install` / `remove` / `list`), skills create/edit,
  provider readiness (`pi auth check`) with one-click login, pi changelog, and a
  diagnostics panel (environment, RPC log, masked report bundle).
- Tray with recent sessions and an unread counter, desktop notifications, and
  close-to-tray.
- Built-in diff window driven by the rewind extension's snapshots.
- Interface language (Simplified Chinese / English) for the settings window.
- NSIS installer alongside the portable build.

### Changed

- Design tokens (`--pi-*`) replace the ad-hoc palette; the shell, sidebar,
  settings and dock share one visual system.
- Session listing is asynchronous with a persisted meta cache (previously every
  refresh read ~170 MB synchronously and froze the main process).
- API keys never reach a renderer: they are returned masked and restored on save.

### Fixed

- The chat document no longer embeds the whole app config (which could contain an
  API key in `env`).
- Preferences: theme and accent apply without a restart; the title bar shows the
  active session instead of staying blank.
- Injected stylesheets are wrapped in `<style>` elements — as bare text they
  closed `<head>` implicitly and the chat window rendered a wall of CSS.
- The Windows title-bar overlay no longer covers the app's own title-bar buttons.
- `rewindDiff` renders in the built-in viewer instead of handing the file to the
  OS default application.
- ConPTY needs absolute executable paths; bare `node` from the shim resolver made
  the terminal fail with an opaque error, and the failure was misreported as a
  missing native module.
- `pi list` parsing no longer turns unrelated unindented lines into packages.

### Known limitations

- **Unsigned binary**: Windows SmartScreen warns on first launch.
- **Windows only**: no macOS/Linux build or testing yet.
- Interface language covers the settings window; the chat-window strings added by
  this project (dock, sidebar, palette, telemetry panel) are still Chinese.
- No auto-update: re-download a release to upgrade.
- The upstream extension's LSP/diagnostics integrations are VS Code-only and are
  not portable.
- Provider OAuth is completed inside the built-in terminal by pi's own `/login`,
  not in a dedicated dialog.
- One working directory per window rather than per session (pi has no `set_cwd`).

[1.0.0]: https://github.com/Q1y1ng/pi-heao-gui/releases/tag/v1.0.0
