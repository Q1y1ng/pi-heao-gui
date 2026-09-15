# 多页面（拖出窗口）与操作提醒 —— 设计方案

面向两个新需求：

1. **多页面**：像浏览器一样，把侧栏历史会话里的条目**拖出来**变成独立子窗口，同时操作与观察多个会话。
2. **操作提醒**：需要**确权/提权**（要人做决定）以及**任务结束**时发出提示音。

本文是**调研结论 + 实施方案**，不是承诺的功能列表。所有"现状"结论都带 `文件:行号`，可自行复核。

---

## 一、调研结论

### 1. 多窗口：地基已经存在，缺的是入口手势

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| 从会话开新窗口 | **已有** | `openSessionWindow(sessionFile)` — `src/main/main.ts:404` |
| IPC 通道（含会话文件校验） | **已有** | `ipcMain.handle("pi:open-session-window")` — `src/main/main.ts:536` |
| 右键菜单入口 | **已有**（"在新窗口打开"） | `src/main/sidebar.ts:773` |
| 通道白名单 | **已有** | `src/preload/preload.ts:67` |
| 每窗口独立 pi 会话 | **已有**（`windowSessions: Map<webContentsId, ChatSession>`） | `src/main/main.ts:139`、`sessionFor()` `:185` |
| 子窗口不会误用主窗口会话 | **已有**（未就绪时返回 `null` 而非回退） | `src/main/main.ts:191` |
| 子窗口独立 dock/终端 | **已有**（按窗口 id 释放） | `src/main/main.ts:396`、`:470` |
| **会话项可拖拽** | **缺失**（全仓只有"拖文件进输入框"） | `src/main/sidebar.ts:1015-1032` |
| 窗口位置跟随鼠标 / 窗口恢复 / 窗口菜单 | **缺失** | — |
| 未读计数 | **是全局变量**（多窗口会混淆） | `src/main/tray.ts:88` |

