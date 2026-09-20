/**
 * The decision behind the permission gate, kept pure.
 *
 * `permission-gate.ts` is the extension pi loads; this file is the question it
 * asks — and it is a separate module, with no imports from pi or Electron, so
 * that the decision can be pinned by a unit test (`test/permission-policy.test.cjs`)
 * instead of by reading the extension.
 *
 * Two things are gated, and the second one did not exist before:
 *
 *   1. bash, by pattern. The patterns come from the host (`PI_VSCODE_PERMISSION`),
 *      which ships a default set — an empty list means "block nothing", which is
 *      what the settings screen used to produce without saying so.
 *   2. write / edit, by *where* they write. A write outside the session's working
 *      directory is how a run that looks like "it only touched the repo" ends up
 *      rewriting `~/.pi/agent/settings.json` or a shell profile instead. Pattern
 *      matching cannot see this — `write` takes a path, not a command — so it is a
 *      separate rule rather than another pattern.
 *
 * Matching is deliberately a blacklist of shapes, not a whitelist of commands: it
 * cannot stop a command that is spelled around it (`r\m -rf`, a base64 payload piped
 * into a shell). What it can do is put a question in front of the person for the
 * commands that destroy things — which is the whole point of AskForApproval.
 */

import * as pathApi from "node:path";

/** The two modes the host may send. Anything else falls back to the strict one. */
export const ASK_MODE = "AskForApproval";
export const FULL_MODE = "FullAccess";

/** Tools whose first path argument is a write target. bash is handled by patterns. */
export const WRITE_TOOLS = ["write", "edit"];

/** Argument names pi's file tools use for the target path. */
export const PATH_KEYS = ["path", "file_path", "filePath", "file"];

/**
 * Parse the JSON blob the host puts in `PI_VSCODE_PERMISSION`.
 *
 * Never throws: a malformed value means "no patterns", and the mode falls back to
 * AskForApproval — the strict default, so a broken env cannot silently disable the
 * gate.
 */
export function parsePermissionEnv(raw) {
  let parsed = {};
  try {
    const value = JSON.parse(String(raw ?? "{}"));
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
  } catch {
    parsed = {};
  }
  const mode = parsed.mode === FULL_MODE ? FULL_MODE : ASK_MODE;
  const patterns = Array.isArray(parsed.patterns)
    ? parsed.patterns.filter((p) => typeof p === "string" && p.length > 0)
    : [];
  return { mode, patterns };
}

/**
 * Compile the pattern strings, reporting the ones that are not valid regular
 * expressions instead of dropping them silently (a typo in the settings screen
 * used to look exactly like a rule that does not match).
 */
export function compilePatterns(patterns) {
  const regexes = [];
  const invalid = [];
  for (const pattern of patterns || []) {
    if (typeof pattern !== "string") continue;
    if (!pattern) continue;
    try {
      regexes.push(new RegExp(pattern, "i"));
    } catch {
      invalid.push(pattern);
    }
  }
  return { regexes, invalid };
}

/** The first pattern that matches `command`, or null. */
export function matchDangerous(command, regexes) {
  const text = typeof command === "string" ? command : "";
  if (!text) return null;
  for (const re of regexes || []) {
    if (re.test(text)) return re.source;
  }
  return null;
}

/** The write target of a tool call, or "" when the tool carries no path. */
export function writeTargetOf(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function tryReal(target, realpath) {
  if (!target || typeof realpath !== "function") return "";
  try {
    return String(realpath(target));
  } catch {
    // A file that does not exist yet has no real path of its own; its parent's
    // real path plus the name is the closest honest answer.
    try {
      return pathApi.join(String(realpath(pathApi.dirname(target))), pathApi.basename(target));
    } catch {
      return "";
    }
  }
}

/**
 * `target` (absolute, or relative to `cwd`) with links resolved when the caller can:
 * both sides of a containment check have to be spelled the same way, and the resolved
 * path is also what the person should be shown — "link\settings.json" reads as inside
 * the workspace even when it writes to the home directory.
 */
export function resolveRealPath(cwd, target, realpath) {
  const textual = pathApi.resolve(String(cwd ?? "."), String(target ?? ""));
  const real = tryReal(textual, realpath);
  return real || textual;
}

/**
 * Whether `target` is the working directory or inside it.
 *
 * Textual first, then through `realpath` when the caller supplies one, because a
 * junction inside the workspace is otherwise a path that reads as contained and is
 * not — the same escape `src/main/fs-path.ts` guards on the host side.
 */
export function isInsideWorkspace(cwd, target, realpath) {
  if (!cwd || !target) return false;
  const base = resolveRealPath(cwd, ".", realpath);
  const full = resolveRealPath(cwd, target, realpath);
  const rel = pathApi.relative(base, full);
  if (rel === "") return true;
  if (pathApi.isAbsolute(rel)) return false;
  return !rel.startsWith("..");
}

/**
 * The decision for one tool call.
 *
 * @param {{toolName?: string, input?: unknown}} event
 * @param {{mode?: string, regexes?: RegExp[], cwd?: string, realpath?: (p: string) => string}} policy
 * @returns {{kind: "allow", why: string}
 *   | {kind: "ask", why: string, title: string, detail: string}}
 */
export function decideToolCall(event, policy) {
  const mode = policy?.mode === FULL_MODE ? FULL_MODE : ASK_MODE;
  const toolName = String(event?.toolName ?? "");
  const input = event?.input;
  if (mode === FULL_MODE) return { kind: "allow", why: "full access" };

  if (toolName === "bash") {
    const command = input && typeof input.command === "string" ? input.command : "";
    if (!command) return { kind: "allow", why: "no command" };
    const hit = matchDangerous(command, policy?.regexes);
    if (!hit) return { kind: "allow", why: "no pattern matched" };
    return {
      kind: "ask",
      why: "dangerous command",
      title: `Dangerous Command:\n\n  ${command}\n\nmatched: ${hit}`,
      detail: hit,
    };
  }

  if (WRITE_TOOLS.includes(toolName)) {
    const target = writeTargetOf(input);
    if (!target) return { kind: "allow", why: "no path" };
    const cwd = String(policy?.cwd ?? "");
    if (!cwd) return { kind: "allow", why: "no working directory to compare against" };
    if (isInsideWorkspace(cwd, target, policy?.realpath)) {
      return { kind: "allow", why: "inside the working directory" };
    }
    const full = resolveRealPath(cwd, target, policy?.realpath);
    return {
      kind: "ask",
      why: "write outside the working directory",
      title: `Write outside the working directory:\n\n  ${full}\n\nworking directory: ${cwd}`,
      detail: full,
    };
  }

  // Anything else is either read-only or a tool this gate knows nothing about;
  // guessing here would mean blocking real work on a name we made up.
  return { kind: "allow", why: `not gated: ${toolName || "(unnamed)"}` };
}
