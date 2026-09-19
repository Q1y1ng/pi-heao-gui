# 竞品对标与未完成清单（2026-09-18）

一份把**外面那一代 agent GUI 已经做到什么程度**、我们**已经有什么**、以及**还缺什么**摊在同一张表上的报告。
`docs/ROADMAP.md` 只对比过十来个 pi 桌面客户端；这份报告的对比面扩到**整个 coding-agent GUI 品类**
（官方桌面端 / 编排型 GUI / 代理总管三类），因此多了两族之前没进过清单的缺口：**编排层**与**远程协同面**。

本轮与已有内容的关系写在第 4 节：**ROADMAP 已有的一律不重复**，只登记新增与细化。

---

## 1. 摘要

- **单机、单 agent 的深度，我们不落下风。** 会话管理、全文搜索、rewind + diff、worktree 切换、
  权限门、扩展/技能/MCP、成本与 token 面板、提醒与托盘未读、中英双语、自动更新、23 个测试文件的门禁 ——
  这些在竞品里往往是"付费版才有"或"大版本才补"的东西，我们 1.2.x 已经全有。
- **缺的是"从一个人用一个 agent"到"一个人管一群 agent"那一层。** 竞品的入场券是
  **并行 + 每个任务一个隔离工作区 + 一块看板 + 审阅合并**；我们现在有 *多窗口*，但没有 *编排* ——
  两者差的是"分派"与"总览"，不是窗口数量。
- **第二族缺口是"走出这台机器"**：远程/移动/IM/云端交接，我们一个都没有（只在内置浏览器一类项上
  正面撞到安全模型）。竞品里这已经是常规配置（Discord 远程、手机控制、云 handoff）。
- **本报告给出的未完成清单**：**P0 4 项 / P1 6 项 / P2 1 项**（另有 **8 项暂不排期**与跨平台单独立项）。
  其中 ROADMAP 既有 13 项、`KNOWN-ISSUES` 两条仍开项，其余为新增（编排 3 + 导入 1）。
- **导出有、导入没有**：会话导出已是现成功能（工具栏 `tb.export` + `/export` 命令），实缺的只有**导入**。
- **2026-09-12 审计的欠债已经还完**：本轮把当初记为“残留”的 6 条逐条现场复核，**全部已修**（详见 §4 末尾）。

---

## 2. 对标对象（2026 年 9 月的市场形态）

**A 类 · 官方桌面端**（厂商自己把 CLI 包上桌面）

| 产品 | 桌面端 | 对我们的参照价值 |
| --- | --- | --- |
| **Claude Code Desktop** | macOS / Windows | 官方把"历史搜索、多项目标签、图片附件、就地代码审阅、内嵌终端"当成 CLI 的**必要补充** —— 正好是我们已有的那一半 |
| **Codex desktop app** | macOS / Windows | **并行 agents + 内置 worktree 支持**；把"跑多个任务"做成一等公民 |
| **Cline Desktop** | 跨平台（开源） | 开放权重模型、**并行 AI agents**、300+ 模型、插件 / MCP / skills —— 开源阵营里形态最接近"平台"的一个 |

**B 类 · 编排型 GUI**（包住别人的 CLI，卖点就是编排层）

| 产品 | 关键能力 |
| --- | --- |
| **Conductor**（macOS 原生 SwiftUI） | 多 agent 编排、上下文管理、**成本控制**、非 Electron |
| **Conduit**（键盘优先 TUI + 本地 web） | git 支持的工作区（`worktree` / 完整 `checkout` 两种模式）、**会话持久化与外部会话导入**、build/plan 模式、最多 10 个并发标签 |
| **Tessera** | 项目 / 集合 / 会话 / 标签 / 分屏；同一会话可 **PTY 与富 GUI 并排** |
| **Acepe**（Rust/Tauri） | 编排 → 审阅 → **git flow → 提 PR** 的整条链 |
| **Parallel Code** | 每个 agent 一个 worktree，**审阅 diff、择优合并**；MIT |
| **Vicoa** | 一块板看所有 agent 的实时状态；每个 agent 独立 worktree |
| **Vibe Kanban** | 看板 + 10 个以上 agent；只包原生斜杠命令，不自造交互 |
| **Crispy** | **superthink 对抗式复核**、agent memory、Discord 远程访问 |
| **CodeConductor** | Electron 聊天界面，桌面 + web 双模式 |

