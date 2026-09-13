# 架构与实现笔记

本文记录这个项目是怎么搭起来的、为什么这么搭，以及一路上踩过的坑。
它由早期一份交付记录整理而来，保留是因为其中的结论仍然有效。

- 面向使用者的说明：[`../README.md`](../README.md)
- 发布流程：[`RELEASING.md`](RELEASING.md)
- 与上游的对应关系：[`UPSTREAM.md`](UPSTREAM.md)
- 保真度审计：[`FIDELITY.md`](FIDELITY.md)

## 形态与关键决策

**What was built** — 一个独立的 Electron 桌面应用，从 Pi Agent Studio VS Code 插件中剥离出完整的聊天体验。Main 进程 spawn `pi --mode rpc` 并通过 JSONL stdio 编排会话；Renderer 托管 vendored 的 `pi-chat` 单文件 HTML（通过 `acquireVsCodeApi` shim 桥接到 preload IPC）；左侧注入会话列表侧栏（高对比度暗色主题、会话名从 session_info 或首条用户消息提取）；独立设置窗口编辑本地配置与 pi agent 文件。bundled 扩展（todo/subagent/questionnaire/permission-gate/rewind/btw/mcp）全部挂载并正确打包进 asar。最终产出 Windows portable exe（约 100MB），双击即用，无需 VS Code。

Review 修复：打包 `!**/*.ts` 误删 bridge 扩展（改为精确排除 src/docs）；pi 进程退出后会话锁死（改为可 reload 恢复）；侧栏 XSS（改用 textContent）；settings.json 写入加 JSON 校验；rewindDiff/toggleFavorite 补 handler；agents/*.md 被全局 md 排除误删（重新 include）。

**Verification** — `npx tsc` PASS；Electron dev 启动 PASS（chat session created）；portable exe 启动 PASS；asar 包含全部 bridge/*.ts + agents/*.md + mcp/index.js。

**Journey log** —

1. vite singlefile 的 HTML 内 JS 字符串里也有 `</head>`，注入必须按行匹配结构性标签，不能用 `String.replace` 第一次出现。
2. Electron 下载走 `npmmirror.com/mirrors/electron/` 可大幅加速；本机已有 v43 缓存可复用。
3. `acquireVsCodeApi` shim 用 `window.dispatchEvent(new MessageEvent('message',{data}))` 即可对接 pi-chat 的 `window.addEventListener('message')`，无需改上游源码。
4. electron-builder `files` 的 `!**/*.ts` 是全局排除，会误删 vendored 的 TS 扩展资产；需精确排除或在后面 re-include。
5. 子进程 `exit` 时若设 `disposed=true` 会永久锁死恢复路径；应只标记 `rpcAlive=false` 并允许 reload。

## [S1] Problem

用户当前依赖 VS Code + Pi Agent Studio 插件来使用 pi coding agent。VS Code 整颗运行时只为跑一个聊天面板，资源占用过高。需要一个独立的 Electron 桌面应用，复用上游 `JohnnyZ93/pi-agent-studio` 的 MIT 开源代码，提供与插件 webview 模式对等的全功能体验，不再依赖 VS Code。

## [S2] Design

### 总体架构

```
┌─────────────────────────────────────────────────────────┐
│ Electron Main (Node.js)                                 │
│  ├─ window.ts          BrowserWindow 管理               │
│  ├─ ipc.ts             ipcMain.handle / ChatHost 实现    │
│  ├─ rpc-client.ts      spawn pi --mode rpc + JSONL      │
│  ├─ chat-session.ts    会话编排（从上游适配）             │
│  ├─ settings.ts        本地 JSON 配置读写                │
│  ├─ sessions.ts        ~/.pi/agent/sessions 列表管理     │
│  ├─ fs-utils.ts        文件搜索 / 对话框 / 打开文件       │
│  └─ extensions/        bundled pi 扩展（vendored）       │
├─────────────────────────────────────────────────────────┤
│ Electron Preload (contextBridge)                        │
│  └─ 暴露 window.pi API 给 renderer                      │
├─────────────────────────────────────────────────────────┤
│ Electron Renderer (Chromium)                            │
│  ├─ pi-chat/           上游聊天 UI（Vite 构建）          │
│  ├─ sidebar/           会话列表侧栏（自研）              │
│  ├─ settings-panel/    设置面板（复用 pi-settings）      │
│  └─ shell.css          窗口布局                          │
└─────────────────────────────────────────────────────────┘
              │ spawn + JSONL stdio
              ▼
     pi --mode rpc  ←  -e extensions/todo.ts 等
