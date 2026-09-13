## 1.1.3 — 2026-09-13

这一版没有面向界面的新功能，改的是**这个项目与上游的关系**：那份聊天 UI 的代码，从此归本项目所有。

### Changed

- **UI 代码归本项目所有。** 以前 `vendor/upstream/` 是上游 `pi-agent-studio` 的逐字节副本，钉在
  tag `v1.3.8`，并且有一条 CI 作业会**克隆上游仓库**、字节有差异就判失败 —— 它保护了"聊天 UI 就是
  原版"这句承诺，代价是上游每次发版都可能让本项目变红，而那个目录的规则又是"不许改"。
  现在这份代码是**我们的**：像 `src/` 一样可以改，不要求对齐任何上游版本 ✓。
  目录改名为 **`studio/`**（"vendor" 这个前缀已经不成立）。
- **CI 与构建不再访问上游仓库**：上游发新版**不会**让本项目变红。想要它的新东西时，按
  `docs/UPSTREAM.md` **先 diff、按需取，可以只取一部分**（例如只要 `pi-chat/` 的新样式，不动 `bridge/`）。

### Added

- **DOM 契约测试**（`test/dom-contract.test.cjs`）。注入层靠少数几个 DOM 钩子定位（`#input`、
  消息节点、我们自己的 `pi-*` 元素）；这份 UI 现在两边都可能漂移，而"某个 id 被改名"的症状是
  **界面照常、功能静默消失**。本项目就咬过一次：一个 id 改名后 `npm run verify` 再也通不过，却
  没有人知道。契约测试让这类改名在单元测试阶段就报出**具体少了哪个钩子**。

### Removed

- `scripts/check-upstream.cjs` 与 CI 里的 `upstream` 字节保真作业（被上面的新政策取代）。

### 说明

- 本版的改动发生在打包路径上（目录改名牵动 electron-builder 的 `files` globs 与 asar 断言表），
  因此发布前**真的打了一次包**并用 `npm run check:package` 校验产物，而不是只读 diff。
- 已知局限：契约测试 grep 的是生成文档的**文本**，不是解析后的 DOM —— 只活在脚本里的 id 仍可能漏过。

## 安装

需要 **Windows 10 / 11（x64）**、**Node.js ≥ 22**，以及 `pi` CLI：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

再准备至少一个 provider 的凭据（写在 `~/.pi/agent/auth.json`，或让应用带你在内置终端里登录）。
安装程序可自选目录，会自动创建桌面与开始菜单快捷方式；便携版免安装直接运行，但**不支持自更新**。

## 注意

- **本版仍未签名**：首次运行 Windows SmartScreen 会提示“已保护你的电脑”，
  点 **更多信息 → 仍要运行**；或先比对下方 SHA256。签名申请走
  [SignPath Foundation](https://signpath.org/foundation)，仓库侧已就绪。
- 已安装的 1.1.x 会在启动约 20 秒后自动检查并下载本版；**便携版需手动换包**。
- 发布前的门禁：`npm test` **127/127（0 跳过）**、`npm run verify` **35/35**（真窗口）、
  `npm run check:package`（打包产物含全部 13 条运行时依赖）。

## 校验和（SHA256）

```text
20e904afc332b9ec9cb6e228b2f453077eb19eb74c799fbf87805fe8b971cee2  Pi-Heao-GUI-Setup-1.1.3.exe
40c6098f713eef42e2f865c570d47c988d2dd3cbe45573fb63c36f38e9ee67a0  Pi-Heao-GUI-1.1.3-Portable.exe
14faf207ba5eda96111943d52e852d4aee16196363842dec90a7fe2dda40315b  pi-heao-gui-1.1.3-source.zip
```
