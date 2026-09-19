/**
 * Pure config / secret / path helpers.
 *
 * Deliberately free of Electron and fs imports so it can be unit-tested
 * directly (see test/config.test.cjs) — main.ts keeps only the I/O around it.
 */
import { basename, extname, isAbsolute, resolve } from "node:path";
import {
  DEFAULT_CONFIG,
  type AlertSettings,
  type Project,
  type StandaloneConfig,
} from "../shared/types";

// ─── JSON boundary ────────────────────────────────────────────────────

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Boundary parser: anything that is not a JSON object becomes an empty object. */
export function parseJsonObject(raw: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonObject;
  } catch {
    // invalid JSON -> treated as empty by the caller
  }
  return {};
}

// ─── Config shape ─────────────────────────────────────────────────────

/**
 * Alert settings get the same treatment as the rest of the config: coerce, never
 * trust. Exported so the coercion can be pinned by a unit test.
 */
export function sanitizeAlerts(input: unknown): AlertSettings {
  const raw: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    enabled: bool(raw.enabled, DEFAULT_CONFIG.alerts.enabled),
    sound: raw.sound === "system" || raw.sound === "off" ? raw.sound : "chime",
    volume: num(raw.volume, DEFAULT_CONFIG.alerts.volume, 0, 1),
    onTurnEnd: bool(raw.onTurnEnd, DEFAULT_CONFIG.alerts.onTurnEnd),
    onApproval: bool(raw.onApproval, DEFAULT_CONFIG.alerts.onApproval),
    minIntervalMs: num(raw.minIntervalMs, DEFAULT_CONFIG.alerts.minIntervalMs, 0, 60_000),
  };
}

/**
 * config.json is hand-editable and the settings window sends `Partial` over IPC,
 * so the shape is never guaranteed. Coerce everything instead of trusting it
 * (a string `args` used to be spread into single-character argv entries).
 */
/**
 * Saved projects, straight from a file the user may have edited by hand. Anything that is not a
 * usable absolute path is dropped rather than repaired: a half-read project would be a row that
 * cannot be switched to, and re-adding one costs a native dialog.
 */
export function sanitizeProjects(input: unknown): Project[] {
  if (!Array.isArray(input)) return [];
  const out: Project[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<Project>;
    const path = typeof row.path === "string" ? row.path.trim() : "";
    if (!path || !isAbsolute(path)) continue;
    // The same directory spelled two ways is one project; the first spelling wins.
    const key = path.replace(/[\\/]+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path,
      name:
        typeof row.name === "string" && row.name.trim() ? row.name.trim() : basename(path) || path,
      addedAt: typeof row.addedAt === "number" && Number.isFinite(row.addedAt) ? row.addedAt : 0,
      lastUsedAt:
        typeof row.lastUsedAt === "number" && Number.isFinite(row.lastUsedAt) ? row.lastUsedAt : 0,
    });
  }
  return out;
}

export function sanitizeConfig(input: unknown): StandaloneConfig {
  const raw: Record<string, unknown> =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const env: Record<string, string> = {};
  if (raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)) {
    for (const [k, v] of Object.entries(raw.env as Record<string, unknown>)) {
      if (typeof v === "string") env[k] = v;
    }
  }

  return {
    piPath: str(raw.piPath, DEFAULT_CONFIG.piPath),
    language:
      raw.language === "en" || raw.language === "zh-cn" || raw.language === "auto"
        ? raw.language
        : DEFAULT_CONFIG.language,
    env,
    args: strArray(raw.args),
    disabledTools: strArray(raw.disabledTools),
    permissionMode: raw.permissionMode === "FullAccess" ? "FullAccess" : "AskForApproval",
    dangerousPatterns: strArray(raw.dangerousPatterns),
    mcpEnabled: bool(raw.mcpEnabled, DEFAULT_CONFIG.mcpEnabled),
    mcpIdleTimeout: num(raw.mcpIdleTimeout, DEFAULT_CONFIG.mcpIdleTimeout, 0, 1440),
    chatFontSize: num(raw.chatFontSize, DEFAULT_CONFIG.chatFontSize, 8, 32),
    chatSendShortcut: raw.chatSendShortcut === "ctrlEnter" ? "ctrlEnter" : "enter",
    chatMermaidTheme: str(raw.chatMermaidTheme, DEFAULT_CONFIG.chatMermaidTheme),
    chatBackgroundImage: str(raw.chatBackgroundImage, DEFAULT_CONFIG.chatBackgroundImage),
    chatBackgroundOpacity: num(
      raw.chatBackgroundOpacity,
      DEFAULT_CONFIG.chatBackgroundOpacity,
      0,
      1,
    ),
    rpcTrace: bool(raw.rpcTrace, DEFAULT_CONFIG.rpcTrace),
    workspaceRoot: str(raw.workspaceRoot, DEFAULT_CONFIG.workspaceRoot),
    pinnedSessions: strArray(raw.pinnedSessions),
    theme: raw.theme === "light" || raw.theme === "system" ? raw.theme : "dark",
    accent: /^#[0-9a-f]{6}$/i.test(str(raw.accent, ""))
      ? str(raw.accent, "")
      : DEFAULT_CONFIG.accent,
    favoriteModels: strArray(raw.favoriteModels),
    budgetDailyUsd: num(raw.budgetDailyUsd, DEFAULT_CONFIG.budgetDailyUsd, 0, 100000),
    budgetMonthlyUsd: num(raw.budgetMonthlyUsd, DEFAULT_CONFIG.budgetMonthlyUsd, 0, 1000000),
    openAtLogin: bool(raw.openAtLogin, DEFAULT_CONFIG.openAtLogin),
    showArchived: bool(raw.showArchived, DEFAULT_CONFIG.showArchived),
    restoreWindows: bool(raw.restoreWindows, DEFAULT_CONFIG.restoreWindows),
    autoCheckUpdates: bool(raw.autoCheckUpdates, DEFAULT_CONFIG.autoCheckUpdates),
    recentWorkspaces: strArray(raw.recentWorkspaces).slice(0, 8),
    projects: sanitizeProjects(raw.projects),
    sidebarGroupBy: raw.sidebarGroupBy === "project" ? "project" : "time",
    uiLanguage:
      raw.uiLanguage === "en" || raw.uiLanguage === "zh-cn" || raw.uiLanguage === "auto"
        ? raw.uiLanguage
        : DEFAULT_CONFIG.uiLanguage,
    lastOnboardedVersion: str(raw.lastOnboardedVersion, DEFAULT_CONFIG.lastOnboardedVersion).slice(
      0,
      40,
    ),
    commitLanguage: str(raw.commitLanguage, DEFAULT_CONFIG.commitLanguage).slice(0, 40),
    commitMessagePrompt: str(raw.commitMessagePrompt, DEFAULT_CONFIG.commitMessagePrompt).slice(
      0,
      8000,
    ),
    alerts: sanitizeAlerts(raw.alerts),
  };
}

