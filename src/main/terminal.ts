/**
 * Real PTY terminal, the portable half of the upstream extension's
 * "native terminal TUI" (upstream `src/terminal.ts` spawns the pi binary itself
 * as the terminal's shellPath, with the bridge extension args and `--session`).
 *
 * node-pty builds on ConPTY here, so the pi TUI gets a real terminal: colours,
 * the alternate screen buffer, Ctrl+C and resize all behave as in a console.
 *
 * Trust note: a terminal is arbitrary command execution for whoever can write to
 * it. The chat renderer is the only client (CSP + markdown-it html:false keep
 * rendered content inert), and the panel is never opened automatically.
 */
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { resolveSpawnTarget } from "./rpc-client";
import { log, errText } from "./log";

export interface PtyProcess {
  onData: (listener: (data: string) => void) => void;
  onExit: (listener: (e: { exitCode: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  readonly pid: number;
}

interface PtyModule {
  spawn: (
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
      useConpty?: boolean;
    },
  ) => PtyProcess;
}

/**
 * node-pty is a native N-API module: the same prebuilt binary loads in Node and
 * Electron (verified: spawn + ConPTY output under Electron 148), so it is a
 * normal dependency rather than a rebuild-per-Electron one.
 */
function loadPty(): PtyModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("node-pty") as PtyModule;
    return typeof mod?.spawn === "function" ? mod : null;
  } catch (e) {
    log.warn("node-pty unavailable — terminal disabled:", errText(e));
    return null;
  }
}

export type TerminalKind = "pi" | "shell";

export interface TerminalOptions {
  kind: TerminalKind;
  cwd: string;
  /** pi CLI path (already resolved by findPiBinary). */
  piPath: string;
  /** Bridge extension args (`-e <ext>` …), same as the chat session uses. */
  extensionArgs: string[];
  /** Resume a session in the TUI. */
  sessionFile?: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

export interface TerminalHandle {
  kind: TerminalKind;
  cwd: string;
  /** Executable actually spawned (for the panel header). */
  shell: string;
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/**
 * ConPTY needs a real executable path — a bare name like "node" fails with
 * "File not found", unlike child_process.spawn which searches PATH itself.
 * So resolve bare commands through PATH/PATHEXT before handing them to the PTY.
 */
export function resolveExecutable(command: string): string {
  if (isAbsolute(command)) return command;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  const dirs = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      for (const suffix of [ext.toLowerCase(), ext.toUpperCase(), ext]) {
        const candidate = join(dir, command + suffix);
        try {
          if (statSync(candidate).isFile()) return candidate;
        } catch {
          // keep looking
        }
      }
    }
  }
  return command;
}

function shellCommand(): { command: string; args: string[] } {
  if (process.platform === "win32") {
    const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    if (existsSync(pwsh)) return { command: pwsh, args: ["-NoLogo"] };
    return { command: process.env.COMSPEC || "cmd.exe", args: [] };
  }
  return { command: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

/** Spawn a terminal; returns null when node-pty is missing (feature degrades). */
export type TerminalResult = { ok: true; handle: TerminalHandle } | { ok: false; error: string };

/** Spawn a terminal; a failure reports WHY (missing native module vs spawn). */
export function createTerminal(opts: TerminalOptions): TerminalResult {
  const pty = loadPty();
  if (!pty) return { ok: false, error: "node-pty 未能加载（原生模块不可用）" };

  const extensions = [
    ...opts.extensionArgs,
    ...(opts.sessionFile ? ["--session", opts.sessionFile] : []),
  ];

  let command: string;
  let args: string[];
  if (opts.kind === "pi") {
    // Resolve .cmd shims to `node <cli.js>` — spawning a shim would need a
    // shell, and that is exactly the injection surface we removed elsewhere.
    try {
      const target = resolveSpawnTarget(opts.piPath, extensions);
      command = resolveExecutable(target.command);
      args = target.args;
    } catch (e) {
      return { ok: false, error: `无法解析 pi 可执行文件: ${errText(e)}` };
    }
  } else {
    const shell = shellCommand();
    command = shell.command;
    args = shell.args;
  }

  const cwd = opts.cwd && existsSync(opts.cwd) ? opts.cwd : homedir();
  let proc: PtyProcess;
  try {
    proc = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: Math.max(20, opts.cols),
      rows: Math.max(5, opts.rows),
      cwd,
      env: { ...process.env, ...opts.env, TERM: "xterm-256color" } as Record<string, string>,
      useConpty: process.platform === "win32",
    });
  } catch (e) {
    log.error("terminal spawn failed:", errText(e));
    return { ok: false, error: `PTY 启动失败: ${errText(e)}` };
  }

  proc.onData((data) => {
    try {
      opts.onData(data);
    } catch (e) {
      log.warn("terminal data forwarding:", errText(e));
    }
  });
  proc.onExit(({ exitCode }) => {
    try {
      opts.onExit(exitCode);
    } catch (e) {
      log.warn("terminal exit handler:", errText(e));
    }
  });

  return {
    ok: true,
    handle: {
      kind: opts.kind,
      cwd,
      shell: opts.kind === "pi" ? "pi" : command,
      pid: proc.pid,
      write: (data) => {
        try {
          proc.write(data);
        } catch (e) {
          log.warn("terminal write:", errText(e));
        }
      },
      resize: (cols, rows) => {
        try {
          proc.resize(Math.max(20, cols), Math.max(5, rows));
        } catch (e) {
          log.warn("terminal resize:", errText(e));
        }
      },
      kill: () => {
        try {
          proc.kill();
        } catch (e) {
          log.warn("terminal kill:", errText(e));
        }
      },
    },
  };
}
