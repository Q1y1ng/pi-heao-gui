# 文档索引

| 文档 | 讲什么 | 什么时候看 |
| --- | --- | --- |
| [`../README.md`](../README.md) | 功能、安装、配置、安全模型 | 第一次接触这个项目 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 形态、关键决策，以及踩过的坑 | 改代码前想弄清“为什么这么设计” |
| [`UPSTREAM.md`](UPSTREAM.md) | 我们那份 UI 的来源与主动吸收流程 | 确认上游对应关系，或刷新 vendored 代码 |
| [`FIDELITY.md`](FIDELITY.md) | 与原 VS Code 插件的保真度审计（含资源占用对比） | 想知道“和原版差多少、少了什么” |
| [`RELEASING.md`](RELEASING.md) | 发布流程、校验和、源码包、代码签名、更新清单 | 准备发版 |
| [`release-notes-<version>.md`](release-notes-1.1.2.md) | 各版本的发布说明（即 Release 正文） | 写 Release，或回答“这版改了什么” |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 全部版本的变更记录 | 查某个行为是哪一版改的 |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | 开发流程、架构速览与五条硬规则 | 提 PR 之前 |
| [`../SECURITY.md`](../SECURITY.md) | 安全模型与漏洞报告方式 | 评估风险 |
| [`../NOTICE.md`](../NOTICE.md) | 第三方代码来源与许可 | 合规审查 |

## 维护约定

- **发布说明**按版本一个文件（`release-notes-<version>.md`）。发布后不再修改它 ——
  历史留在 `CHANGELOG.md`，避免同一件事有两个会各自漂移的说法。
- `CHANGELOG.md` 是唯一的历史真相：中文书写，条目面向**用户能感知的变化**，
  而不是提交列表。
- `ARCHITECTURE.md` 只记录**仍然有效**的结论；过期的过程记录直接删掉，
  不留在文档里当考古现场。
- 临时文件不要提交：`.gitignore` 已忽略根目录 `_*` 与 `scripts/_*`
  （曾有一次 `git add -A` 把调试脚本卷进了仓库）。
- 文档里的命令要**实际跑过**再写进来。`RELEASING.md` 里每条命令都标注了
  踩过的坑，例如 `latest.yml` 的文件名必须与上传后的附件名逐字节一致。