// ─── Secrets: a renderer never receives a raw API key ─────────────────

export const SECRET_FIELDS = [
  "apiKey",
  "apikey",
  "key",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "password",
];
export const MASK = "••••••••";

export function maskSecret(value: unknown): string {
  if (typeof value !== "string") return "";
  if (!value) return value;
  if (value.length <= 8) return MASK;
  return value.slice(0, 4) + MASK + value.slice(-4);
}

/** auth.json -> masked copy that is safe to render. Real values stay in main. */
export function authToPublic(rawJson: string): string {
  const obj = parseJsonObject(rawJson);
  const out: JsonObject = {};
  for (const [provider, val] of Object.entries(obj)) {
    if (typeof val === "string") out[provider] = maskSecret(val);
    else if (val && typeof val === "object" && !Array.isArray(val)) {
      const clone: JsonObject = { ...val };
      for (const f of SECRET_FIELDS) if (f in clone) clone[f] = maskSecret(clone[f]);
      out[provider] = clone;
    } else out[provider] = val;
  }
  return JSON.stringify(out, null, 2);
}

/**
 * Undo masking on write: a form field that still shows the placeholder means
 * "unchanged", so the on-disk secret is kept instead of the placeholder string.
 */
export function restoreMaskedSecrets(
  incoming: JsonValue,
  current: JsonValue | undefined,
): JsonValue {
  if (typeof incoming === "string") {
    if (typeof current === "string" && incoming === maskSecret(current)) return current;
    return incoming;
  }
  if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
    const cur: JsonObject =
      current && typeof current === "object" && !Array.isArray(current) ? current : {};
    const out: JsonObject = {};
    for (const [k, v] of Object.entries(incoming)) out[k] = restoreMaskedSecrets(v, cur[k]);
    return out;
  }
  return incoming;
}

// ─── shell.openPath guard ─────────────────────────────────────────────

/** Extensions that turn "open in default app" into code execution. */
export const UNSAFE_OPEN_EXT: ReadonlySet<string> = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".msi",
  ".msp",
  ".msix",
  ".appx",
  ".appinstaller",
  ".scr",
  ".pif",
  ".cpl",
  ".hta",
  ".jar",
  ".lnk",
  ".url",
  ".reg",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".ws",
  ".ps1",
  ".psm1",
  ".psd1",
  ".msc",
  ".gadget",
  ".inf",
  ".scf",
  ".dll",
  ".sys",
  ".drv",
  ".ocx",
  ".iso",
  ".img",
  ".vhd",
  ".vhdx",
  ".chm",
]);

export type OpenCheck = { ok: true; path: string } | { ok: false; error: string };

/**
 * Decide whether a path may be handed to shell.openPath. Pure on purpose: the
 * caller does the actual shell call (and logs the rejection).
 */
export function checkOpenPath(raw: string, workspaceRoot: string): OpenCheck {
  const p = String(raw ?? "");
  if (!p) return { ok: false, error: "empty path" };
  // UNC (\\host\share) and device paths (\\.\, \\?\) — network / device access
  if (p.startsWith("\\\\") || p.startsWith("//"))
    return { ok: false, error: "UNC/device path blocked" };

  // Windows drops trailing dots and spaces when it resolves a name, so
  // "evil.exe." and "evil.exe " have to be judged as "evil.exe". Judging the
  // raw string instead is how a blocklist gets walked around: extname("x.exe.")
  // is ".", which matches nothing.
  const normalized = p.replace(/[ .]+$/, "");
  if (!normalized) return { ok: false, error: "empty path" };
  let full = normalized;
  if (!isAbsolute(full) && workspaceRoot) full = resolve(workspaceRoot, full);

  const ext = extname(full).toLowerCase();
  if (UNSAFE_OPEN_EXT.has(ext)) return { ok: false, error: `executable type blocked: ${ext}` };
  // A name whose extension existed only before normalization ("payload.") is
  // refused rather than guessed at; genuinely extension-less files ("Makefile",
  // ".gitignore") still pass.
  if (!ext && extname(normalized) !== "") return { ok: false, error: "suspicious filename" };
  return { ok: true, path: full };
}
