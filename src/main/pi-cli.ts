/**
 * Safe invocation of the pi CLI's one-shot subcommands (`install`, `remove`,
 * `list`, `auth check`).
 *
 * These are the official entry points for managing extension packages and for
 * checking provider readiness — the RPC protocol has neither. Everything is
 * spawned without a shell through the same shim resolver the RPC client uses, so
 * argument injection stays impossible and npm `.cmd` shims still work.
 */
import { spawn } from "node:child_process";
import { resolveSpawnTarget } from "./rpc-client";
import { log, errText } from "./log";

export interface CliResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
}

const MAX_OUTPUT = 256 * 1024;

/** Characters that have no business in a package source and hint at injection. */
const SUSPECT = /[\s"'`;|&<>$(){}[\]\\*?!]/;

/** Boundary check for a `pi install <source>` argument. */
export function isSafePackageSource(source: string): boolean {
  const s = source.trim();
  if (!s || s.length > 200) return false;
  if (s.startsWith("-")) return false; // never let the value become a flag
  if (SUSPECT.test(s)) return false;
  return /^(npm:[@a-zA-Z0-9._/-]+|git:[^\s]+|https?:\/\/[^\s]+|ssh:\/\/[^\s]+|\.{1,2}\/[^\s]+|[a-zA-Z0-9@._-]+(\/[a-zA-Z0-9._-]+)*)$/.test(
    s,
  );
}

export interface CliOptions {
  timeoutMs?: number;
  cwd?: string;
}

/** Run `pi <args>` once and capture its output. Never throws. */
export function runPiCli(piPath: string, args: string[], opts: CliOptions = {}): Promise<CliResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise<CliResult>((resolve) => {
    let target: { command: string; args: string[] };
    try {
      target = resolveSpawnTarget(piPath, args);
    } catch (e) {
      resolve({ ok: false, code: null, stdout: "", stderr: "", error: errText(e) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CliResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(target.command, target.args, {
        cwd: opts.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (e) {
      finish({ ok: false, code: null, stdout: "", stderr: "", error: errText(e) });
      return;
    }

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      finish({ ok: false, code: null, stdout, stderr, timedOut: true, error: `超时（${timeoutMs} ms）` });
    }, timeoutMs);
    timer.unref?.();

    proc.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8");
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, code: null, stdout, stderr, error: err.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, code, stdout, stderr });
    });
  });
}

export interface InstalledPackage {
  source: string;
  path: string;
  scope: "user" | "project";
}

/**
 * Parse `pi list`:
 *   User packages:
 *     npm:@scope/name
 *       C:\Users\me\.pi\agent\npm\node_modules\@scope\name
 *   Project packages:
 *     ...
 */
export function parseInstalledPackages(stdout: string): InstalledPackage[] {
  const out: InstalledPackage[] = [];
  let scope: "user" | "project" = "user";
  let pending: InstalledPackage | null = null;
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    if (/^\s*project packages:/i.test(line)) {
      scope = "project";
      pending = null;
      continue;
    }
    if (/^\s*user packages:/i.test(line)) {
      scope = "user";
      pending = null;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    // Only the indented body of a section carries entries: package sources sit at
    // two spaces, their install path deeper. Anything else (headers we do not
    // know, "no packages" notices) must not become a fake package.
    if (indent < 2) continue;
    if (indent <= 2) {
      pending = { source: text, path: "", scope };
      out.push(pending);
      continue;
    }
    if (pending && !pending.path) pending.path = text;
  }
  return out;
}

export interface AuthStatus {
  provider: string;
  status: string;
  reason?: string;
}

/** Parse `pi auth check --provider X --json` (one JSON object). */
export function parseAuthStatus(stdout: string): AuthStatus | null {
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        const obj = parsed as { provider?: unknown; status?: unknown; reason?: unknown };
        if (typeof obj.provider === "string" && typeof obj.status === "string") {
          return {
            provider: obj.provider,
            status: obj.status,
            reason: typeof obj.reason === "string" ? obj.reason : undefined,
          };
        }
      }
    } catch {
      log.warn("auth check: unparsable line", text.slice(0, 120));
    }
  }
  return null;
}