**C 类 · 代理总管**：Agent-Manager / Pane / Golutra（多 CLI 代理并行管理）、
ClawTab（tmux 之上，**手机控制**）、Omnara / Polyscope / Superconductor（代理无关的编排层）。

**共同点（= 2026 年的入场券）**：并行、每个 agent 一个隔离工作区（worktree / VM / 容器）、
实时可视化、审批与改向、diff 审阅与合并、成本与用量可见。
**分水岭**：把它们串起来看，竞品争的不是"界面好不好看"，而是"**你能不能同时推进几件事而不失控**"。

---

## 3. 能力矩阵（我们 vs 竞品主流）

证据列给的是本仓库的模块名（`src/main/*.ts` 等），全部可在仓库内核对。

### 3.1 已经有的（竞品普遍也有，我们不缺）

| 能力轴 | 竞品代表 | 我们 | 证据 |
| --- | --- | --- | --- |
| 会话管理（建 / 重命名 / 删除 / 归档 / 全文搜索） | 几乎所有 | ✓ | `session-ops.ts` `search.ts` `sessions.ts` |
| 拖出成窗、多窗口 | Claude Code Desktop、Tessera | ✓ | `openSessionWindow`（1.2.1 起） |
| 内嵌终端 | Tessera（PTY + GUI 并排）、Claude Code Desktop | ✓ | `terminal.ts` + vendored xterm.js |
| 权限门 / 审批 | 全部 | ✓ | `permission-gate` 桥 + 设置窗 |
| diff 审阅 / rewind | Conductor、Parallel Code | ✓ | `diff.ts` `diff-window.ts` + rewind 接受/回退 |
| **worktree 隔离** | **编排类核心能力** | ✓（1.2.3） | `git.ts` + 变更面板下拉 |
| 成本 / 预算可见 | Conductor、Codeep | ✓ | `stats.ts` `stats-store.ts` + 预算提醒 |
| token 面板（首 token 延迟 / 解码速度 / 缓存命中 / 推理 token） | 少数 | ✓ | `stats-panel.ts` |
| 提醒 / 托盘 / 未读角标 | 少数 | ✓ | `alerts.ts` `tray.ts` |
| 扩展、技能、MCP | Cline、Codex（插件市场） | ✓ | `bridge-extract.ts` `dock.ts` |
| 主题 / 强调色 / 多语言 | 少数 | ✓ | `theme.ts` `i18n.ts`（中英） |
| 自动更新 | 少数 | ✓ | `updater.ts` + `latest.yml`（1.2.3 已发布） |
| 测试 / lint / CI 门禁 | 少数开源项目 | ✓ | 23 个 `test/*.cjs`、`biome.json`、`.github/workflows` |

### 3.2 还没有的（按族归类）