```

### 数据流

1. Renderer 通过 `window.pi.postMessage(msg)` 发消息到 Main
2. Main 的 `chat-session.ts` 处理消息，调用 `rpc-client` 与 pi 子进程通信
3. pi 子进程事件流（JSONL）经 `rpc-client` 回调到 `chat-session`
4. `chat-session` 通过 `webContents.postMessage` 推送到 Renderer
5. Renderer 的 `acquireVsCodeApi` shim 将消息分发给 pi-chat 各模块

### 关键接口契约

**ChatHost 抽象**（替换上游 `vscode.Disposable`）：

```typescript
interface ChatHost {
  postMessage(msg: unknown): void;
  onDidReceiveMessage(listener: (msg: unknown) => void): () => void;
  onDidDispose(listener: () => void): () => void;
  updateTitle?(running: boolean, sessionName?: string): void;
}
```

**Preload 暴露的 API**（`window.pi`）：

```typescript
interface PiBridge {
  postMessage(msg: unknown): void;
  onMessage(listener: (msg: unknown) => void): () => void;
  // 注入的全局配置（替代 webview HTML 中的 __PI_*__ 变量）
  config: {
    home: string;
    sep: string;
    workspace: string;
    mermaidTheme: string;
    sendShortcut: string;
    fontSize: number;
    bgImage: string | null;
    bgOpacity: number;
  };
}
```

**本地配置文件** `~/.pi/standalone/config.json`：

```typescript
interface StandaloneConfig {
  piPath: string;              // 空则自动检测
  language: "auto" | "en" | "zh-cn";
  env: Record<string, string>;
  args: string[];
  disabledTools: string[];
  permissionMode: "AskForApproval" | "FullAccess";
  dangerousPatterns: string[];  // 空则用上游默认
  mcpEnabled: boolean;
  mcpIdleTimeout: number;
  chatFontSize: number;
  chatSendShortcut: "enter" | "ctrlEnter";
  chatMermaidTheme: string;
  chatBackgroundImage: string;
  chatBackgroundOpacity: number;
  rpcTrace: boolean;
  workspaceRoot: string;        // 默认工作目录
}
```

### 功能范围（全功能对齐）

| 功能 | 实现方式 |
| --- | --- |
| 流式聊天 | 复用 pi-chat + rpc-client |
| 模型切换 / thinking level | 同上 |
| fork / revert | 同上 |
| todo 组件 | bundled extension `todo.ts` |
| subagent | bundled extension `subagent/` |
| questionnaire | bundled extension `questionnaire.ts` |
| permission-gate | bundled extension `permission-gate.ts` |
| rewind-code | bundled extension + 自研 diff 视图 |
| btw | bundled extension `btw.ts` |
| MCP | bundled extension `mcp/` + pi-chat mcp-panel |
| @file 自动补全 | Main 侧 fs 搜索（替代 vscode.workspace.findFiles） |
| 文件对话框 | electron.dialog.showOpenDialog |
| 打开文件 | shell.openPath（系统默认程序） |
| 剪贴板 | electron.clipboard |
| 会话列表侧栏 | 自研：扫描 ~/.pi/agent/sessions，支持新建/切换/重命名 |
| 设置面板 | 复用 pi-settings，数据源改为本地 JSON |
| mermaid / KaTeX | pi-chat 内置，无需额外工作 |
| 语言 i18n | pi-chat 内置 locales + 设置项 |

### 明确放弃的功能

| 功能 | 原因 |
| --- | --- |
| 终端 TUI 模式 | 无 VS Code 集成终端；可后续用 xterm.js 扩展 |
| vscode_get_diagnostics | 无编辑器/LSP |
| /vscode-selection 等 slash 命令 | 无编辑器状态 |
| SCM 提交信息生成 | 无 VS Code SCM |
| Activity Bar / Views Container | VS Code 专属 UI 模型 |
| pi-vscode-bridge.js | 依赖 bridge HTTP server 提供编辑器数据 |

### Vendoring 策略

从上游 `JohnnyZ93/pi-agent-studio` 克隆源码，vendored 到 `vendor/upstream/`：

- `pi-chat/` — 完整复制，仅改 `acquireVsCodeApi` shim
- `src/chat/rpc-client.ts` — 复制，去掉 vscode import
- `src/chat/chat-types.ts` — 原样复制
- `src/chat/builtin-commands.ts` — 原样复制
- `src/chat/chat-session.ts` — 适配：替换 vscode.* 调用为 Electron 等价物
- `bridge/` — 复制 todo/questionnaire/subagent/btw/permission-gate/rewind-code/mcp，排除 pi-vscode-bridge.js
- `pi-settings/` — 评估后复用或重写

上游更新时通过 `vendor/update.sh` 同步。

### 打包与安装

- `electron-builder` 打 Windows portable（单 exe）或 NSIS 安装包
- 输出到 `E:\AI\pi-standalone\dist-electron\`
- 不装 C 盘
- pi CLI 仍走全局 npm 安装（已有）

## [S3] Out of Scope

- 终端 TUI 模式（xterm.js）
- VS Code bridge / diagnostics / LSP 集成
- Git commit message 生成
- macOS / Linux 打包（仅 Windows）
- 自动更新
- 多窗口 / 多工作区

## Tasks

- [x] T1: 初始化 Electron 项目骨架 — acceptance: `npm run dev` 打开空白窗口，preload 暴露 `window.pi`，renderer 能 postMessage 往返 (covers: S2)
- [x] T2: Vendor 上游源码 — acceptance: `vendor/upstream/` 包含 pi-chat、rpc-client、chat-types、builtin-commands、bridge 扩展；`pnpm build` 在 vendor/pi-chat 下产出单文件 HTML (covers: S2)
- [x] T3: 实现 rpc-client + chat-session 适配层 — acceptance: Main 进程能 spawn `pi --mode rpc`，完成 getState/getModels/prompt 往返，事件流正确回调 (covers: S2; depends: T1, T2)
- [x] T4: 接入 pi-chat 到 renderer — acceptance: 聊天界面渲染，能发消息收到流式回复，模型下拉可用 (covers: S2; depends: T3)
- [x] T5: 实现本地配置系统 — acceptance: `~/.pi/standalone/config.json` 读写正常，pi 路径/env/args/disabledTools 生效 (covers: S2; depends: T1)
- [x] T6: 实现文件操作（对话框/搜索/打开） — acceptance: 点击附件按钮弹出文件对话框；@输入触发文件搜索补全；点击文件路径能用系统默认程序打开 (covers: S2; depends: T1)
- [x] T7: 实现会话列表侧栏 — acceptance: 侧栏列出历史会话，点击切换，能新建会话，显示运行状态 (covers: S2; depends: T3, T4)
- [x] T8: 接入设置面板 — acceptance: 能查看/编辑模型 providers、API Key、系统提示词、MCP 配置；数据写入 ~/.pi/agent/ 和本地 config.json (covers: S2; depends: T5)
- [x] T9: 打通全部 bundled 扩展 — acceptance: todo/subagent/questionnaire/permission-gate/rewind/btw/mcp 在聊天中可用 (covers: S2; depends: T4)
- [x] T10: 打包 Windows 可执行文件 — acceptance: `npm run dist` 产出 portable exe，双击可运行，不依赖 Node 全局安装（pi CLI 除外）(covers: S2; depends: T4, T5, T6, T7, T8, T9)
