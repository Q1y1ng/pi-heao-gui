# 与原版的关系：保真度实测

本文回答一个问题：**Pi Heao GUI 到底是"从 Pi Agent Studio 剥离"，还是"从零重写"？**

结论：**对话面是原版（字节级可验证），外壳是重写（因为 VS Code 提供的东西无法剥离），并且本项目在应用层做了原版没有的增强。**

上游 = [`JohnnyZ93/pi-agent-studio`](https://github.com/JohnnyZ93/pi-agent-studio) **v1.3.8**（commit `8c50c0a`，MIT）。

---

## 1. 可验证的"原样"承诺

| 项目 | 证据 |
| --- | --- |
| 上游 pin | `docs/UPSTREAM.md` 记录 tag / commit / 校验命令 |
| 字节级一致 | `npm run check:upstream`：稀疏克隆 pinned tag 后与 `studio/` 全量比对，**只容忍文档化的 3 处差异**（MCP 构建产物、`package-lock.json`、生成文件 `model-icons-data.ts`） |
| 聊天 UI = 原版 | 5.42 MB 单文件 bundle 由 vendored 源码构建（`npm run build:renderer`）；我方只做**运行时注入** |
| 注入不改上游 | 注入内容（设计 token、chrome、侧栏、统计面板、命令面板、Dock）合计约 167 KB ≈ bundle 的 **3%**；无任何 vendored 文件被修改 |
| 上游代码自愿运行 | 注入 `acquireVsCodeApi` shim，让 pi-chat 以为自己在 VS Code 宿主里，因此上游逻辑零改动 |
| 无 VS Code 运行时依赖 | `src/` 中不存在 `require("vscode")`；唯一 `vscode` 字样就是那个 shim |

CI 里 `check:upstream` 会在有人改动 vendored 文件时失败——这是让"原样"承诺不腐烂的机制。

## 2. 移植保真度（符号级实测）

对上游 `src/chat/*.ts`（2 473 行）逐一统计：其导出符号有多少出现在我方代码中。

| 上游模块 | 行数 | 保留率 | 说明 |
| --- | --- | --- | --- |
| `rpc-client.ts` | 240 | **90%** | 纯协议层，几乎整体移植 |
| `chat-session.ts` | 974 | **71%** | 会话控制器；被替换的是 `vscode.diff` / `commands` / `workspace` / `env` 相关部分 |
| `chat-types.ts` | 200 | 67% | 协议类型（我方定义在 `rpc-client.ts` + `shared/types.ts`） |
| `add-to-chat.ts` | 168 | 64% | 选区/文件→对话（由 Dock 的"文件"tab 承接） |
| `builtin-commands.ts` | 99 | 50% | 斜杠指令表 |
| `chat-tracker.ts` | 62 | 40% | 会话跟踪 → 我方 `sessions.ts`（异步 + 缓存，重新设计） |
| `chat-webview.ts` | 78 | 38% | VS Code Webview → Electron 窗口 + HTML 注入 |
| `pi-changelog.ts` | 71 | 36% | 尚未移植（**缺口**） |
| `chat-panel.ts` | 248 | 32% | `WebviewPanel` → 我方窗口管理 |
| `chat-sidebar.ts` | 303 | **29%** | `WebviewView` → 我方侧栏（**重写**：分组/归档/键盘导航） |
| `rpc-trace.ts` | 30 | 14% | VS Code `OutputChannel` → 我方日志 |
| **合计** | **2 473** | **143/253 = 57%** | 未保留的绝大多数是 VS Code 宿主专有函数 |

> 保留率是**下界**：语义相同但改名的（如 `updateStreamingState` → `updateStreaming`、`getChatWebviewHtml` → `buildChatHtml`）会被算作"未保留"。

## 3. 为什么外壳必须重写

VS Code 提供的外壳能力**无法从扩展里剥离**，只能重实现：

| 原版由 VS Code 提供 | 本项目的对应实现 |
| --- | --- |
| `WebviewView` 侧栏容器 | 自建侧栏（`sidebar.ts`） |
| `WebviewPanel` 标签页 | 自建窗口管理 + 多窗口（一窗一 pi 进程） |
| 集成终端（PTY） | **node-pty + xterm.js** 的 Dock 终端（`terminal.ts` / `dock.ts`） |
| 编辑器 / 选区 | Dock 的"文件"tab（文件树 + CodeMirror）+ 「发送选中到对话」 |
| `vscode.diff` diff 查看器 | 自建 diff 窗口（读 rewind 快照作基线） |
| 密钥存储 / 设置 UI | `auth.json` + 独立设置窗口 |
| 通知 / 状态栏 | Electron 通知 + 托盘（含未读计数） |
| 键位绑定 | 自建快捷键（Ctrl+K 命令面板、Ctrl+\` 终端、F2 重命名…） |

## 4. 本项目超出原版的增强（这些**不是**原版功能）

会话重命名/删除/归档/恢复、跨会话全文搜索、内置 diff 窗口、**Token 遥测面板**（首 token 延迟 / 解码速度 / 缓存命中率 / 推理占比 / p50-p95 / 日月花费 / 预算）、Ctrl+K 命令面板、侧栏分组与键盘导航、设置窗（主题深浅色 + 任意强调色、字号、预算、开机自启、扩展安装/卸载、技能新建/编辑、诊断面板）、托盘未读角标、每窗口工作目录、provider 就绪检查（`pi auth check`）。

因此更准确的自我描述是：

- **对话体验**：上游 UI 原样（字节级 vendored + 运行时注入，可被 `check:upstream` 验证）
- **应用层**：独立 Electron 外壳（替代 VS Code 宿主）+ 上述增强清单

## 5. 尚未移植的原版体验

| 项 | 状态 |
| --- | --- |
| `pi-changelog.ts`（更新日志查看） | 未移植 |
| `generateGitCommitMessage` / `abortGitCommitMessage` | **已补**（Dock「变更」tab） |
| `addSelectionToChat` / `addFileToChat` | **已补**（Dock「文件」tab） |
| 原生终端 TUI | **已补**（Dock「终端」tab，node-pty） |
| `models/oauth-flow.ts`（上游自带 OAuth 流程） | 未移植：目前只做就绪检查；上游用 `vscode.env.openExternal` + 本地回调，可移植但尚未做 |
| 每会话独立 cwd | 目前为**每窗口**一个工作目录（pi 无 `set_cwd`，切换需重建子进程） |
| i18n | 自有 UI 文案仍中英混排 |

## 6. 资源开销对比（同机实测）

| | 进程数 | 内存 |
| --- | --- | --- |
| VS Code（含 pi-agent-studio 等 21 个扩展） | 15 | **2 288 MB** |
| Pi Heao GUI | 4（外壳）+ 1（pi 子进程） | **465 + 330 ≈ 795 MB** |

即"移除 VS Code 主进程/扩展宿主开销"这一条成立：省约 **1.5 GB**，且没有扩展宿主进程。两侧都需要各自的 pi 子进程（VS Code 版由扩展启动，本项目由外壳启动）。这是同一台机器的即时快照，不是受控 A/B 基准。

## 7. 复现本文数据

```bash
npm run check:upstream     # 字节级保真（需网络）
npm run measure-load       # 会话切换耗时归因：pi 解析 vs 渲染
npm run verify             # 33 项真机 UI 功能断言（含终端/文件/变更）
npm test                   # 76 项单元测试
```