| 能力轴 | 竞品代表 | 我们的状态 | 备注 |
| --- | --- | --- | --- |
| **并行多 agent 编排**（同一仓库同时推进多个任务） | Codex app、Cline Desktop、Vicoa、Parallel Code、Conductor | ✗ **多窗口 ≠ 编排** | 缺的是"分派"与"总览" |
| **每任务一个 worktree 的分派** | Parallel Code、Conduit、Vicoa | ⚠️ 只能**手动**切 worktree | 我们已有切换与隔离，缺一键"新 worktree 新会话" |
| **并行状态看板** | Vicoa、Vibe Kanban、Tessera | ✗ | 现在靠拖出成窗 + 托盘角标 |
| **PR / 合并流程** | Acepe、Parallel Code | ✗ | 全仓库 0 处 `gh pr` / octokit |
| **会话导入**（**导出已有** ✓：工具栏「导出当前会话」+ `/export` 命令，pi 侧还有 `--export` 转 HTML） | Conduit（外部会话导入）、Tessera | ✗ **只缺导入** | 换机 / 从别处搬会话 |
| **远程访问（web / 手机 / IM）** | ClawTab（手机）、Crispy（Discord）、Cline Desktop（web 模式） | ✗ | ROADMAP 只把"消息渠道"列为 P2-13 |
| **云端交接（本地 ↔ 云）** | Claude Code / Codex（托管云） | ✗ | 与 pi 的边界有关，先看上游 |
| **agent 持久记忆（跨会话）** | Crispy（agent memory） | ✗ | 与 pi 的能力边界重叠 |
| **对抗式自我复核** | Crispy（superthink） | ⚠️ pi 侧有 subagent，GUI 未形成产品面 | `chat-session.ts` 只挂了 subagent 目录 |
| **多项目工作区** | 几乎所有（项目列表 + 分组） | ✗ | ROADMAP P1-5 |
| **图片 / 音频 / PDF / DOCX 预览** | Claude Code Desktop（图片附件）等 | ✗ | ROADMAP P1-4 / P1-7 |
| **跨平台（macOS / Linux）** | 多数竞品至少 macOS | ✗ | ROADMAP 单独立项 |

---

## 4. 未完成清单（合并去重后，按性价比分档）

**排序规则沿用 `ROADMAP.md`**：性价比 = 用户价值 × 可验证性 ÷ 成本；
动安全边界的降级；未知成本先做一次决定性测量。来源标注：`RM` = ROADMAP 既有条目，
`AU` = 2026-09-12 审计残留，`新` = 本报告新增。

### P0 —— 成本小、价值高、能立刻验证（4 项）

| # | 事项 | 来源 | 为什么是 P0 | 验收标准 |
| --- | --- | --- | --- | --- |
| 1 | **图片与音频预览** | `RM` P1-4 | 现在只能“用系统程序打开”；图片与音频在应用内显示不需要新依赖 | e2e：PNG 与音频文件在面板内出现对应元素；非图片/音频仍走原有编辑器路径 |
| 2 | **待决策事项汇总面板**（把提示音闭环成工作流） | `RM` P1-6 | `dialog` 已是“有人在等你”的唯一信号，而 `alerts.ts` 已经把信号那一半做完了；剩下的是收集 + 一个列表 UI，成本比当初估的低 | e2e：制造一个待确认请求 → 面板出现条目 → 点击跳回对应会话窗口 → 应答后条目消失 |
| 3 | **侧栏作用域里看不到我们的主题 token** | `KI` | 已实测定位、**仍未修**；它和字号那次是同一类形状 —— “赢下这个变量的不是我们写的声明” | 设计器/实测：侧栏元素能取到 `--pi-*` 的实际值；暗、亮两套主题都过对比度门禁 |
| 4 | **`e2e:isolated` 的窗口查找不稳** | `KI` | 门禁不稳 = 每轮都要人肉判断“这是真失败还是又抽了” | 连跑 5 次全绿；失败时输出里能直接看出是哪一步 |

> **关于 2026-09-12 审计的欠债**：本轮把当初记为“残留”的 6 条逐条现场复核，结论是**全部已收口** ✓ ——
> `rpc-client` 已改成**异步 + 轮转**日志（源码自己的注释就写着 *never blocks the main process*）；
> 占位页已改用 **nonce 化的 CSP**（`script-src 'nonce-pi-standalone'`，注释里还写着当初那个“`default-src 'self'` 会拦掉自己的内联标签”的发现）；
> `destroyTray` **已经在 `main.ts:2457` 被调用**，并且有 `before-quit` 清理点；
> 上游 provenance 已经落在 **`docs/UPSTREAM.md`**（含 fork 版本 1.3.8 与 commit `8c50c0aa…`，路径也从当初的 `vendor/upstream` 改成了本项目自有的 `studio/`）；
> `findPiBinary` 的解析已有 **`pi-cli.ts` + `test/spawn-resolver.test.cjs`** 覆盖。
> **所以 P0 里不再有审计债务** —— 账还完了，剩下的是新功能与两条仍开的缺陷。

