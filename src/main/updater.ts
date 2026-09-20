/**
 * Update checks over the GitHub releases of this repository (electron-updater).
 *
 * The updater is injected rather than imported directly, for two reasons:
 *
 *   - the state machine is then unit-testable without a packaged app, a network
 *     or an update server: the tests drive the events by hand;
 *   - `electron-updater` is optional at runtime. If it cannot be loaded (a
 *     stripped build, a failed native dependency), the app must still start and
 *     simply report that updates are unavailable — never crash on launch.
 */
import { log, errText } from "./log";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; current: string }
  | { state: "none"; current: string }
  | { state: "downloading"; percent: number; version: string }
  | { state: "ready"; version: string }
  | { state: "error"; message: string }
  | { state: "unavailable"; reason: string };

/** The slice of electron-updater's autoUpdater this app actually uses. */
export interface UpdaterLike {
  autoDownload: boolean;
  on(event: string, listener: (...args: never[]) => void): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall?(isSilent?: boolean, forceRunAfter?: boolean): void;
}

export interface UpdaterDeps {
  updater: UpdaterLike;
  currentVersion: string;
  /** Update checks are meaningless for a source checkout. */
  isPackaged: boolean;
  /**
   * A portable build cannot replace itself — see the constructor's reason in main.ts. It shares
   * the release channel with the installer, so without this the "check for updates" button offers
   * a portable user the NSIS setup program.
   */
  isPortable?: boolean;
  autoDownload?: boolean;
  logWarn?: (message: string, error?: unknown) => void;
  onStatus?: (status: UpdateStatus) => void;
}

export interface UpdateController {
  init(): void;
  status(): UpdateStatus;
  check(options?: { manual?: boolean }): Promise<UpdateStatus>;
  install(): { ok: boolean; error?: string };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

/**
 * Why a portable build does not update itself.
 *
 * The portable target shares the installer's release channel: `latest.yml` lists the NSIS setup
 * program, and installing it over a portable copy would leave a second, installed copy behind
 * rather than replacing the file being run. electron-updater has no portable-specific path, so the
 * honest answer is to say so and point at the download instead of offering an update.
 */
const PORTABLE_REASON =
  "便携版不自动更新：请从 Releases 下载新的 Portable.exe 替换当前文件（安装版才有自动更新）";

export { PORTABLE_REASON };

/** The state a fresh controller starts in, before anything is checked. */
function initialState(deps: UpdaterDeps): UpdateStatus {
  if (!deps.isPackaged) return { state: "unavailable", reason: "当前为源码运行，不检查更新" };
  if (deps.isPortable) return { state: "unavailable", reason: PORTABLE_REASON };
  return { state: "idle" };
}

export function createUpdateController(deps: UpdaterDeps): UpdateController {
  const warn =
    deps.logWarn ?? ((message: string, error?: unknown) => log.warn(message, errText(error)));
  const autoDownload = deps.autoDownload !== false;

  let current: UpdateStatus = initialState(deps);
  let checking = false;

  const set = (status: UpdateStatus): UpdateStatus => {
    current = status;
    try {
      deps.onStatus?.(status);
    } catch (e) {
      warn("updater: status listener failed:", e);
    }
    return status;
  };

  function init(): void {
    if (!deps.isPackaged || deps.isPortable) return;
    const updater = deps.updater;
    // Download in the background; the user is told when it is ready to install.
    updater.autoDownload = autoDownload;
    updater.on("checking-for-update", () => set({ state: "checking" }));
    updater.on("update-available", (info: { version?: string }) =>
      set({
        state: "available",
        version: String(info?.version ?? ""),
        current: deps.currentVersion,
      }),
    );
    updater.on("update-not-available", () => set({ state: "none", current: deps.currentVersion }));
    updater.on("download-progress", (progress: { percent?: number }) =>
      set({
        state: "downloading",
        percent: Math.max(0, Math.min(100, Math.round(Number(progress?.percent ?? 0)))),
        version:
          current.state === "available" || current.state === "downloading" ? current.version : "",
      }),
    );
    updater.on("update-downloaded", (info: { version?: string }) =>
      set({ state: "ready", version: String(info?.version ?? "") }),
    );
    updater.on("error", (error: unknown) => {
      warn("updater: check failed:", error);
      set({ state: "error", message: messageOf(error) });
    });
  }

  async function check(_options: { manual?: boolean } = {}): Promise<UpdateStatus> {
    if (!deps.isPackaged) {
      return set({ state: "unavailable", reason: "当前为源码运行，不检查更新" });
    }
    // Refused before the updater is asked anything: `latest.yml` on the release lists the NSIS
    // installer, and downloading it would either fail or install a second copy over nothing.
    if (deps.isPortable) {
      return set({ state: "unavailable", reason: PORTABLE_REASON });
    }
    if (checking) return current;
    checking = true;
    set({ state: "checking" });
    try {
      await deps.updater.checkForUpdates();
    } catch (e) {
      warn("updater: checkForUpdates threw:", e);
      set({ state: "error", message: messageOf(e) });
    } finally {
      checking = false;
    }
    return current;
  }

  function install(): { ok: boolean; error?: string } {
    if (deps.isPortable) {
      return { ok: false, error: PORTABLE_REASON };
    }
    if (current.state !== "ready") {
      return { ok: false, error: "还没有下载完成的更新" };
    }
    if (typeof deps.updater.quitAndInstall !== "function") {
      return { ok: false, error: "当前环境不支持自动安装" };
    }
    try {
      // Silent, and start again afterwards: the user asked to update, not to quit.
      deps.updater.quitAndInstall(true, true);
      return { ok: true };
    } catch (e) {
      warn("updater: quitAndInstall failed:", e);
      return { ok: false, error: messageOf(e) };
    }
  }

  return { init, status: () => current, check, install };
}
