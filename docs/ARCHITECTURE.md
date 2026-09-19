# 架构与实现笔记

本文记录这个项目是怎么搭起来的、为什么这么搭，以及一路上踩过的坑。

它最早是一份交付记录（[S1] Problem / [S2] Design / S3 Out of Scope / Tasks 勾选表）。那份计划完成之后，
勾选表就不再是信息、只是考古现场，**已经删掉**；本文只保留**现在仍然成立**的结论。缺陷的实测证据在
[`KNOWN-ISSUES.md`](KNOWN-ISSUES.md)，每个版本改了什么在 [`../CHANGELOG.md`](../CHANGELOG.md)。

- 面向使用者的说明：[`../README.zh-CN.md`](../README.zh-CN.md)
- 发布流程：[`RELEASING.md`](RELEASING.md)
- 与上游的对应关系：[`UPSTREAM.md`](UPSTREAM.md)
- 保真度审计：[`FIDELITY.md`](FIDELITY.md)
- 未结缺陷（含已排除的修法与下一步该测什么）：[`KNOWN-ISSUES.md`](KNOWN-ISSUES.md)
- 下一步做什么：[`ROADMAP.md`](ROADMAP.md)

## 形态

一句话：**一个 Electron 宿主，把 pi 的 CLI 包成桌面聊天客户端**。能力由 pi 提供（模型、工具、扩展、MCP、
会话文件），这个仓库负责窗口、界面，以及"把 pi 的输出变成人看得见的东西"。

```text
┌ Electron Main（Node）───────────────────────────────────────────────┐
│ main.ts            窗口生命周期、全部 IPC handler、菜单/托盘/单实例锁
│ chat-session.ts    会话编排：JSONL ↔ pi 子进程、消息路由、队列、遥测
│ rpc-client.ts      spawn pi --mode rpc；JSONL 读写、轮转日志、spawn 解析
│ chat-adapter.ts    装配聊天页：vendored bundle + chrome + vendor 库 + shim
│ sidebar.ts         会话列表侧栏      dock.ts      终端/文件/变更三个面板
│ palette.ts         命令面板          stats-panel.ts  token 面板
│ settings-window.ts 设置窗口（独立 preload；唯一能写 ~/.pi/agent/* 的窗口）
│ diff-window.ts     自己的 diff 视图，不走系统默认程序
│ sessions.ts        会话列表（异步、分片读、带缓存）  git.ts  分支/worktree/提交信息
│ terminal.ts        node-pty + ConPTY（pi TUI 或系统 shell）
│ navigation.ts      导航守卫（见下）  alerts/tray/updater/theme/i18n/config/log
├ Preload（contextBridge）─────────────────────────────────────────────
│ preload.ts         window.pi：postMessage / onMessage / invoke（白名单）/ 终端流
│ preload-settings.ts 设置窗口专用：配置文件读写、pkg、auth 登录
├ Renderer ────────────────────────────────────────────────────────────
│ studio/pi-chat/dist/index.html   vendored 聊天 UI（单文件，约 5.7 MB，不入库）
│ 注入：CHROME_CSS + 侧栏/标题栏/面板脚本 + vendor UMD 库（内联 13 个）+ shim
└─────────────────────────────────────────────────────────────────────┘
                  │ spawn + JSONL stdio（从不经 shell）
                  ▼
     pi --mode rpc ← -e studio/bridge/{todo,subagent,questionnaire,…}
```

## 关键路径

### 一次点击怎么变成一次回答

1. renderer（vendored 界面或我们的脚本）→ `window.pi.postMessage({ type })` → preload 按**类型表**映射到 IPC 通道；
2. main 的消息 handler → 找到该窗口的 `ChatSession`（主窗口一个，每个子窗口各一个，存于 `windowSessions`）
   → `session.handleMessage()`；
3. `chat-session` → `rpc-client` 写一行 JSONL 给 pi；pi 的事件流再一路回调回来；
4. 事件 → `postToWindow(win, msg)`（**类型 → 通道表**）→ 窗口；
5. 聊天窗口里，preload 的**单监听器**把每条消息重新派发成 window 的 `message` 事件，vendored 界面与我们的
   脚本都听它。

> 第 5 步那个"单监听器"是 1.2.3 那次"子窗口空白"的根因：谁后注册谁把前一个顶掉，而且**全程不报错**
> （标题照常更新、界面一条消息都收不到）。细节与取证见 `KNOWN-ISSUES.md`。

### 窗口与注入

聊天页不是静态文件：`chat-adapter.ts` 读入 vendored 的单文件 HTML，替换 `PI_*_PLACEHOLDER` 与 `__PI_FONTSIZE__`
一类占位符、注入我们的 chrome（标题栏/侧栏/面板）、vendor UMD 库与 `acquireVsCodeApi` shim，写进 `%TEMP%` 的
临时文件再 `loadFile`。子窗口用同一个装配器，但走**精简外壳**（拖拽条 + 对话；`PI_MINIMAL_CHILD=0` 可切回
完整外壳做对照）。

> vendor 库有**两份清单**：`scripts/copy-assets.mjs` 复制 15 个进 `dist/renderer/vendor`，
> `chat-adapter.ts` 的 `VENDOR_JS` 内联其中 13 个。改版本或新增库时**两边都要改** —— 只改一处不会报错，
> 只会让某个面板静默少一个能力。

**注入的是字符串**，所以有两道门禁盯着它们：`test/injected-scripts.test.cjs` 对每个注入脚本做
`vm.Script` 语法检查，`test/dom-contract.test.cjs` 守着 DOM 钩子 id 的契约。

