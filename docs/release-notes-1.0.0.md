# Pi Heao GUI 1.0.0

Windows 桌面客户端，把 VSCode 扩展 **Pi Agent Studio** 的聊天界面原样剥离出来，
配一个独立的 Electron 外壳 —— **不再需要 VSCode**。

> 对话体验是上游 UI 原样（vendored，`npm run check:upstream` 在 CI 中逐字节校验）；
> 外壳（侧栏 / 终端 / 编辑器桥 / diff / 设置 / 托盘）为独立实现，并额外提供原版没有的
> 会话管理、全文搜索、Token 遥测、命令面板等。详见 [docs/FIDELITY.md](docs/FIDELITY.md)。

## 下载

| 文件 | 说明 |
| --- | --- |
| `Pi Heao GUI Setup 1.0.0.exe` | **推荐**：安装向导，可自选目录，创建快捷方式，带卸载项 |
| `Pi Heao GUI 1.0.0 Portable.exe` | 免安装，双击即用 |
| `pi-heao-gui-1.0.0-source.zip` | 源码包（已含上游 UI 构建产物，可直接 `npm ci && npm run build`） |

### ⚠️ 未签名

安装包与便携版**都没有代码签名**，首次运行 Windows SmartScreen 会提示
“Windows 已保护你的电脑”。点 **更多信息 → 仍要运行** 即可。

请比对校验和（本页底部）：

```
SHA256  Pi Heao GUI Setup 1.0.0.exe      = <见下方>
SHA256  Pi Heao GUI 1.0.0 Portable.exe   = <见下方>
```

## 前置要求

1. **Windows 10/11**
2. **Node.js ≥ 22**
3. **pi CLI**（应用只是外壳，agent 由 pi 提供）：

   ```bash
   npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

4. **至少一个 provider 的凭据**：在「设置 → 模型配置」填 API Key，
   或用「提供商就绪检查 → 登录」在内置终端里完成 OAuth。

> 应用首次运行会自动检测 pi CLI，缺失时会弹出安装指引并可一键打开设置。

## 1.0.0 亮点

- **聊天**：流式对话、模型/thinking 切换、fork/revert、`@file` 补全、Mermaid/KaTeX
- **会话**：重命名 / 删除 / 归档 / 恢复、置顶、**跨会话全文搜索**（可跳到命中消息）、多窗口
- **底部 Dock**：真 PTY 终端（默认跑 `pi` TUI）· 文件树 + CodeMirror 编辑器（选中内容一键发到对话）· git 变更与提交信息生成
- **Token 遥测**：首 token 延迟、解码 t/s、缓存命中率、推理占比、p50/p95、日月花费与预算（Ctrl+Shift+S）
- **命令面板** Ctrl+K；**内置 diff 窗口**（读 rewind 快照作基线）
- **设置**：深浅色 + 任意强调色、字号、预算、开机自启、扩展安装/卸载、技能编辑、诊断面板、pi 更新日志、界面语言（设置窗）
- **托盘**：最近会话、未读角标、关闭到托盘

## 已知限制

- 未签名（见上）；**仅 Windows**
- 界面语言目前覆盖设置窗；聊天窗新增文案仍为中文
- 无自动更新：升级请重新下载 Release
- VSCode 专属的 LSP/诊断集成不可剥离，故不提供
- OAuth 登录在内置终端里由 pi 自己的 `/login` 完成（不是独立对话框）
- 每个窗口一个工作目录（pi 无 `set_cwd`）

## 校验和

完整 SHA256 也在 Release 附件的说明中给出；下载后可用：

```powershell
certutil -hashfile "Pi Heao GUI Setup 1.0.0.exe" SHA256
```

## 致谢

- 上游 UI：[JohnnyZ93/pi-agent-studio](https://github.com/JohnnyZ93/pi-agent-studio)（MIT，pin `v1.3.8`）
- 运行时：[pi coding agent](https://pi.dev)（`@earendil-works/pi-coding-agent`）
- 终端：[node-pty](https://github.com/microsoft/node-pty) + [xterm.js](https://xtermjs.org/)；编辑器：[CodeMirror 5](https://codemirror.net/5/)

MIT License · made by HEAOZIE
