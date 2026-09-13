# Security

Pi Heao GUI is a desktop shell around the `pi` coding agent. It runs an agent
that can read and write files and execute commands, so a few things are worth
stating plainly for anyone installing or reviewing it.

## What this app can do to your machine

| Capability | Notes |
| --- | --- |
| Spawn the `pi` CLI | The agent runs with **your** user account and **your** API keys. Its tool permissions are enforced by pi's `permission-gate` extension; the app sets the mode from the settings window (`AskForApproval` by default). |
| Prompt-driven tool use | File edits, bash commands and MCP calls are the agent's, not the shell's — review the approval prompts. |
| **Integrated terminal (Dock)** | The terminal panel is a **real PTY** (node-pty + ConPTY) running `pi` or a shell. Anything that can drive that renderer can execute commands. It is never opened automatically, but treat a compromised chat window as a compromised shell. |
| Local file access from the UI | The file panel can read/write inside the workspace root only (`pi:fs-*` resolves and re-checks every path). |
| Read `~/.pi/agent/*` | Settings are read/written through the settings window's preload only. API keys are returned **masked** and the real values are restored on save. |
| Open files with the OS | "Open in default app" is restricted to non-executable extensions; UNC/device paths are rejected. |

## Trust boundary (what the renderer may reach)

Two separate preloads:

- **chat window** (`src/preload/preload.ts`): `window.pi` with an allowlisted
  `invoke`. It cannot read `auth.json`, `settings.json` or the app config.
- **settings window** (`src/preload/preload-settings.ts`): the only window that
  may touch agent config files; it has no terminal or session channels.

All windows run with `sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`, and the generated documents carry a
`default-src 'none'` CSP (no remote origins, no `unsafe-eval`). The chat UI is
the upstream pi-chat bundle rendered with `markdown-it({ html: false })`; raw HTML
in model output is not executed.

The CSP does carry `script-src 'unsafe-inline'`, because the page's own scripts are
inlined into the document. That stops remote loads, but it is *not* a second line
of defence against injection: every place that builds HTML passes
attacker-influenced values through a local `esc()`, and file paths are resolved —
following symlinks and junctions — before they are used. Giving each injected
script a nonce or hash is not implemented yet.

Outbound network traffic comes from the agent (model calls) and from
`pi install` / `pi auth` when you ask for them. The shell itself makes no
requests and collects no telemetry.

## Reporting a vulnerability

Please open a private security advisory on the repository (Security → Report a
vulnerability) rather than a public issue, and include:

- affected version (the settings window shows it next to the title),
- reproduction steps or a proof of concept,
- whether it requires a malicious model response, a malicious workspace, or only
  local access.

You can generate a diagnostics bundle from **设置 → 诊断 → 生成诊断包** before
reporting; it contains versions, the app config with secrets masked, and the tail
of the RPC log.

## Known, accepted limitations

- The Windows binary is **unsigned**, so SmartScreen will warn on first launch.
- `vendor/upstream/` is a byte-for-byte copy of MIT-licensed
  `pi-agent-studio`; a compromised upstream tag is a supply-chain risk, which is
  why `npm run check:upstream` runs in CI.
- Third-party extension packages installed through `pi install` execute inside the
  pi process with your privileges — that is pi's model, not something this shell
  can sandbox.
