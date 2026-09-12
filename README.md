# Pi Heao GUI

> **V0.1** · made by HEAOZIE

独立的 Pi coding agent 桌面客户端 — 从 [Pi Agent Studio](https://github.com/JohnnyZ93/pi-agent-studio) VS Code 插件中剥离出来的 Electron 壳，**不再需要 VS Code**。

MIT License

## 功能

- 流式聊天（复用上游 `pi-chat` UI）
- 模型切换 / thinking level
- fork / revert
- 会话列表侧栏（新建 / 切换 / 重命名 / 置顶 / 搜索 / 右键菜单 / 拖拽文件）
- 多窗口：一个会话一个独立 pi 进程
- 设置面板（本地配置 + pi agent 配置）
- 标题栏 token 指标（上下文占用 / 首 token / t/s / 花费）
- 系统托盘 + 桌面通知 + 关闭最小化
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

下载 `Pi Heao GUI 0.1.0.exe`，双击运行。无需安装。

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

配置文件位于 `~/.pi/standalone/config.json`（V0.1 沿用该路径以兼容早期构建），也可在应用内「设置」面板编辑。

关键配置项：

| 字段 | 说明 |
| --- | --- |
| `piPath` | pi 可执行文件路径（留空自动检测） |
| `workspaceRoot` | 默认工作目录（@file 搜索根） |
| `permissionMode` | `AskForApproval` / `FullAccess` |
| `mcpEnabled` | 是否加载 MCP 扩展 |
| `chatSendShortcut` | `enter` / `ctrlEnter` |

pi agent 自身配置仍在 `~/.pi/agent/`（settings.json、models.json、auth.json、SYSTEM.md 等），与 VS Code 插件共用。

## 架构

```text
Pi Heao GUI V0.1 (Electron Main, Node.js)
  ├─ spawn pi --mode rpc  (JSONL stdio)
  ├─ chat-session 编排
  ├─ IPC handlers
  └─ settings / sessions / file ops
Electron Renderer (Chromium)
  ├─ pi-chat UI (vendored, single-file HTML)
  ├─ acquireVsCodeApi shim → window.pi (preload bridge)
  └─ 会话侧栏 (injected)
```

上游源码 vendored 于 `vendor/upstream/`（MIT）—— 只保留 `pi-chat/`、`bridge/`、`pi-mcp/`、`assets/`
等运行时必需品，上游版本 pin（tag `v1.3.8` / commit `8c50c0a`）与刷新流程见
[docs/UPSTREAM.md](docs/UPSTREAM.md)。

## 开发脚本

```bash
npm run build        # 编译 main/preload -> dist/ + 拷贝 renderer
npm run typecheck    # tsc --noEmit
npm run lint         # biome lint（biome.json）
npm run lint -- --write  # 自动修可修项
npm test             # 构建 + node:test 单元测试（23 例，零依赖）
npm start            # 直接启动（dist 需已构建）
npm run smoke        # 运行时烟测（开一个真窗口，约 20s）
npm run icon         # 重新生成 build/icon.png + 多尺寸 build/icon.ico
npm run dist         # 打包 portable exe
```

构建产物专用（仅刷新 vendored 上游时需要）：

```bash
npm run build:renderer   # 重建 pi-chat 单文件 UI（vendor/upstream/pi-chat）
npm run build:mcp        # 重建 MCP 扩展 bundle（vendor/upstream/pi-mcp）
```

- `npm test` 跑在**编译产物**（`dist/`）上，覆盖配置校验、密钥掩码往返、openPath 白名单、
  Windows shim 解析器（含 `&` 注入回归）、会话列表缓存/失效、生成 HTML 的 CSP 与注入转义。
- `npm run smoke` 启动真实主进程并断言安全边界与会话链路（preload 白名单、CSP eval/fetch 拦截、
  openPath 拦截、侧栏会话列表、水印与改名、shim 解析器），失败以非 0 退出。
  注意：若环境里设了 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化为纯 Node，脚本会直接给出提示。
- CI：`.github/workflows/ci.yml` —— `lint + typecheck + test` 为阻断作业，`smoke` 为咨询作业（Windows runner）。

## 安全模型

聊天窗口渲染的是**不可信的 agent/工具输出**，因此边界按窗口划分：

- **聊天窗口 preload**（`src/preload/preload.ts`）：`window.pi.invoke` 走通道白名单，
  只能访问聊天类通道；读不到也改不了 `~/.pi/agent/auth.json` / `settings.json` / 应用配置。
- **设置窗口 preload**（`src/preload/preload-settings.ts`）：只有它能读写配置与 agent 文件，
  且不能驱动 agent。
- **API Key 掩码**：`auth.json` 永远不会以明文回传渲染层；表单里显示的 `••••` 表示“保持不变”，
  写回时由主进程还原真实值。
- **CSP**：聊天页与设置页都带 `default-src 'none'` 起手的 CSP（无远端脚本/无远端请求）。
- **`shell.openPath` 白名单**：拒绝 `.exe/.bat/.cmd/.ps1/.vbs/.lnk/.js/...` 等可执行类型与 UNC/设备路径。
- **子进程**：Windows 下的 `pi.cmd` 会被解析成 `node cli.js` 直接 spawn，参数不经过 `cmd.exe`（否则 `&` 就是命令注入）。
- **单实例锁**：避免两个实例并发写配置/抢同一会话文件。
- 三个窗口均为 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。

## 与 VS Code 插件的差异

| 能力 | VS Code 插件 | 本应用 |
| --- | --- | --- |
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
