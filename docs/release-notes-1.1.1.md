## 1.1.1 — 2026-09-13

一次以审计为驱动的修复版：安全问题、崩溃时丢数据、以及两条形同虚设的守门。

### Fixed

- **主聊天窗口没有沙箱**：`sandbox: false`，而 README 与 SECURITY.md 都声称每个窗口都是
  `sandbox: true` —— 偏偏渲染不可信 agent 输出的就是这个窗口。现已开启沙箱，
  并用 `scripts/probe-preload-sandbox.cjs` 实测确认沙箱内的 preload 仍能取到
  `webUtils.getPathForFile`，拖拽不受影响。
- **文件面板可逃出工作区**：路径校验只比对字符串，工作区里的符号链接 / 目录联接
  （Windows 上建 junction 不需要管理员权限）可被用来读写工作区外的任意文件。
  现在会解析真实路径后再判断，无法验证时**拒绝而非放行**。代价是：指向外部的链接
  不会出现在文件树里。
- **"用默认程序打开"的扩展名检查可被绕过**：检查用的是原始字符串，而
  `extname("payload.bat.")` 是 `.`、`extname("payload.bat ")` 是 `.bat`，
  两者都不在黑名单里。现已先做路径归一化再判断（README 也把"白名单"改回了它真正的
  性质：黑名单）。
- **Dock 未转义就拼接 HTML**：文件名、git 路径与错误文本直接进 `innerHTML`
  （它是唯一没有 `esc()` 的拼页面文件）。Windows 文件名不允许关键字符，所以当时
  不可直接利用，但该补的转义补上了。
- **配置与遥测文件是非原子写**：`config.json` 与 `session-stats.json` 都是原地覆盖，
  中途崩溃/被杀会留下截断文件 —— 前者意味着工作目录、主题、收藏、预算全丢。
  现改为写临时文件后 `rename`。
- **pi 输出单行无上限**：子进程若一直不发换行，主进程会持续累积直到内存耗尽。
  现限制单行 32 MB，超限即中止连接并说明原因。
- **扩展挂载失败是静默的**：6 个内置扩展逐个 `existsSync` 判断，缺了只是不加载 ——
  打包不完整会表现为"todo / 权限门 / rewind 凭空消失"。现在会明确列出未挂载项。
- **Dock 重复注册 IPC 监听器**：每次终端重启都会再 `ipcRenderer.on` 一次，
  监听器随窗口存活不断堆积。现在存 handler、每个通道只注册一次。
- **`npm run verify` 永远失败**：它引用的 `pi-stat-cache` 在源码里已不存在
  （改名成 `pi-stat-modal-cache` 时漏改），因此无论代码好坏都必然报 null ——
  发布清单还把它列为门禁。已修正，现在 **33/33 全部通过**。
- **SECURITY.md 的 CSP 段落**补充了 `script-src 'unsafe-inline'` 这一真实取舍
  （CSP 只防外联，防注入靠逐处转义），并去掉写死的过时版本号。

### Added

- **CI 会打包并校验产物**：此前没有任何作业打包应用，"安装包里到底有没有那些运行时
  文件"无人过问。新增阻断作业：读 `app.asar` 头部断言 13 条运行时路径
  （vendored 聊天 UI、bridge 扩展、node-pty 原生模块等），每条都注明缺了会坏什么。
- **依赖监控**：Dependabot（electron 三件套与 Dock 的 vendored 库分别成组，
  node-pty 大版本忽略）+ 咨询性的 `npm audit --audit-level=high`。
- 新增 `scripts/check-package.cjs`、`scripts/probe-preload-sandbox.cjs`；
  单元测试从 121 增至 **125**（新增符号链接 / junction 逃逸测试）。

### Changed

- 打包脚本显式加 `--publish never`：electron-builder 会因检测到 CI 而自动尝试发布到
  GitHub，并在缺少 `GH_TOKEN` 时让整个作业失败（本地跑不会触发，因此从未暴露）。
