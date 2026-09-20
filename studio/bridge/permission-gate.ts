/**
 * Permission Gate Extension
 *
 * Puts a question in front of the person before a tool call that can destroy
 * something: a bash command matching a dangerous pattern, or a write/edit that
 * leaves the session's working directory.
 *
 * Mode and patterns come from the PI_VSCODE_PERMISSION env var
 * (JSON `{ mode, patterns }`, injected by the host from
 * `permission.mode` / `permission.dangerousPatterns`). The in-memory `mode` is the
 * runtime source of truth and can be switched with the `/permission` slash command
 * (session-only).
 *
 * The decision itself lives in ./permission-policy.mjs — pure, and unit-tested,
 * because this file cannot be: it only exists inside a pi session.
 */

import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ASK_MODE,
  FULL_MODE,
  compilePatterns,
  decideToolCall,
  parsePermissionEnv,
} from "./permission-policy.mjs";

type PermissionMode = "AskForApproval" | "FullAccess";

export default function (pi: ExtensionAPI) {
  const env = parsePermissionEnv(process.env.PI_VSCODE_PERMISSION);
  const { regexes, invalid } = compilePatterns(env.patterns);

  let mode: PermissionMode = env.mode === FULL_MODE ? FULL_MODE : ASK_MODE;

  const statusBarEnabled = process.env.PI_VSCODE_STATUS_BAR !== "0";
  const STATUS_ID = "pi-permission";

  const refreshStatus = (ctx?: ExtensionContext) => {
    if (!statusBarEnabled || !ctx?.hasUI) return;
    const text =
      mode === "FullAccess"
        ? `${ctx.ui.theme.fg("error", mode)}`
        : `${ctx.ui.theme.fg("success", mode)}`;
    ctx.ui.setStatus(STATUS_ID, text);
  };

  pi.on("session_start", async (_e, ctx) => {
    refreshStatus(ctx);
    // A pattern that does not compile is a rule that silently never matches — say
    // so once, where the person who just edited it will see it.
    if (invalid.length) {
      ctx.ui.notify(
        `权限规则里有 ${invalid.length} 条无效正则，已跳过：${invalid.slice(0, 3).join(" · ")}`,
        "warning",
      );
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    const decision = decideToolCall(
      { toolName: event.toolName, input: event.input },
      {
        mode,
        regexes,
        cwd: (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd(),
        // Follow links before comparing: a junction inside the workspace would
        // otherwise read as "inside" while pointing somewhere else (the same
        // escape the host's fs guard refuses).
        realpath: (p) => fs.realpathSync.native(p),
      },
    );
    if (decision.kind !== "ask") return undefined;

    if (!ctx.hasUI) {
      return { block: true, reason: `${decision.why} blocked (no UI for confirmation)` };
    }

    const tui = ctx.mode === "tui";
    const title = tui
      ? `${ctx.ui.theme.fg("warning", decision.title.split("\n")[0])}${decision.title.slice(decision.title.indexOf("\n"))}`
      : decision.title;
    const choice = await ctx.ui.select(title, ["Allow", "Block"]);

    if (choice !== "Allow") {
      return { block: true, reason: "Blocked by user" };
    }
    return undefined;
  });

  /** Switching the mode, or reporting that the argument was not one. */
  const applyMode = (arg: string): boolean => {
    if (arg === "ask" || arg === "askforapproval") {
      mode = ASK_MODE;
      return true;
    }
    if (arg === "full" || arg === "fullaccess") {
      mode = FULL_MODE;
      return true;
    }
    return false;
  };

  /** Reading the state is the one thing this command could not do: "is anything
   * actually being checked?" had no answer on screen. */
  const showStatus = (ctx: ExtensionContext): void => {
    ctx.ui.notify(
      `${mode} · ${regexes.length} 条命令规则` +
        (regexes.length === 0 ? "（没有规则 = 不拦截任何命令）" : "") +
        ` · 工作区之外的写入${mode === ASK_MODE ? "需确认" : "不确认"}`,
      mode === FULL_MODE ? "warning" : "info",
    );
  };

  pi.registerCommand("permission", {
    description: "Set permission mode (ask|full) or show the current rules",
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim().toLowerCase();
      if (applyMode(arg)) {
        refreshStatus(ctx);
        return;
      }
      if (arg === "" || arg === "status") showStatus(ctx);
    },
  });

  pi.on("session_shutdown", async (_e, ctx) => {
    if (ctx?.hasUI) ctx.ui.setStatus(STATUS_ID, undefined);
  });
}
