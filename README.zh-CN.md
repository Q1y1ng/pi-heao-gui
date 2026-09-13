# Pi Heao GUI

> English version: [README.md](README.md) (this file is the Chinese one, and it is canonical).

[![CI](https://github.com/Q1y1ng/pi-heao-gui/actions/workflows/ci.yml/badge.svg)](https://github.com/Q1y1ng/pi-heao-gui/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Q1y1ng/pi-heao-gui)](https://github.com/Q1y1ng/pi-heao-gui/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)

**把 `pi` 编码 agent 从终端搬进桌面。** 聊天 UI 是从
[JohnnyZ93/pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio)（VS Code 扩展，MIT）
**原样剥离**、现在由本项目维护的（那份代码已归我们，可按需修改）；外面是独立的 Electron 外壳，重新实现原本由
VS Code 宿主提供的侧栏 / 终端 / 编辑器桥 / diff / 密钥存储 / 设置界面，并补上原版没有的遥测、
命令面板、自动更新与中英界面。

同类工具各有各的路线：`pivot-ui` 是浏览器工作区、`pi-gui` 另起了一套 Codex 风格的桌面 UI、
`pi-harness` 面向无头运行与运行时监控；**本项目的取舍只有一个 —— 把那份 UI 搬进 Windows 桌面、由我们自己维护**，其余一切都围绕这一点展开。详见下文「与同类项目的区别」。

**[下载最新版](https://github.com/Q1y1ng/pi-heao-gui/releases/latest)** ·
[保真度审计](docs/FIDELITY.md)（上游聊天层保留 143/253 个符号） ·
[文档索引](docs/README.md) · [变更记录](CHANGELOG.md)

![对话界面](docs/images/chat.png)

> 截图全部由 `npm run shots` 在**隔离沙箱**里生成：合成会话 + 临时工程，
> 因此不会带出任何真实会话名、路径或配置。


## 功能

### 对话

- 流式聊天（复用上游 `pi-chat` UI）、模型与 thinking level 切换、fork / revert
- `@file` 文件补全、文件对话框、Mermaid 与 KaTeX 渲染
- 输入框里**粘贴整段内容可用 `Ctrl+Z` 一步撤回**：粘贴走的是浏览器的原生编辑，因此它和
  逐字输入一样进撤销栈（上游原本是拦下粘贴后重建 DOM，所以怎么撤都撤不掉）
- 内置 diff 窗口，读 rewind 扩展的快照作基线
- 命令面板（`Ctrl+K`）：命令、会话、斜杠指令、历史命中

![命令面板](docs/images/palette.png)

### 会话

- 侧栏：新建 / 切换 / 重命名 / 置顶 / 搜索 / 归档 / 恢复 / 删除、右键菜单、键盘导航、拖拽文件
- 归档走 `sessions/_archived/`，pi CLI 也不再列出；删除当前正在使用的会话会被拒绝并说明原因
- 跨会话全文搜索，命中后可直接跳到那条消息并高亮
- 多窗口：每窗口独立 pi 进程与独立工作目录

### 终端 / 文件 / 变更（底部 Dock）

对应原插件的终端、编辑器桥与提交流程：

- **终端**：真 PTY（node-pty + ConPTY）＋ xterm.js，默认直接在 PTY 里跑 `pi` TUI，可一键切到系统 shell
- **文件**：工作区文件树 + CodeMirror 编辑器，保存、把选中内容一键发送到对话输入框
- **变更**：git 分支与暂存状态、逐文件 diff、"生成提交信息"（沿用上游提示词与截断策略）

![终端面板](docs/images/dock-terminal.png)

![变更与提交信息](docs/images/dock-changes.png)

### 遥测

- Token 与性能面板（`Ctrl+Shift+S`，或点标题栏指标）：首 token 延迟、解码速度、
  t/s、缓存命中率、推理占比、TTFT 的 p50/p95、逐轮表格、每日与每月花费、预算提醒
- 统计按会话持久化，重开会话即恢复；标题栏常驻显示上下文占用 / TTFT / 速度 / 本次花费

### 设置与外观

- 八个标签页：模型配置、扩展插件、技能、系统提示词、外观、诊断、更新日志、常规
- 主题（深/浅/跟随系统）+ 任意强调色 + 字号；`uiLanguage` 支持中/英/跟随系统
- 扩展包管理（`pi install / remove / list`）、技能增删改、provider 就绪检查、pi 更新日志、诊断包

![设置窗](docs/images/settings-models.png)

![外观设置](docs/images/settings-appearance.png)

### 平台集成

- 系统托盘：最近会话、未读计数、显示主窗口、退出；桌面通知；关闭到托盘
- **自动更新**：启动 20 秒后检查本仓库 Release，发现新版自动下载，可在
  设置 → 诊断 → 版本与更新 手动检查并一键重启安装（源码运行时不检查；
  `autoCheckUpdates: false` 可关闭）。**便携版不支持自更新**，需手动换包
- bundled 扩展：todo、subagent、questionnaire、permission-gate、rewind-code、btw、mcp

## 与同类项目的区别

同类项目不止一个，形态各不相同。下表按各家仓库与包的自述归纳（细节以它们自己的文档为准）：

| 项目 | 形态 | 它解决的是什么 |
| --- | --- | --- |
| **本项目** | Windows 桌面应用，聊天层取自 studio 的 UI 代码（现已归本项目维护） | 不从零设计界面：起点就是那份 UI，之后由我们按需修改 |
| [pivot-ui](https://github.com/sincw/pivot-ui) | 浏览器工作区（本机起服务） | 一台机器跑、多设备访问（含手机）；界面自成一套 |
| [pi-gui](https://www.pi-gui.com/) | 另一套桌面 UI（Electron，Codex 风格） | 会话时间线、每线程 git worktree、多 agent 编排；发布面向 macOS / Linux |
| `pi-harness` 类（[npm](https://www.npmjs.com/package/pi-harness) / [runtime 包](https://pi.dev/packages/pi-harness-runtime)） | 无头服务与运行时监控 | 把 pi 跑成后台服务、做用量统计与任务编排；本身不是给人看会话的界面 |

一句话：**要「和我熟悉的界面一模一样，只是不再需要 VS Code」，选这个；要另一种形态的工作区
（浏览器 / 服务端 / 多 agent 工位），那几类更对口。**

### 谁适合用

- 你在终端里用 pi，想要一个 **Windows 桌面窗口**，但不想重新适应一套新界面。
- 你在意与 VS Code 插件**行为一致**：`@file`、Mermaid / KaTeX、diff 窗口、权限门、`/login` 流程都在。
- 你需要 Windows 安装包 / 便携版、托盘、桌面通知、自动更新、中英界面。
- 你想让聊天、真终端、文件编辑、git 提交在**同一个窗口**里完成。

### 谁不适合用

- 你想在**手机或平板**上使用 —— 浏览器路线（[pivot-ui](https://github.com/sincw/pivot-ui)）更合适。
- 你要的是**无头 / 常驻服务**，或把 pi 当作别的前端的后端。
- 你主要在 **macOS / Linux** 上工作 —— 本项目只发布 Windows 包（外壳是 Electron，
  但没有为其他平台做过适配与测试）。
- 你需要 **LSP / 诊断 / 符号跳转** —— 那来自 VS Code 的语言服务，剥离后不再具备。
- 你**不想安装 Node 与 pi CLI** —— 本应用是外壳，不自带 agent 运行时。

## 快速开始

1. **装 `pi`**（应用自身要依赖它）：

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. **装本应用**：到 [最新版 Release](https://github.com/Q1y1ng/pi-heao-gui/releases/latest) 下载
   `Pi-Heao-GUI-Setup-<版本>.exe` 双击安装（可自选目录，自动建桌面与开始菜单快捷方式，带卸载项）；
   或下载 `Pi-Heao-GUI-<版本>-Portable.exe` 免安装直接运行。

   > **包目前未签名**，首次运行 Windows SmartScreen 会提示"已保护你的电脑"：点
   > "更多信息 → 仍要运行"，或先比对 Release 页面上的 SHA256。
   >
   > Windows builds are published unsigned for now. Signing is being applied for through the
   > **[SignPath Foundation](https://signpath.org/foundation)**, which provides free code
   > signing for open-source projects; the repository side is ready
   > (`signpath/artifact-configuration.xml` plus a manually triggered
   > `.github/workflows/sign-windows.yml`). Verify the SHA256 on the release page in the
   > meantime. 签名后的包会**同名替换** Release 附件并同步更新校验和。

3. **配 provider**：在应用内「设置 → 模型配置」查看就绪状态，需要登录时点一键登录 —— 它会在
   内置终端里运行 pi 自己的 `/login <provider>`，凭据由 pi 写入 `~/.pi/agent/auth.json`。

## 前置要求

- **Windows 10 / 11**（x64）
- **Node.js ≥ 22** —— 仅用于安装 `pi` CLI
- **pi CLI**：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- **至少一个 provider 的凭据**（写在 `~/.pi/agent/auth.json`，或让应用带你在终端里登录）

首次启动时应用会检查 `pi` 是否存在；找不到会弹出安装指引并可直接跳到设置里指定路径。

## 依赖与上游

这个项目是**外壳**，不是引擎 —— 模型调用、工具执行、会话管理都在 `pi` CLI 里，这里一行都没有。
它依赖两样东西，而这两样的**性质完全不同**：

| 依赖 | 性质 | 怎么绑定 | 上游变了怎么办 |
| --- | --- | --- | --- |
| **`pi` CLI** | 运行时**必需**，以 `--mode rpc` 在外驱动 | 走 pi 的公开 RPC 协议，**不 patch pi** | 协议变了就得跟 —— 这是**较硬**的一条依赖 |
| **pi-agent-studio 的聊天 UI 与 bridge 扩展** | **代码副本，已归本项目维护**（不是“参考设计”，也不再要求与上游一致） | 分叉自 tag `v1.3.8`（commit `8c50c0a`）；之后可任意修改 | 上游发新版**不影响我们**；想要它的新东西时按 [docs/UPSTREAM.md](docs/UPSTREAM.md) 主动吸收 |

**第二行值得说清** ✓：`studio/` 里放的就是那份 MIT 代码（`pi-chat/` 聊天 UI、
`bridge/` 扩展、`pi-mcp/`、`assets/`），[docs/FIDELITY.md](docs/FIDELITY.md) 逐符号记录了当初的保留率
（**143/253 = 57%**，未保留的绝大多数是 VS Code 宿主专有函数）—— 也就是说，**看聊天界面时，
你看的就是那份原版 UI** ✓。

区别在于**谁来决定它的下一版**：以前我们钉住上游、用 CI 强制字节一致 ✗，上游发版就可能让我们变红；
现在这份代码是我们的 ✓，改哪里由我们决定 ✓，上游只是“想要它的新东西时可以去取”的源 ✓（先 diff、
按需取，可只取一部分 ✓）。

同样诚实地说：**体验上限由 pi 决定**。这个壳不会去修 pi 的行为，也不会加 pi 做不到的能力；
若你要的是“重新设计一套 agent 界面”，那属于另一类工具 —— 见上文「与同类项目的区别」。

## 从源码构建

```bash
git clone https://github.com/Q1y1ng/pi-heao-gui.git
cd pi-heao-gui
npm ci
npm run build:renderer   # 构建我们那份 pi-chat UI（5.4 MB 产物不入库，首次需联网）
npm run build            # 编译 TypeScript + 内联 xterm/CodeMirror
npm start                # 开发模式运行
npm run dist             # 打包：便携版 + NSIS 安装包（输出到 dist-electron/）
```

发布用的源码包（Release 里的 `*-source.zip`）已经包含那份 UI 产物，解压后
`npm ci && npm run build` 即可，无需联网重建。

## 配置

应用配置在 `~/.pi/standalone/config.json`（也可在应用内「设置」里编辑），
`pi` 自身的配置仍在 `~/.pi/agent/`（`settings.json`、`models.json`、`auth.json`、`SYSTEM.md`），
与 VS Code 插件共用同一份。

| 字段 | 说明 |
| --- | --- |
| `piPath` | pi 可执行文件路径，留空自动检测 |
| `workspaceRoot` | 默认工作目录（`@file` 搜索根） |
| `theme` / `accent` / `chatFontSize` | 外观 |
| `uiLanguage` | `auto` / `zh-cn` / `en` |
| `permissionMode` | `AskForApproval` / `FullAccess` |
| `mcpEnabled` / `mcpIdleTimeout` | MCP 扩展开关与空闲超时 |
| `disabledTools` | 禁用的工具列表 |
| `autoCheckUpdates` | 是否在后台检查更新（默认开） |
| `budgetDailyUsd` / `budgetMonthlyUsd` | 花费预算，超出只提醒、不中断 |
| `favoriteModels` / `recentWorkspaces` | 模型选择器置顶、最近工作目录 |
| `commitLanguage` / `commitMessagePrompt` | 生成提交信息的语言与附加提示 |
| `openAtLogin` / `showArchived` | 开机自启、是否显示已归档会话 |

**数据位置**：会话在 `~/.pi/agent/sessions/`（由 pi 管理），统计与窗口状态在应用数据目录
（Windows 为 `%APPDATA%\pi-heao-gui`）。卸载程序**不会**删除这两处；要彻底清理手动删除即可，
细节见 [PRIVACY.md](PRIVACY.md)。

## 架构

```text
Pi Heao GUI (Electron Main, Node.js)
  ├─ spawn pi --mode rpc  (JSONL stdio)
  ├─ chat-session 编排
  ├─ IPC handlers
  └─ settings / sessions / file ops / updater
Electron Renderer (Chromium)
  ├─ pi-chat UI (our fork, single-file HTML)
  ├─ acquireVsCodeApi shim → window.pi (preload bridge)
  ├─ 会话侧栏 / 标题栏 / 统计面板 / 命令面板 (injected)
  └─ Dock：终端(xterm.js) · 文件(CodeMirror) · 变更(git)
```

终端与文件面板需要主进程侧的原生/IO 能力：`node-pty`（N-API 预构建，Electron 与 Node 共用同一
二进制）、受工作区根目录约束的 `pi:fs-*`、以及 `pi:git-*`（提交信息用 `pi -p` 一次性生成，
不污染会话）。

上游源码（现已归本项目维护）位于 `studio/`（MIT），只保留 `pi-chat/`、`bridge/`、`pi-mcp/`、
`assets/` 等运行时必需品；分叉自上游 tag `v1.3.8` / commit `8c50c0a`，主动吸收上游新变动的流程见
[docs/UPSTREAM.md](docs/UPSTREAM.md)。外壳为何必须重写、以及实现中踩过的坑见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 开发脚本

```bash
npm run build           # 编译 main/preload → dist/ + 拷贝 renderer + 内联 xterm/CodeMirror
npm start               # 直接启动（需先 build）
npm run dev             # 监听式开发
npm test                # 构建 + node:test 单元测试（跑在编译产物上）
npm run e2e             # 端到端：逐页面逐功能，只读
npm run e2e:isolated    # 端到端：沙箱内跑破坏性流程（改名/归档/删除/写盘/语言切换）
npm run smoke           # 运行时冒烟：开真窗口断言安全边界
npm run verify          # 真机 UI 功能断言（面板 / 命令面板 / 侧栏 / 终端 / 文件 / 变更 / diff）
npm run test:daily      # 日常流程端到端：真窗口 + 真模型，让 agent 建文件、写测试、跑测试（需 provider）
npm run measure-load    # 会话切换耗时归因（pi 解析 vs 渲染）
npm run check:package   # 断言打包产物（asar）含全部运行时依赖（需先 npm run dist）
npm run shot            # 截图（拍本机现状，仅供人工核对，**不入库**）
npm run shots           # 生成 README 配图：隔离沙箱 + 合成会话，输出到 docs/images/
npm run typecheck       # tsc --noEmit
npm run lint            # biome lint（--write 自动修）
npm run dist            # 打包便携版 + NSIS 安装包
npm run dist:portable   # 只打便携版
npm run icon            # 重新生成 build/icon.png + 多尺寸 .ico
npm run build:renderer  # 重建我们那份 pi-chat 单文件 UI（首次需联网装依赖）
npm run build:mcp       # 重建自带的 MCP 扩展 bundle
```

**测试与 CI**

- `npm test` 覆盖配置校验、密钥掩码往返、`shell.openPath` 扩展名黑名单（含尾随点/空格
  归一化）、**工作区路径逃逸（符号链接 / junction）**、Windows shim 解析（含 `&` 注入回归）、
  会话列表缓存、生成 HTML 的 CSP 与注入转义、注入脚本能否解析、生成页面的**重复 id 审计**、
  preload 通道覆盖、i18n 完整性、更新状态机。
- `npm run e2e` / `npm run e2e:isolated` 打开**每个窗口与面板**并断言点击后的真实变化
  （不是元素存在），**任何渲染进程报错都判定失败**；隔离模式把 HOME/APPDATA 指向临时目录，
  破坏性操作用的是沙箱内的副本。
- `.github/workflows/ci.yml`：`lint + typecheck + test` 与 `package`（打包产物含全部运行时依赖）
  为**阻断**作业，`smoke` 为咨询作业；依赖审计为咨询步骤，另有 Dependabot 分组跟进依赖。
- `npm run check:package` 是“装得上且装得全”的守卫：读 `app.asar` 头部断言 13 条运行时
  路径（自带聊天 UI、bridge 扩展、node-pty 原生模块等）都在包里。
- `npm run test:daily` 是唯一能证明“**这个应用真能把一件事做完**”的门禁：它开真窗口、
  用真模型（你指定的 provider），让 agent 建文件、写测试、跑测试，并且**以磁盘上的产物**
  作为完成判据（不是看界面文字猜结束）。其余检查只能证明控件在、桥在、数据在流动，
  证明不了这一条 —— 所以发版前必跑。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| `npm start`、`npm run smoke` 或打包好的 exe **无提示秒退**（退出码 0，连 userData 都不创建） | 当前 shell 里有 `ELECTRON_RUN_AS_NODE=1`，Electron 退化成了纯 Node.js。清掉它：PowerShell `$env:ELECTRON_RUN_AS_NODE = ""`，bash `unset ELECTRON_RUN_AS_NODE` |
| 首次运行被 SmartScreen 拦住 | 包未签名（见上）。点"更多信息 → 仍要运行"，或先比对 Release 页面上的 SHA256 |
| 提示找不到 `pi` | 按应用内指引安装，或在 设置 → 常规 里指定 `piPath` |
| 终端面板起不来 | 需要绝对可执行路径；若 `piPath` 指向 shim（`.cmd`）请留空让应用自行解析。面板的 meta 行会显示实际使用的 shell |
| 会话很多时启动慢 | 会话元数据是异步 + 缓存的；首次仍会较慢（要读一遍 session 文件） |
| 想彻底卸载 | 卸载程序只删程序本体。会话在 `~/.pi/agent/sessions/`，应用数据在 `%APPDATA%\pi-heao-gui`，配置在 `~/.pi/standalone/config.json` |

## 安全模型

聊天窗口渲染的是**不可信的 agent/工具输出**，因此边界按窗口划分：

- **聊天窗口 preload**（`src/preload/preload.ts`）：`window.pi.invoke` 走通道白名单，只能访问
  聊天类通道；读不到也改不了 `~/.pi/agent/auth.json` / `settings.json` / 应用配置。
- **设置窗口 preload**（`src/preload/preload-settings.ts`）：只有它能读写配置与 agent 文件，
  且不能驱动 agent。
- **API Key 掩码**：`auth.json` 永远不以明文回传渲染层；表单里显示的 `••••` 表示"保持不变"，
  写回时由主进程还原真实值。
- **CSP**：聊天页与设置页都带 `default-src 'none'` 起手的 CSP（无远端脚本、无远端请求）。
  **已知取舍**：脚本是内联注入的，策略里带 `script-src 'unsafe-inline'`，因此 CSP 只防外联、
  不单独承担防 XSS —— 注入点靠拼接处逐一转义（`sidebar` / `dock` / `palette` / `settings` 各自
  有 `esc()`），而不是靠策略兜底。改用 nonce/hash 需要给每个注入脚本在运行时算哈希，
  尚未做。
- **工作区约束**：文件面板只接受相对路径，且**解析真实路径后**（跟随 symlink/junction）
  必须仍在工作区内 —— 否则返回“路径无效”。无法验证时**拒绝**而不是放行。
  代价是：工作区里指向外部的软链不会在文件树里显示。
- **`shell.openPath` 黑名单**：先做路径归一化（去掉 Windows 会静默吃掉的尾随点/空格，
  否则 `evil.exe.` 能绕过 `extname` 检查），再拒绝
  `.exe/.bat/.cmd/.ps1/.vbs/.lnk/.js/…` 等可执行类型与 UNC/设备路径。
- **子进程**：Windows 下的 `pi.cmd` 会被解析成 `node cli.js` 直接 spawn，参数不经过 `cmd.exe`
  （否则 `&` 就是命令注入）。
- **单实例锁**：避免两个实例并发写配置或抢同一会话文件。
- 三个窗口均为 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。

漏洞与隐私细节见 [SECURITY.md](SECURITY.md) 与 [PRIVACY.md](PRIVACY.md)。

## 与 VS Code 插件的差异

| 能力 | VS Code 插件 | 本应用 |
| --- | --- | --- |
| 聊天 UI | ✓ | ✓ **同一份 UI 代码**（现已归本项目维护） |
| 终端 TUI | ✓（VS Code 集成终端） | ✓（node-pty + xterm.js，同样跑 `pi` TUI） |
| 编辑器桥（选区/文件→对话） | ✓ | ✓（Dock 文件面板 + 发送选中） |
| SCM 提交信息 | ✓ | ✓（Dock 变更面板） |
| 会话侧栏 | ✓ | ✓（分组 / 归档 / 键盘导航为额外增强） |
| 设置面板 | ✓ | ✓ |
| 更新日志查看 | ✓ | ✓（设置窗"更新日志"标签页） |
| OAuth 登录流程 | ✓（`models/oauth-flow.ts`） | ✓（在内置终端里跑 pi 自己的 `/login`） |
| 诊断 / LSP / 符号 | ✓ | ✗（依赖 VS Code 语言服务，不可剥离） |
| 每会话独立工作目录 | ✓ | ✗（pi 没有 `set_cwd`，改为每窗口一个） |
| 资源占用 | VS Code 全家桶（同机实测 15 进程 / 2.3 GB） | 4 进程外壳（约 0.5 GB）+ pi 子进程（约 0.3 GB） |

完整审计（符号级保留率、为什么外壳必须重写、未移植清单）见 [docs/FIDELITY.md](docs/FIDELITY.md)。

## 文档

全量索引在 **[docs/README.md](docs/README.md)**，常看的几份：

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 形态与关键决策、踩过的坑 |
| [docs/UPSTREAM.md](docs/UPSTREAM.md) | 我们那份 UI 的来龙去脉，以及主动吸收上游的流程 |
| [docs/FIDELITY.md](docs/FIDELITY.md) | 与原插件的保真度审计 |
| [docs/RELEASING.md](docs/RELEASING.md) | 发布、校验和、源码包、代码签名、更新清单 |
| [CHANGELOG.md](CHANGELOG.md) | 全部版本的变更记录 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发流程与五条硬规则 |

## License

MIT —— 见 [LICENSE](LICENSE)。

上游 [pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio) 同为 MIT；
分叉自上游的部分的来源与许可见 [NOTICE.md](NOTICE.md)。
