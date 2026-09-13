# Changelog

本项目的所有重要变更记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 1.1.0

### Added

- 自动检查更新（`electron-updater`，指向本仓库 Release）：启动 20 秒后在后台检查，
  发现新版本自动下载，可在 设置 → 诊断 → 版本与更新 里手动检查并重启安装。
  源码运行时不检查（会说明原因），可用 `autoCheckUpdates: false` 关闭。
- 英文界面覆盖到聊天窗标题栏、侧栏、停靠区（终端/文件/变更）、命令面板、
  统计面板、托盘菜单与关于对话框；语言在 设置 → 常规 切换，`auto` 跟随系统。
- 代码签名走 SignPath Foundation：`signpath/artifact-configuration.xml` 与手动触发的
  `.github/workflows/sign-windows.yml`（申请通过后配置 5 个 secrets/vars 即可用）。

### Fixed

- **设置窗所有控件点不动**：内联脚本里被模板字面量吞掉的换行转义让字符串未闭合，
  整段脚本解析失败，因此没有任何事件处理器被注册。浏览器不报错、主进程无日志。
- **命令面板（Ctrl+K）打不开**：`<style id="pi-palette">` 与面板根元素撞 id，
  `getElementById` 拿到的是样式元素，第一次按键走的是"关闭"分支。
- **标题栏两个指标不更新**：统计面板的指标 id 与标题栏芯片撞 id，值被写进了隐藏元素。
- **文件编辑器报错** `CodeMirror.defineSimpleMode is not a function`：Rust 模式依赖的
  simple-mode 插件未随包提供。
- **Windows 上更新日志的 npm 回退从未生效**：`npm.cmd` 直起被 Node 拒绝（EINVAL）。
- **终端重启后吞掉所有按键**：`termOpening` 未复位，且 ConPTY 被 kill 后需要沉降时间，
  否则新 shell 会在第一次写入时退出。
- 删除已被移动的会话时不再抛出裸 `ENOENT`，而是说明文件已被移动或删除。
- 命令面板在任何位置按 Esc 都能关闭（此前仅输入框聚焦时有效）。
- 更新日志标签页打开即加载（此前需手动点"刷新"，看起来像空页）。

### Tests

本轮把"点不动"这类故障变成可自动发现的：

- 解析**每一个**注入脚本 + 生成页面的**重复 id 审计**（反向验证过：还原修复即报错）；
- preload 通道覆盖：每个窗口调用的通道必须在其白名单内，且每个授权都必须有处理器；
- 端到端逐页面逐功能：只读 73 项 + 沙箱破坏性 83 项，**任何渲染进程报错即失败**；
- i18n：残留中文清单、翻译后片段可解析、中文输出逐字节不变。
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