### P1 —— 价值高，但比 P0 重（6 项）

| # | 事项 | 来源 | 为什么 | 验收标准 |
| --- | --- | --- | --- | --- |
| 9 | **多项目工作区** | `RM` P1-5 | 现在每个窗口一个 `workspaceRoot`，靠多窗口勉强够用 | 单测：项目存储与去重；e2e：加两个项目切换，会话列表与终端 `cwd` 跟随 |
| 10 | **一键"新 worktree + 新会话"**（编排的第一步） ✓ **已完成** | `新` | 我们已有 worktree 切换与隔离，**只差分派**；这是与竞品差距最大的一格中成本最低的一步 | ✓ e2e（隔离档）：面板里输入分支名 → 一键建出工作副本并在**新窗口**里开会话 → 断言新副本在磁盘上、窗口标题就是分支名、**那个窗口的 pi 真的以新目录为 cwd 启动**、面板下拉里也列出了它 |
| 11 | **并行状态总览**（轻量看板：所有会话/窗口的状态 + 谁在等你） | `新` | 竞品靠这块板把"多任务不失控"立住；我们可以先做只读版 | e2e：两个会话同时运行，板子上两行状态正确 |
| 12 | **会话导入**（导出已有 ✓：工具栏按钮 + `/export`） | `新` | Conduit、Tessera 都有导入；换机、从别处搬会话要用 —— 导出那一半我们**已经做完**（`tb.export` + `chat-adapter.ts:698` 的「已导出到:」） | 单测：解析外部 jsonl；e2e：导入后出现在列表并可打开 |
| 13 | **PDF / DOCX 预览** | `RM` P1-7 | 读文档不用离开应用 | 先量化加载体积与内存增量，再决定做不做 |
| 14 | **agent 持久记忆（跨会话）** | `新` | Crispy 已把它当卖点 | 先确认 pi 原生提供什么，避免在宿主里重造 |

### P2 —— 只有一项值得现在排（1 项）

| # | 事项 | 来源 | 为什么 |
| --- | --- | --- | --- |
| 15 | **运行中断恢复（重开接着跑）** | `RM` P2-8 | 唯一一项“用户会真的撞上、而且做完能立刻用”的：落盘的只能是 pi 的进行中状态，恢复时要处理“上游已变”的冲突；价值中，但真实 |

### 暂不排期（本报告的建议，8 项）

ROADMAP 把这些留在 P2；按“现在还值不值得做”再过一遍后，**建议暂不排期** ——
不是否定它们，而是排到**编排层之后**再看：

| 事项 | 来源 | 暂缓的理由 |
| --- | --- | --- |
| 窗口内标签页（同窗多会话） | `RM` P2-10 | 与“拖出成窗 + 窗口上限 + 会话独占写者”模型冲突，要重新设计仲裁 —— 而多窗口已经能顶用 |
| 自定义主题文件 / 主题市场 | `RM` P2-9 | 已有主题 + 任意强调色，收益偏外观 |
| 内置浏览器 / 共享浏览器 | `RM` P2-12 | **动安全模型**：等于新增“渲染不可信远程内容”的面，必须有单独设计的边界 |
| 消息渠道（Telegram / 微信 / 飞书 / Discord） | `RM` P2-13 | 每接一个渠道都要凭据管理、权限模型、失败可见性 |
| 远程 / 手机访问 | `新` | 与上一条同源，形态更重（要设计远程鉴权与服务端） |
| PR / 合并流程 | `新` | 依赖 gh / 凭据与评审交互；**先把编排做出来才有意义** |
| 云端交接（本地 ↔ 云） | `新` | 受 pi 上游能力边界约束 |
| Agent 舰队 / 受管进程面板 | `RM` P2-11 | 属“多 agent 编排”，先看清 pi 自身的规划 |

