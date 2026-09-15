import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge for the SETTINGS window.
 * Narrow surface on purpose: this window is the only one allowed to read/write
 * ~/.pi/agent/{auth,settings,models}.json, SYSTEM.md and APPEND_SYSTEM.md.
 * The chat window gets preload.ts, which cannot reach these channels at all.
 */
const ALLOWED = new Set<string>([
  "pi:get-config",
  "pi:set-config",
  "pi:read-agent-files",
  "pi:write-agent-files",
  "pi:get-env-info",
  "pi:toggle-extension",
  "pi:open-settings",
  "pi:diagnostics",
  "pi:pkg-list",
  "pi:pkg-install",
  "pi:pkg-remove",
  "pi:auth-status",
  "pi:login-provider",
  "pi:changelog",
  "pi:update-status",
  "pi:update-check",
  "pi:update-install",
  "pi:read-skill",
  "pi:write-skill",
  "pi:delete-skill",
  // Settings-only: plays an alert sound on demand for the 试听 buttons. The chat
  // window must not reach this — it renders untrusted agent output.
  "pi:alert-test",
]);

contextBridge.exposeInMainWorld("pi", {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!ALLOWED.has(channel)) {
      console.error("[pi-preload-settings] blocked channel:", channel);
      return Promise.reject(new Error(`blocked channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
