# Pi Standalone GUI

独立的 Pi coding agent 桌面客户端 — 从 [Pi Agent Studio](https://github.com/JohnnyZ93/pi-agent-studio) VS Code 插件中剥离出来的 Electron 壳，**不再需要 VS Code**。

MIT License

## 功能

- 流式聊天（复用上游 `pi-chat` UI）
- 模型切换 / thinking level
- fork / revert
- 会话列表侧栏（新建 / 切换 / 重命名）
- 设置面板（本地配置 + pi agent 配置）
- bundled 扩展：todo、subagent、questionnaire、permission-gate、rewind-code、btw、mcp
- `@file` 文件补全、文件对话框、系统默认程序打开文件
- Mermaid / KaTeX 渲染

## 前置要求

- Windows 10/11
- Node.js ≥ 22（用于安装 pi CLI）
- pi CLI：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

- 至少一个 provider 的 API Key（在 `~/.pi/agent/auth.json` 或设置面板中配置）

## 安装

### 方式一：Portable exe

下载 `Pi Standalone GUI 0.1.0.exe`，双击运行。无需安装。

### 方式二：从源码构建

```bash
git clone <this-repo>
cd pi-standalone-gui
npm install
npm run build:renderer   # 构建 pi-chat
npm run build            # 编译 TypeScript
npm start                # 开发模式运行
npm run dist             # 打包 portable exe
```

## 配置

配置文件位于 `~/.pi/standalone/config.json`，也可在应用内「设置」面板编辑。

关键配置项：

| 字段 | 说明 |
|---|---|
| `piPath` | pi 可执行文件路径（留空自动检测） |
| `workspaceRoot` | 默认工作目录（@file 搜索根） |
| `permissionMode` | `AskForApproval` / `FullAccess` |
| `mcpEnabled` | 是否加载 MCP 扩展 |
| `chatSendShortcut` | `enter` / `ctrlEnter` |

pi agent 自身配置仍在 `~/.pi/agent/`（settings.json、models.json、auth.json、SYSTEM.md 等），与 VS Code 插件共用。

## 架构

```
Electron Main (Node.js)
  ├─ spawn pi --mode rpc  (JSONL stdio)
  ├─ chat-session 编排
  ├─ IPC handlers
  └─ settings / sessions / file ops
Electron Renderer (Chromium)
  ├─ pi-chat UI (vendored, single-file HTML)
  ├─ acquireVsCodeApi shim → window.pi (preload bridge)
  └─ 会话侧栏 (injected)
```

上游源码 vendored 于 `vendor/upstream/`（MIT）。

## 与 VS Code 插件的差异

| 能力 | VS Code 插件 | 本应用 |
|---|---|---|
| 聊天 UI | ✓ | ✓ |
| 终端 TUI | ✓ | ✗ |
| diagnostics / LSP | ✓ | ✗ |
| SCM 提交信息 | ✓ | ✗ |
| 会话侧栏 | ✓ | ✓ |
| 设置面板 | ✓ | ✓ |
| 资源占用 | VS Code 全家桶 | 仅 Electron |

## License

MIT — 见 [LICENSE](LICENSE)。

上游 [pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio) 同为 MIT。
