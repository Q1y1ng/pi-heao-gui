# Privacy Policy / 隐私政策

**Last updated: 2026-09-13**

## English

Pi Heao GUI is a local desktop client for the `pi` coding agent. It runs on your
machine and talks to the model providers *you* configure through the `pi` CLI.

**What is collected: none.** The application has no analytics, no telemetry, no
crash reporting and no account system. There is no server operated by this
project, so there is nothing for it to receive.

**What is stored, and where.** Everything stays on your computer:

| Data | Location | Purpose |
| --- | --- | --- |
| Application settings (theme, language, budget, workspace) | `~/.pi/standalone/config.json` | Remember your preferences |
| Which sessions you pinned or archived | same file | Sidebar behaviour |
| Per-session usage statistics (tokens, latency, cost) | the app's user-data directory | The telemetry panel |
| Chat sessions and their content | `~/.pi/agent/sessions/` | Owned by `pi`, not by this app |
| Provider credentials | `~/.pi/agent/auth.json` | Owned by `pi`; never shown to the UI |

**Network access.** Two things reach the network, both initiated by the app and
neither carrying personal data:

1. **Model requests**, made by the `pi` process to the provider you configured.
2. **Update checks** — a request to GitHub's public API for this project's
   releases (the version number of the installed build is sent, as part of a
   normal HTTPS request). This can be turned off with `autoCheckUpdates: false`
   in the config file above.

Deleting the files listed above removes everything the application stores.

## 中文

Pi Heao GUI 是 `pi` 编码 agent 的**本地**桌面客户端，模型请求由你配置的 `pi` 直接发往
你选择的提供方。

**不收集任何数据**：没有统计、没有遥测、没有崩溃上报、没有账号体系，本项目也不运营
服务器。所有内容都留在你自己的机器上（设置在同目录的 `config.json`，会话与凭据由 `pi`
自己管理）。联网只发生在两件事上：`pi` 向模型提供方发请求，以及应用检查本项目的
GitHub Release 更新（可在配置里关闭）。删掉上述文件即清除全部本地数据。

## Contact

Open an issue at <https://github.com/Q1y1ng/pi-heao-gui/issues>.