**外部调研**：Electron **没有**原生"把标签拖出成窗"的 API —— 官方 issue
[electron#47854 `window.beginDrag()`](https://github.com/electron/electron/issues/47854) 仍是 open；
`tabbingIdentifier` / `moveTabToNewWindow()` / `new-window-for-tab` **全部是 macOS only**，Windows 用不上。
所以只能自己实现：HTML5 DnD + 主进程判定"松手点是否在窗口外"。

### 2. 操作提醒：事件源只有一个，声音只能自己发

| 事项 | 现状 |
| --- | --- |
| 任务结束事件 | `agent_settled` — 已在 `sessionHost().postToRenderer` 里挂钩：`src/main/main.ts:509-517` |
| 结束时的现有提示 | toast（`silent:false`）+ 全局未读 +1 + `flashFrame`，**但仅当该窗口未获得焦点** |
| 确权/提权事件 | `handleExtUiRequest()`：`select`/`confirm`/`input`/`editor` → `post({type:'dialog'})` — `src/main/chat-session.ts:391-400` |
| 其他"要人管"的时刻 | `notify` → toast（error/success/info）`chat-session.ts:405`；项目信任提示；MCP 状态 |
| 自定义提示音 | **完全没有**；`showNotification()` 只发系统 toast — `src/main/tray.ts:208` |

**外部调研**：

- **主进程没有音频 API** —— 想在主进程播音必须走渲染层 IPC，或引入原生插件（如
  `node-miniaudio`），后者多一个原生依赖，不值得。
- `Notification.sound` **仅 macOS 有效**；Windows 想自定义 toast 声音只能自己写 `toastXml`
  （Electron 支持，但等于自己维护一份 XML，重）。
- Windows 的**专注助手/勿扰**会连系统 toast 的音一起静音 → 只依赖系统音**不可靠**。
- **结论**：提示音在**渲染层用 Web Audio 合成**（`OscillatorNode` + `GainNode` 包络），
  **零音频素材**、可调音色、不受 toast 静音影响。

---

## 二、方案 A：多页面

### A1 拖出手势（核心新增）

1. 会话项加 `draggable="true"`；`dragstart` 里
   `e.dataTransfer.setData('application/x-pi-session', file)`，并设一个"会话名小卡片"作为拖拽图像。
2. `dragover` 时不阻止默认（让浏览器进入"移动"态），侧栏加 `.dragging` 视觉态。
3. `dragend` 时把**屏幕坐标**（`e.screenX/e.screenY`）与当前窗口边界交给主进程判断：
   - 在窗口内 ⇒ 什么都不做（或按 A2 的排序 / 分组语义处理）；
   - 在窗口外 ⇒ `pi:open-session-window` 带 `{ screenX, screenY }`，新窗口**落在鼠标处**。
4. 主进程侧用 `screen.getDisplayNearestPoint()` 做多显示器/DPI 修正，再用 `win.setBounds()` 定位。
5. 可选增强：拖到屏幕边缘时给"贴边半屏"预览（先不做，容易变成另一个大工程）。

> 备选（更省事、体验略差）：不动 DnD，只在右键菜单与 `Ctrl+Shift+N` 上做文章。
> 但需求明确说"拖出来"，所以按上面做。

### A2 子窗口要补齐的东西

- **同一会话只允许一个可写窗口**（**硬性**）：pi 的会话是 `~/.pi/agent/sessions/*.jsonl`，
  两个 RPC 同时写同一份会互相覆盖。策略：
  - 该会话已有窗口 ⇒ `focus()` 已有窗口，并提示"该会话已在另一个窗口打开"；
  - 想"只观察"时提供只读窗口（后续可选，第二批不做）。
- **窗口恢复**：退出时把打开的窗口与其会话写入 `~/.pi/standalone/windows.json`，
  下次启动恢复（可开关，默认开）。
- **窗口菜单 / 列表**：托盘菜单列出已打开的窗口（"窗口 → 会话名"），可聚焦/关闭。
- **`Ctrl+Shift+N`**：以当前会话开新窗口。
- **窗口标题**：跟随会话名（现在建窗时设了一次标题，之后不更新）。
- **未读计数按窗口**：`tray.ts` 的全局 `unread` 改为 `Map<windowId, number>` 再求和，
  否则子窗口完成会污染同一个计数。

### A3 边界与风险

- **重复窗口写同一会话** —— 见 A2，必须拦住。
- **多显示器 + DPI 缩放** —— 拖拽坐标是逻辑像素，`setBounds` 用 DIP；用 `screen` 模块换算。
- **主窗口关闭后子窗口的去留** —— 现状是每个窗口各自 dispose；需确定"主窗口关闭是否退出应用"
  的产品语义（建议：子窗口还在就不退出，全部关闭才退出，与浏览器一致）。
- **每个窗口一份临时 HTML**（`writeTempHtml("pi-heao-child")`）—— 退出清理要覆盖所有窗口。

---

## 三、方案 B：操作提醒

### B1 事件源（都在主进程，已定位）

```ts
// 任务结束：src/main/main.ts:509（现有钩子，扩展即可）
m.type === "event" && m.event?.type === "agent_settled"

// 确权/提权：src/main/chat-session.ts:391（新增钩子）
req.method === "confirm" | "select" | "input" | "editor"  →  发 { type: "dialog" }
```

`dialog` 就是"有人在等一个决定"的**唯一信号** —— 确权（危险命令确认）、提权（权限模式变更）、
信任提示都经它。挂钩点天然唯一，不需要散点埋。

### B2 声音怎么发

- **合成音**：一段 3 音上行提示（约 180ms）用于"任务结束"，一段两音下行用于"要你做决定"，
  由 Web Audio 现场合成，**不引入任何音频文件**。
- **承载窗口**：一个隐藏的 notifier 窗口（`show:false` + `webPreferences.offscreen` 或最小尺寸），
  页面内只有播放函数。这样**主窗口最小化/全部隐藏时也能响**；
  比"随便挑一个活着的聊天窗播放"更可靠。
- **系统级兜底**（不依赖我们自己的音频）：系统 toast（`silent:false`）+ `flashFrame(true)`
  - `setOverlayIcon`（任务栏角标）。
- **去抖**：`minIntervalMs` 默认 1500ms；多会话同时完成时合并为"3 个会话已完成"，只响一次。

### B3 策略

| 事件 | 何时响 | 次数 |
| --- | --- | --- |
| 任务结束 | 该窗口未聚焦（或应用不在前台）+ 不在静音期 | 1 次 |
| **确权/提权** | 无论是否聚焦（人在等 ⇒ 必须知道） | 最多 3 次，间隔 5s，直到被应答 |
| 项目信任 / MCP 认证 | 同确权 | 最多 3 次 |
| 静音 | 托盘"静音 30 分钟"开关（检测不到 Windows 专注助手，只能自己给开关） | — |

### B4 配置

```jsonc
// ~/.pi/standalone/config.json 新增
"alerts": {
  "enabled": true,
  "sound": "chime",        // "chime" | "system" | "off"
  "volume": 0.6,
  "onTurnEnd": true,
  "onApproval": true,
  "onTrust": true,
  "minIntervalMs": 1500
}
```

设置窗新增"提醒"分区（与"外观"同级），含试听按钮。

---

## 四、分批实施

每批都能独立验证、独立发布；任何一批出问题都能单独回滚。

| 批次 | 内容 | 主要文件 | 规模 |
| --- | --- | --- | --- |
| **1** | 提醒基础设施：合成音 + notifier 窗口 + 配置项 + 设置 UI + 任务结束用上 | `tray.ts` / 新 `alerts.ts` / `config.ts` / `settings-window.ts` / `main.ts` | ~250 行 |
| **2** | 确权/提权提醒（`dialog` 钩子 + 高优先级策略）+ 未读计数按窗口 | `chat-session.ts` / `main.ts` / `tray.ts` | ~120 行 |
| **3** | 会话项拖拽 + 拖出开窗（含鼠标定位、窗口内不做任何事） | `sidebar.ts` / `main.ts` | ~220 行 |
| **4** | 窗口恢复、窗口菜单、`Ctrl+Shift+N`、同会话防重复窗口 | `main.ts` / `tray.ts` / 新 `windows-state.ts` | ~260 行 |

## 五、验证方式

- **单测**（`node --test`，纯函数好测）：
  - 提醒决策：给定（事件、窗口焦点、静音截止时间、距上次响的毫秒数、去抖窗口内的完成计数）
    → 断言"响 / 不响 / 合并文案"。
  - 窗口注册表：同会话已有窗口 → 返回既有窗口而不是新建。
- **e2e**（`scripts/e2e.cjs` 新增段落）：
  - 用合成 `dragstart`/`dragend` 事件 + 直调 IPC 两条路径，断言新窗口出现且标题含会话名；
  - 提示音断言"是否被调用"，通过**可注入的播放器**（测试里换成记录器）而不是真的发声。
- **手工**：真拖拽（含拖到第二显示器）、两个会话并排跑、确认对话框出现时是否有声与角标。

## 六、已知风险

1. **自研 DnD 的跨显示器/DPI 细节** —— 最容易出问题的地方；先做单显示器正确，再多屏打磨。
2. **同一会话双写** —— 必须用 A2 的防重复拦住，否则会损坏会话文件。
3. **提示音被系统静音** —— 已用"渲染层合成音 + toast + 闪烁 + 角标"四重兜底。
4. **`e2e:isolated` 在本机需要真实控制台** —— 涉及终端的检查在无控制台环境会崩（见
   `docs/KNOWN-ISSUES.md` 同级的运行说明），新段落不要依赖终端面板。
