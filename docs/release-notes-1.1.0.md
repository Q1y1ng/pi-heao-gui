# Pi Heao GUI 1.1.0

独立桌面客户端（Electron）＋ `pi` 编码 agent 的图形界面：会话管理、实时 token 遥测、
内置终端（真 PTY）与 pi TUI、文件面板、变更与提交信息生成、命令面板、差异窗口。

## 本次亮点

### 修复：设置窗所有控件点不动

设置窗的内联脚本里，被模板字面量吞掉的换行转义让字符串未闭合，整段脚本解析失败 ——
于是**没有任何事件处理器被注册**。浏览器不报错、主进程无日志，页面照常渲染，所以
"标签页存在"这类检查一直是绿的。根因已修，并加了能抓住它的自动化守卫。

同时修掉另外五个真问题：命令面板（Ctrl+K）因 `<style id="pi-palette">` 与面板根元素
撞 id 而完全打不开；标题栏两个指标把值写进了隐藏的统计面板（id 撞车）；文件编辑器报
`CodeMirror.defineSimpleMode is not a function`（缺插件）；Windows 上更新日志的 npm
回退因 `.cmd` 直起 EINVAL 而从未生效；终端重启后吞掉所有按键。

### 新增：英文界面

设置窗、聊天窗标题栏、侧栏、停靠区（终端/文件/变更）、命令面板、统计面板、托盘菜单与
关于对话框均已支持英文，在 **设置 → 常规 → 界面语言** 切换，`跟随系统` 为默认。
上游聊天区的文案由它自己的 locales 控制。

### 新增：自动检查更新

启动 20 秒后在后台检查本仓库 Release，发现新版本自动下载，可在
**设置 → 诊断 → 版本与更新** 手动检查并一键重启安装。源码运行时不检查；
`~/.pi/standalone/config.json` 里 `autoCheckUpdates: false` 可关闭。
**便携版不支持自更新**，请手动换包。

### 代码签名

本轮已把仓库侧准备就绪（`signpath/artifact-configuration.xml` + 手动触发的
`.github/workflows/sign-windows.yml`），正在走 **SignPath Foundation** 的开源项目免费
签名申请。**本次发布的包仍未签名**（已验证状态为 `NotSigned`），首次运行 Windows
SmartScreen 会提示"已保护你的电脑"：点"更多信息 → 仍要运行"，或先比对下方 SHA256。

## 下载

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `Pi-Heao-GUI-Setup-1.1.0.exe` | 93.6 MB | **推荐**：安装向导，可自选目录，创建快捷方式，带卸载项（卸载不删你的 pi 会话与配置） |
| `Pi-Heao-GUI-1.1.0-Portable.exe` | 93.4 MB | 免安装，双击即用，不写入安装目录 |
| `pi-heao-gui-1.1.0-source.zip` | 7.2 MB | 源码包（含上游 UI 构建产物，解压后 `npm ci && npm run build`） |
| `latest.yml` | — | 自动更新清单（已安装的副本靠它发现新版本） |

## 校验和（SHA256）

```text
92732812794808dc6299a8105cdee24fcfe0a5b908e9f593548eab61f896f4bc  Pi-Heao-GUI-1.1.0-Portable.exe
405c1dbf99d21b4dd8fd644cd1d0a0acab044620e7e6b776d65d0d2894e77779  Pi-Heao-GUI-Setup-1.1.0.exe
aa849d54b693f61614f0dcd9f8973434256f61e5edbc5f5fb97eff03ffa5a738  pi-heao-gui-1.1.0-source.zip
```

校验：`certutil -hashfile <文件> SHA256`

## 从 1.0.0 升级

**这一次请手动下载**：1.0.0 发布时没有附上 `latest.yml`，所以已安装的 1.0.0 看不到
1.1.0。装上 1.1.0 之后，以后的版本就能自动更新了。

## 功能一览

- 会话：列表/搜索/固定/重命名/归档与恢复/删除、跨会话全文搜索、导出为 Markdown
- 遥测：TTFT、解码速度、缓存命中率、推理占比、p50/p95、每日与每月花费、预算提醒
- 终端：node-pty 真 PTY，可在 pi TUI 与系统 shell 之间切换
- 文件：目录树 + CodeMirror 编辑，选中内容可直接送到对话输入框
- 变更：git 状态、逐文件 diff、"生成提交信息"、复制/插入
- 其他：命令面板（Ctrl+K）、差异窗口、导出会话、系统托盘（最近会话/未读计数）、
  设置窗九个标签页（模型/扩展/技能/系统提示词/外观/诊断/更新日志/常规）

## 已知限制

- 仅 Windows（x64）
- 未签名（SignPath Foundation 申请中）；即便签名，SmartScreen 信誉也需靠下载量累积
- NSIS 安装包内的 `Pi Heao GUI.exe` 尚未单独签名，需要两趟构建（见 `docs/RELEASING.md` §8）
- 便携版不能自更新
- LSP、符号跳转、内联诊断依赖 VS Code 宿主，无法剥离移植
- pi 没有 `set_cwd`，因此不支持"每会话独立工作目录"