### 单独立项 —— 跨平台（macOS / Linux）

最大的一条缺口，也是本机价值最低的一条（`RM` 已论证）：成本不在写代码，而在三套系统上把
终端、托盘、标题栏、自更新**真机验一遍**。建议先做可行性测量（mac/linux 上能否跑通 `npm test` + `e2e:isolated`）。

---

## 5. 与已有内容的关系（不重复造）

| 已有内容 | 本报告的处理 |
| --- | --- |
| `docs/ROADMAP.md`（13 项 + 跨平台单独立项 + "明确不做"） | **全部保留**；仅把 P1-6 建议提到 P0，并补上它"两半已实现"的成本证据 |
| `docs/KNOWN-ISSUES.md` | 两条已随 1.2.3 关闭（精简子窗口、字号）；**两条仍开**：主题 token 在侧栏作用域不可见、`e2e:isolated` 的窗口查找不稳 |
| 2026-09-12 全面审计（P0 3 / P1 6 / P2 7 / P3 9） | P0 与 P1 **全部收口**；P2-13 超时已补（dispose 判定待确认）；当初记为“残留”的 6 条本轮**逐条现场复核，全部已修**（见 §4 末尾）。本报告因此不再登记审计债务 |
| "明确不做"（重写 UI、把 pi 的能力内建、为好看而加面板） | **继续不做**；本报告新增项均不触碰这三条 |

---

## 6. 建议的下一步（一次一批，每批带门禁）

- **批次 A · 缺陷清零**：P0-3 侧栏主题 token、P0-4 `e2e:isolated` 不稳 —— 都是已定位的缺陷，小改 + 测试即可把 `KNOWN-ISSUES` 清空。
- **批次 B · 体验补齐**：P0-7 图片/音频预览、P0-8 待决策面板 —— 都能直接由 e2e 断言。
- **批次 C · 编排第一步**：P1-10 一键"新 worktree 新会话" + P1-11 只读状态总览。
  这是与竞品差距最大的一格，但只需先跨半步。
- **批次 D · 之后的唯一一项**：P2-15 运行中断恢复（重开接着跑）—— 其余 8 项按上面的理由暂不排期。

每批的验收沿用仓库既有标准：**有测试**（纯逻辑进 `test/*.test.cjs`，用户可见行为进 `scripts/e2e.cjs`）、
**有实测数字**、**文档同步**（`CHANGELOG` 写用户能感知的变化，没修好的进 `KI` 并写清已排除什么）。

---

## 7. 参考（外部，本轮检索，2026-09）

- Claude Code GUI 对比（CLI vs 官方桌面端 vs IDE 插件 vs 自托管）：`opencockpit.dev`
- Claude Code / Codex / opencode 三类代理对比与决策表：`alekseialeinikov.com`
- Best AI Coding Agents 2026（15 个工具，含平台/开源/自主性/定价表）：`nimbalyst.com`
- 四家代理源码架构对比（Claude Code / Codex CLI / Cline / OpenCode）：`gist.github.com/Haseeb-Qureshi`
- Codex / Claude Code / OpenCode 的 harness 层对比（配置、插件市场）：`ai.rundatarun.io`
- Cline Desktop 发布说明（开源、开放权重、并行 agents）：`cline.ghost.io`
- 编排型工作区：`vicoa.ai/features`、`github.com/horang-labs/tessera`、`github.com/flazouh/acepe`、
  `parallelcode.app`、`github.com/conduit-cli/conduit`、`github.com/MeriaApp/conductor`、
  `github.com/TheSylvester/crispy`、`github.com/yusei531642/vibe-editor`、`github.com/zhu1090093659/CodeConductor`
- 代理总管与多 CLI 编排：`developersdigest.tech`、`clawtab.cc`、`broomva.tech/writing/agent-cockpit-wars`、
  `agentscodex.com`、`superset.sh/compare/best-agentic-ide`
- 本仓库既有对比样本（pi 桌面客户端）：见 `ROADMAP.md` §参考