### 安全边界

- 每个窗口都是 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`；
- **两个 preload 分开**：聊天窗口永远够不到配置/密钥通道（`test/ipc-channels.test.cjs` 做双向对账）；
- 页面 CSP 是 `default-src 'none'`（无远程源、无 `unsafe-eval`）；`script-src` 带 `unsafe-inline`，因为脚本
  是内联的 —— 这是**已知取舍**（见 `SECURITY.md`：靠 `esc()` 与 `markdown-it html:false`，不是靠 CSP）；
- `pi:fs-*` 限制在 workspace 根内，且**做 realpath/symlink 复核**（`fs-path.ts`）；
- `pi:open-file` 拒绝 UNC/设备路径与可执行扩展名（`config.ts` 的 `checkOpenPath`）；
- **导航守卫**（`navigation.ts`）：任何窗口都不许离开本应用装配的页面 —— `will-navigate` 一律取消、
  `window.open` 一律拒；`http(s)`/`mailto` 交给系统浏览器；`file:` 直接拒且**不转交 shell**（否则等于绕开
  `checkOpenPath`）。没有这道守卫时，点一条模型写出来的链接会让窗口**自己**导航走，而 Electron 会在每次
  导航后重新注入 preload —— 远端页面就此拿到 `window.pi`，而它的白名单里有 `pi:term-input` 与 `pi:fs-write`。

### 配置与状态放在哪

| 东西 | 位置 | 谁写 |
| --- | --- | --- |
| 应用配置（外观、预算、提醒、工作区、语言…） | `~/.pi/standalone/config.json` | **只有设置窗口**（`preload-settings.ts`） |
| 会话文件 | `~/.pi/agent/sessions/**/*.jsonl` | pi 自己写；应用只列举与恢复 |
| 密钥 / provider 凭据 | `~/.pi/agent/auth.json` | pi；应用只读，回传渲染层时**打码**，保存时把真值还原 |
| 窗口位置与会话-窗口绑定 | `userData/session-windows.json` | 主进程（启动恢复用） |
| 遥测（token/成本/每日花费） | userData 下每会话一份 JSON | 主进程统计器（`stats.ts` + `stats-store.ts`） |

`StandaloneConfig` 的形状**不在这里抄第二份** —— 抄了必然漂。唯一权威是 `src/shared/types.ts`。

## 打包与运行

- `npm run build`：`tsc` → `dist/`，再由 `scripts/copy-assets.mjs` 复制 renderer 占位页与 15 个 UMD 库；
- `studio/pi-chat/dist/index.html` 是**构建产物且不入库**：新克隆先 `npm run build:renderer`（需要网络）；
- `npm run dist`：electron-builder 产出 portable + NSIS 到 `dist-electron/`；
- asar 内容由 `package.json` 的 `files` 白名单决定，`scripts/check-package.cjs` 在 CI 里断言 13 条运行时路径
  一条不少、且不含 `src/`。

## 一路上真正值钱的坑

1. **注入要按行匹配结构性标签**：vite singlefile 的 HTML 里，JS 字符串内部同样出现 `</head>`，用
   `String.replace` 找第一次出现会插错位置。
2. **不要写 `!**/*.ts` 这种全局排除**：electron-builder 的 `files` 是全局的，会把 vendored 的 TS 资产一起删掉；
   要精确排除，或在后面 re-include。
3. **`acquireVsCodeApi` shim**：`window.dispatchEvent(new MessageEvent('message', { data }))` 就能对接 vendored
   界面的 `window.addEventListener('message')`，不必改上游源码。
4. **子进程退出时不要置 `disposed = true`**：那会永久锁死恢复路径；只标 `rpcAlive = false` 并允许 reload。
5. **Electron 下载走镜像**（`npmmirror.com/mirrors/electron/`）能大幅提速，缓存可复用。
6. **Electron 会把 preload 注入窗口的每一次导航** —— 所以需要上面那道导航守卫。
7. **`ELECTRON_RUN_AS_NODE` 会让 Electron 静默以 Node 模式启动**：任何启动 Electron 的脚本都要
   `env -u ELECTRON_RUN_AS_NODE`（本机脚本与门禁都依赖这一点）。
8. **Chromium 会节流被遮挡的窗口**：过渡停在半路、xterm 的写入可能不刷 DOM、`innerText`（依赖布局）整页为空。
   任何"读渲染结果"的门禁都必须先把窗口提到前台、并读级联值而不是动画帧 —— 否则量到的是门禁自己的假象
   （这条踩得很贵，见 `KNOWN-ISSUES.md` 里两个已结案的条目）。

## 明确不做

| 事项 | 原因 |
| --- | --- |
| 换成另一个 UI 框架重写 | 现有外壳的问题都是可定位的具体缺陷，重写换不来这些缺陷的解决 |
| 在应用里内建 pi 的能力（模型路由、工具编排） | 边界很清楚：能力由 pi 提供，我们负责宿主 |
| 为"看起来功能多"而加的面板 | 每加一个面板就多一份轮询与内存（1.2.1 吃过一次亏） |
| macOS / Linux | 成本不在写代码，而在三套系统上把终端、托盘、标题栏、自更新真机验一遍（见 `ROADMAP.md`） |

> 这份"不做"清单此前还写着**终端 TUI、Git 提交信息生成、自动更新、多窗口**。它们后来都实现了
> （`terminal.ts`、`git.ts`、`updater.ts`、`openSessionWindow`），因此从这里删掉 —— 留着会让读它的人
> 以为这些能力不存在。
