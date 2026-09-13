# Pi Heao GUI

> **V1.0** · made by HEAOZIE

**对话体验**：从 [Pi Agent Studio](https://github.com/JohnnyZ93/pi-agent-studio)（VS Code 扩展，MIT）**原样剥离**的聊天 UI —— vendored、字节级校验、零改动。
**应用层**：独立 Electron 外壳，重新实现原本由 VS Code 宿主提供的侧栏 / 终端 / 编辑器桥 / diff / 密钥存储 / 设置界面，并在其上提供原版没有的增强。

> 保真度实测见 [docs/FIDELITY.md](docs/FIDELITY.md)：上游聊天层保留 **143/253** 个符号；`npm run check:upstream` 在 CI 中断言 `vendor/upstream/` 仍与 pinned tag **字节一致**。

MIT License

## 功能

- 流式聊天（复用上游 `pi-chat` UI）
- 模型切换 / thinking level
- fork / revert
- **底部 Dock（三个 tab，对应原版的终端 / 编辑器桥 / 提交信息）**
  - **终端**：真 PTY（node-pty + xterm.js），默认直接在 PTY 里跑 `pi` TUI —— 即上游的 native terminal TUI
  - **文件**：工作区文件树 + CodeMirror 编辑器，选中内容一键「发送到对话」（对应上游 `addSelectionToChat`）
  - **变更**：git 分支 / 暂存状态 + 生成 conventional-commit 提交信息（对应上游 `generateGitCommitMessage`）
- 会话管理：重命名 / 删除 / 归档 / 恢复（归档走 `sessions/_archived/`，pi CLI 也不再列出）
- 跨会话全文搜索（命令面板内可直接跳到命中消息）
- **Token 遥测面板**（Ctrl+Shift+S）：首 token 延迟 / 解码 t/s / 缓存命中率 / 推理占比 / p50-p95 / 日月花费与预算
- 命令面板 Ctrl+K（命令 / 会话 / 历史命中 / 斜杠指令）
- 会话列表侧栏（新建 / 切换 / 重命名 / 置顶 / 搜索 / 右键菜单 / 键盘导航 / 拖拽文件）
- 多窗口：一个会话一个独立 pi 进程，**每窗口独立工作目录**
- 设置窗：主题（深/浅/跟随系统）+ 任意强调色 + 字号、预算、开机自启、**扩展安装/卸载**（`pi install/remove/list`）、**技能新建/编辑**、诊断面板、**pi 更新日志**、provider 就绪检查
- **provider 登录**：就绪列表里一键在内置终端中运行 pi 自己的 `/login <provider>`（凭据由 pi 写入 auth.json）
- **界面语言**：设置窗（8 个 tab 与选择器）已支持中/英；聊天窗自有文案（终端面板/侧栏/命令面板/统计面板）仍为中文——机制与字典已就绪，范围以 [src/main/i18n.ts](src/main/i18n.ts) 头注释为准
- 标题栏 token 指标 + 系统托盘（最近会话 / 未读角标）+ 桌面通知
- bundled 扩展：todo、subagent、questionnaire、permission-gate、rewind-code、btw、mcp
- `@file` 文件补全、文件对话框、系统默认程序打开文件、**内置 diff 窗口**（读 rewind 快照作基线）
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

### 方式一：安装包（推荐）

下载 `Pi Heao GUI Setup 1.0.0.exe`，双击安装：可自选安装目录，会自动创建桌面与开始菜单快捷方式，带卸载项（卸载不会删除你的 pi 会话与配置）。

### 方式二：免安装 Portable

下载 `Pi Heao GUI 1.0.0 Portable.exe`，双击直接运行，不写入安装目录。

> **两个包都未签名**，首次运行 Windows SmartScreen 会提示“已保护你的电脑”；
> 点“更多信息”→“仍要运行”即可，建议先比对 Release 页面里的 SHA256。
>
> 签名正在走 **SignPath Foundation（开源项目免费签名）** 的申请流程，仓库侧已就绪
> （`.github/workflows/sign-windows.yml` 手动触发 + `signpath/artifact-configuration.xml`），
> 见 `docs/RELEASING.md` 第 8 节。签名后的包会替换 Release 上的同名文件，并同步更新 SHA256。
> 注意即便是签名包，SmartScreen 的信誉也要靠下载量逐步累积（不是 EV 证书）。
>
> **首次运行**：应用会自动检查 pi CLI；未安装时会弹出安装指引并可一键打开设置。

### 方式三：从源码构建

```bash
git clone <this-repo>
cd pi-heao-gui
npm ci
npm run build:renderer   # 构建上游 pi-chat UI（仓库不含该产物，需要联网）
npm run build            # 编译 TypeScript + 内联编辑器/终端资源
npm start                # 开发模式运行
npm run dist             # 打包（portable + NSIS 安装包）
```

## 配置

配置文件位于 `~/.pi/standalone/config.json`（V1.0 沿用该路径以兼容早期构建），也可在应用内「设置」面板编辑。

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
Pi Heao GUI V1.0 (Electron Main, Node.js)
  ├─ spawn pi --mode rpc  (JSONL stdio)
  ├─ chat-session 编排
  ├─ IPC handlers
  └─ settings / sessions / file ops
Electron Renderer (Chromium)
  ├─ pi-chat UI (vendored, single-file HTML)
  ├─ acquireVsCodeApi shim → window.pi (preload bridge)
  ├─ 会话侧栏 / 标题栏 / 统计面板 / 命令面板 (injected)
  └─ Dock：终端(xterm.js) · 文件(CodeMirror) · 变更(git)
```

终端与文件面板需要主进程侧的原生/IO 能力：`node-pty`（N-API 预构建，Electron 与 Node 共用同一二进制）、
受工作区根目录约束的 `pi:fs-*`、以及 `pi:git-*`（提交信息用 `pi -p` 一次性生成，不污染会话）。

上游源码 vendored 于 `vendor/upstream/`（MIT）—— 只保留 `pi-chat/`、`bridge/`、`pi-mcp/`、`assets/`
等运行时必需品，上游版本 pin（tag `v1.3.8` / commit `8c50c0a`）与刷新流程见
[docs/UPSTREAM.md](docs/UPSTREAM.md)。

## 开发脚本

```bash
npm run build        # 编译 main/preload -> dist/ + 拷贝 renderer + 内联 xterm/CodeMirror
npm run typecheck    # tsc --noEmit
npm run lint         # biome lint（biome.json）
npm run lint -- --write  # 自动修可修项
npm test             # 构建 + node:test 单元测试（76 例，零依赖）
npm start            # 直接启动（dist 需已构建）
npm run smoke        # 运行时烟测（开一个真窗口，约 20s，22 项断言）
npm run verify       # 真机 UI 功能断言（33 项：面板 / 命令面板 / 侧栏 / 终端 / 文件 / 变更 / diff）
npm run measure-load # 会话切换耗时归因（pi 解析 vs 渲染）
npm run check:upstream # 断言 vendor/upstream 仍与 pinned tag 字节一致（需网络）
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
- CI：`.github/workflows/ci.yml` —— `lint + typecheck + test` 为阻断作业，`upstream`（保真度字节校验）
  为阻断作业，`smoke` 为咨询作业（Windows runner）。
- `npm run check:upstream` 是「聊天 UI 就是原版」这个承诺的守卫：它在 CI 中稀疏克隆 pinned tag
  并与 `vendor/upstream/` 全量比对，只有 `docs/UPSTREAM.md` 记录的差异被容忍。

### 已知环境陷阱

若当前 shell/父进程设置了 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化为纯 Node.js：
`npm start`、`npm run smoke`、以及直接启动打包好的 exe 都会**无提示地秒退**（退出码 0，
且连 userData 目录都不会创建）。启动前清掉它：

```powershell
$env:ELECTRON_RUN_AS_NODE = ""   # PowerShell
```

```bash
unset ELECTRON_RUN_AS_NODE       # bash / git-bash
```

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
| 聊天 UI | ✓ | ✓ **同一份上游代码** |
| 终端 TUI | ✓（VS Code 集成终端） | ✓（node-pty + xterm.js，同样跑 `pi` TUI） |
| 编辑器桥（选区/文件→对话） | ✓ | ✓（Dock 文件面板 + 发送选中） |
| SCM 提交信息 | ✓ | ✓（Dock 变更面板） |
| 会话侧栏 | ✓ | ✓（分组 / 归档 / 键盘导航为额外增强） |
| 设置面板 | ✓ | ✓ |
| 诊断 / LSP / 符号 | ✓ | ✗（依赖 VS Code 语言服务，不可剥离） |
| 更新日志查看 | ✓ | ✗（尚未移植） |
| OAuth 登录流程 | ✓（`models/oauth-flow.ts`） | ✗（仅 provider 就绪检查；新登录请在 pi CLI 完成） |
| 资源占用 | VS Code 全家桶（同机实测 15 进程 / 2.3 GB） | 4 进程外壳 + pi 子进程（≈ 795 MB） |

完整审计（符号级保留率、为什么外壳必须重写、未移植清单）见 **[docs/FIDELITY.md](docs/FIDELITY.md)**。

## License

MIT — 见 [LICENSE](LICENSE)。

上游 [pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio) 同为 MIT。
