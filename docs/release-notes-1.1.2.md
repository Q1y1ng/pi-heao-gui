## 1.1.2 — 2026-09-13

### Added

- **输入框粘贴可用 `Ctrl+Z` 一步撤回**。上游的粘贴处理器会拦掉浏览器默认行为、然后根据字符串
  重建编辑器内容，这次插入因此从不进入原生撤销栈 —— 逐字输入能撤，粘贴一大段却不能。
  现改为在捕获阶段接管粘贴，用 `document.execCommand('insertText')` 插入：它是一次**原生编辑**，
  所以 Ctrl+Z 能一步吃掉整段，而且会触发 `input` 事件，上游的 `@路径` token 化、自适应高度、
  发送按钮状态等逻辑照常运行。
  **文件粘贴（图片/附件）不接管**，仍走上游路径；若原生编辑不可用，事件不会被拦下，
  交还原处理器，绝不吞掉粘贴。

### Fixed

- **扩展 UI 请求现在都会得到应答**。应用此前只应答交互型请求（`select` / `confirm` / `input` /
  `editor`，且要人点对话框），其余 `setWidget` / `setStatus` / `notify` / `setTitle` /
  `set_editor_text` **一律不应答**；而 pi 的扩展调用在宿主回复前不会结束，一轮里会累计几十个悬住。
  修的时候有两个坑：`respondExtensionUi` 会把**没有 `value` 的载荷变成 `cancelled`**
  （所以不能用空对象答应答），以及 `__mcp_status__` 分支会**提前 return** 把应答整个跳过。

### Security

- CI 里的第三方 action 从可变标签（`@v4`）**固定到 commit SHA**，包括那个握着签名 token 的发布
  作业；Dependabot 仍会以可评审的 PR 推送升级。

## 安装

需要 **Windows 10 / 11（x64）**、**Node.js ≥ 22**，以及 `pi` CLI：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

再准备至少一个 provider 的凭据（写在 `~/.pi/agent/auth.json`，或让应用带你在内置终端里登录）。
安装程序可自选目录，会自动创建桌面与开始菜单快捷方式；便携版免安装直接运行，但**不支持自更新**。

## 注意

- **本版仍未签名**：首次运行 Windows SmartScreen 会提示“已保护你的电脑”，
  点 **更多信息 → 仍要运行**；或先比对下方 SHA256。签名申请走
  [SignPath Foundation](https://signpath.org/foundation)，仓库侧已就绪。
- 已安装的 1.1.x 会在启动约 20 秒后自动检查并下载本版；**便携版需手动换包**。
- 本版发布前跑过一轮真机日常流程回归：真窗口 + 真模型，让 agent 建文件、写测试、跑测试，
  **20/20 项通过**（含 Ctrl+Z 撤回粘贴、工具执行、Dock 三面板、设置窗、渲染进程零报错）。

## 校验和（SHA256）

```text
a3658b75cefa7df317165e9d89b36b8c3b2f8b6acfef0a81d1109ebccf6a024a  Pi-Heao-GUI-Setup-1.1.2.exe
cc93c23f801b90d3f75708e8c36e022acb65eb2a797c01386c01af0e314f376d  Pi-Heao-GUI-1.1.2-Portable.exe
```

源码包（含那份需要联网才能重建的聊天 UI 产物）的校验和见 Release 附件 `SHA256SUMS.txt`。
