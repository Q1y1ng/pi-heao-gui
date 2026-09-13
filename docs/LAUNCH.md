# 发布文案（可直接复制）

发之前先确认两件事：**签名**（SignPath 申请中）与**英文 README**（`README.md`（英文版现为默认）已就位）。
未签名时请务必在文案里主动说明 —— 被人自己撞上 SmartScreen 而没被事先告知，是差评的主要来源。

一条纪律：**每个渠道只发一次**，回帖优先于发帖。有人在评论里提问，答复比再发十个板块有用。

---

## A. pi 本体的 Discussions（首选，最精准）

> 受众：已经在用 pi 的人。**不要**贴到泛 AI 板块去。

**标题**

```
Show & tell: Pi Heao GUI — a Windows desktop client for pi (built on the pi-agent-studio chat UI)
```

**正文（英文）**

```markdown
I use pi daily but wanted it in a real window instead of a TUI, and I'm on Windows —
so I built the shell I wanted, and it grew into something I'd actually recommend.

**Pi Heao GUI** — https://github.com/Q1y1ng/pi-heao-gui

- The chat UI is not a reimplementation. It's the same UI as the
  [pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio) VS Code extension
  (MIT), now maintained in this repo as its own code. Change is deliberate, not a rebase treadmill.
- Standalone Electron shell: a real terminal (PTY, tabs), a file browser, and a git dock
  (status / diff / commit) so you don't have to leave the window.
- Installer + portable exe, auto-update, command palette, Chinese/English UI.
- It drives the **real** `pi` CLI over its RPC surface — it doesn't embed a model and it
  doesn't keep a second copy of your credentials or sessions.

**Honest caveats before you click:**

- Not code-signed yet (SignPath Foundation application in progress), so SmartScreen will
  warn on first launch. SHA-256 sums are on the release page.
- Windows only. macOS/Linux users: this is not for you yet, and I'd rather say so up front.
- The ceiling on the experience is pi's — the shell doesn't fix or extend pi's behaviour.

Screenshots and a feature tour are in the README. Issues and "this is broken on my machine"
reports are genuinely welcome — I fix what I can reproduce.
```

---

## B. 那个 VS Code 扩展的仓库（它的人就是字面意义的受众）

> 语气要客气：**不要**说"你的扩展不好用"，而是"我做的是另一种形态"。

**标题**

```
Desktop (Electron) build of this chat UI — would you link it?
```

**正文**

```markdown
Your extension is the reason I use pi's chat UI at all. I wanted the same thing without
VS Code in the loop (and with a real terminal / git dock beside it), so I built a standalone
Windows Electron shell around the same UI code, with the MIT attribution kept and your repo
credited in NOTICE.

It lives here: https://github.com/Q1y1ng/pi-heao-gui

It is a fork, not a wrapper: the UI is now maintained in my repo (so I don't have to chase
your releases), and my CI never touches your repository. If you'd rather not be associated
with it, say the word and I'll adjust how it's described. If you're fine with it, a one-line
link in your README would genuinely help people find it.
```

---

## C. 中文社区（少数派 / V2EX / LINUX DO / B 站）

> 少数派偏"体验与完成度"，V2EX 偏"技术实现"，LINUX DO 偏"折腾与自部署"。
> **同一篇正文别原样三发**，按各站口味微调首段即可。

**标题（少数派 / 一般社区）**

```
给 pi 配了个 Windows 桌面端：同一个聊天界面，但不用装 VS Code
```

**正文**

```markdown
pi 是个很好用的编码 agent 命令行工具，但它只有 TUI。我在 Windows 上想要一个真正的窗口：
能一边聊天一边开终端、看文件、看 git 变更，退出后下次直接接着聊。

于是做了 **Pi Heao GUI**（MIT 开源）：https://github.com/Q1y1ng/pi-heao-gui

**三个可能对你有用的点**

1. **聊天界面不是重画的。** 它就是 pi-agent-studio 那个 VS Code 扩展里的那份 UI（MIT），
   现在放到本仓库自己维护 —— 所以不存在"仿得像不像"的问题。
2. **底部 Dock 是刚需。** 真 PTY 终端（多标签）、文件浏览、git 状态/差异/提交，都在同一个窗口里。
3. **不碰你的数据。** 直接用 pi 自己的配置与会话目录，凭据不复制第二份；会话、历史、信任模型都是 pi 的。

**先说清楚（省得你踩）**

- **尚未代码签名**，首次启动 Windows SmartScreen 会拦一下，需要点"更多信息 → 仍要运行"；
  发布页有 SHA-256 可核对。签名走 SignPath Foundation，正在申请。
- **只支持 Windows。** macOS / Linux 用户别装，装不上。
- 它不改善 pi 本身的能力上限 —— 这是个壳，不是另一个 agent。

截图与功能巡览在 README 里，欢迎报 bug（能复现的我都修）。
```

---

## D. Show HN（第二波，英文材料齐了再发）

> HN 的规矩：**标题不加形容词**，第一句就说清楚是什么，caveat 自己先讲。

**标题**

```
Show HN: A Windows desktop client for the pi coding agent
```

**首条自评（务必自己先发，把话说全）**

```text
Author here. pi is a coding agent CLI; this is an Electron shell around it for Windows,
because I wanted a window with a terminal, file browser and git panel instead of a TUI.

The chat UI is the MIT-licensed one from the pi-agent-studio VS Code extension, which I now
maintain as my own code in this repo rather than tracking upstream byte-for-byte. The obvious
criticism is "that's just a wrapper" — fair, and here's the boundary: it drives the real CLI
over its RPC surface, and it deliberately does not reimplement or "improve" the agent.

Two things I'd rather you hear from me: it is not code-signed yet (SmartScreen will warn,
signing is applied for), and it is Windows-only.

Code and screenshots: https://github.com/Q1y1ng/pi-heao-gui
```

---

## 发完之后

- **每次发版都是一次发布机会** ✓：Release 写清"这一版解决了谁的什么痛点"，比堆功能列表有用。
- **把 README 顶部那句"谁不适合用"留着** ✓ —— 劝退错的人，留下的都是对的。
- **不要**同一段文案刷十个板块，也不要把链接丢进与 pi 无关的群。
