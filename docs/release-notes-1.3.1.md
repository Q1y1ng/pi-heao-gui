## 1.3.1 — 2026-09-21

一次审计（安全 / 稳定性 / 工程流程）之后的修复版本。用户能感知的变化集中在两件事上：
**"危险命令需确认"真的会拦了**，以及**一批会让 pi 进程、回合或窗口卡住的缺陷**被修掉。

### 修复

- **"危险命令需确认"此前是一条空转的规则。** 设置里默认就是 `AskForApproval`，但规则表默认是**空的**，
  而空表在权限门里等于"一条都不匹配" —— 每条 bash 命令都放行；设置界面里又根本没有编辑规则的地方，
  所以这个默认值无从改起。现在应用**自带 39 条默认规则**（与上游 pi-agent-studio 那套逐字一致），
  设置 → 权限 里可以直接编辑、一键「恢复默认」，`/permission` 会报出当前模式与生效规则条数。
- **权限门不再只管 bash，也不再只管主会话。** `write` / `edit` 的目标路径解析后落在**会话工作目录之外**
  时要确认（这就是"它只改了仓库"实际是改写 `~/.pi/agent/settings.json` 的那条路）；`subagent` 派生的第二个
  pi 此前**没有挂权限门**，等于把危险命令交给子代理就绕过了全部确认 —— 现在它也挂同一个门。
- **文件面板不再等于"整个用户目录可读写"。** 文件面板的默认根就是家目录，所以聊天窗口（那个专门渲染模型
  输出、被定义为不能碰 agent 配置的窗口）此前可以通过它读 `~/.pi/agent/auth.json`、改写
  `~/.pi/standalone/config.json`。现在一律拒绝 `~/.pi`、`~/.ssh`、`~/.aws`、`~/.gnupg`、`~/.docker`、
  `~/.config`、`~/.npmrc`、`~/.git-credentials`、`~/.gitconfig` 与 `%APPDATA%`；仓库自己的 `.pi/` 不受影响。
- **pi 进程不再泄漏。** pi 退出后连发两条消息会各起一个 pi，后者覆盖引用而前者**永不退出**（连应用退出都
  扫不到它），两个进程还往同一个会话文件里写 —— 现在重载是互斥的。
- **子代理不再能无限期挂着。** 它此前只有一个出口（调用方 abort），子 pi 一卡住，整个回合就永远不结束、
  聊天窗永久停在 streaming。现在有 15 分钟总超时（`PI_SUBAGENT_TIMEOUT_MS` 可改），超时杀掉整棵进程树。
- **超时的 `pi install` 不再把 npm 子进程留在后台**（Windows 上 pi 通常是 `.cmd`，此前只杀了外壳，
  npm 会继续往 agent 包目录里装 —— 正是"下次启动必失败"的那类半删状态）。
- **"生成提交信息"在改动很大时不再必然失败**：prompt 是走命令行参数传给 pi 的，而 Windows 整条命令行
  上限 32767 字符，旧实现给 diff 的预算就是 64KB —— 单它一项就已经超了。
- **打开一个仓库不再等于自动执行它的 `.pi/mcp.json`。** 那个文件本质是一串命令，会话开在该目录里就会以
  你的权限启动它们；pi 自己的项目信任门覆盖 settings/extensions/skills/prompts/themes，**偏偏不含 mcp.json**。
  现在会先问一次（列出 server 名字与目录），按目录 + 文件哈希记住，文件被改过会重问。
- **MCP 请求不再能永久挂住一个回合**（只有 connect 有超时，`callTool`/`readResource`/`getPrompt` 都没有）。
- **diff 窗口与导入会话补上大小上限**：前者此前可以整读任意大小的文件、并把渲染结果写进临时目录
  （那个"上限"是在写盘之后才判断的，实际只有一行日志）。
- **便携版不再去下载"安装包版"的自动更新**（共用 release 通道，`latest.yml` 里只有 NSIS），
  现在明确提示"请从 Releases 下载新的 Portable.exe"。
- 诊断包不再捎带明文密钥（那份文件是给人贴到公开 issue 上的）。
- 等终端排队时关窗口，不再留下一个看不见也关不掉的终端进程；终端的会话文件参数加了校验。

### 工程

- **CI 里现在真的会加载一次终端栈**：新增阻塞步骤 `npm run check:pty`（Electron 下起一个 ConPTY 并要求
  回显）。此前 CI 没有任何一步 `require("node-pty")` —— 原生模块坏掉可以一路绿灯发出去，表现为"终端面板一片空白"。
- 单测 235 → **257**；`studio/pi-chat/package-lock.json` 重新入库（同一 tag 的两次构建此前可以不一致）。

### 本版验证

```text
npm test    257/257
tsc         0 错
biome       0 error（3 warnings，均为改动前就有的 e2e 脚本项）
check:pty   PASS（Electron 下 node-pty 起 ConPTY 并回显）
check:package  14 条运行时路径全部在包内
CI          lint+typecheck+test / smoke / package 三个作业全绿
```

## 安装

需要 **Windows 10 / 11（x64）**、**Node.js ≥ 22**，以及 `pi` CLI：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

再准备至少一个 provider 的凭据（写在 `~/.pi/agent/auth.json`，或让应用带你在内置终端里登录）。
安装程序可自选目录，会自动创建开始菜单快捷方式；便携版免安装直接运行，但**不支持自更新**。

## 注意

- **本版仍未签名**：首次运行 Windows SmartScreen 会提示"已保护你的电脑"，
  点 **更多信息 → 仍要运行**；或先比对下方 SHA256。
- **已安装的 1.2.x / 1.3.0** 会在启动约 20 秒后自动检查并下载本版；**便携版需手动换包**（应用里也会这么提示）。
- **权限行为变了，值得先看一眼**：默认规则表会拦下 `rm -rf`、`git push --force`、`curl | sh`、`sudo`、
  `diskpart`、`format` 这类命令并弹确认；写工作目录之外的文件也会弹确认。
  不想被拦就在 设置 → 权限 里清空规则表（明确关掉），或把模式改成「完全访问」。
- 在 `~/.pi` 里看会话文件、改配置的需求不受影响 —— 那是**设置窗口**与 pi CLI 的事，
  被拒的只是聊天窗口的文件面板。

## 校验和（SHA256）

```text
SHA256SUMS.txt  Pi-Heao-GUI-Setup-1.3.1.exe
SHA256SUMS.txt  Pi-Heao-GUI-1.3.1-Portable.exe
SHA256SUMS.txt  pi-heao-gui-1.3.1-source.zip
```

发布页附件里的 `SHA256SUMS.txt` 是这三个文件的权威校验和。
