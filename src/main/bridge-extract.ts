/**
 * Extract bundled bridge extensions from asar to a real filesystem path.
 * pi child process cannot read Electron asar archives.
 */
import { app } from "electron";
import { join, } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";

let extractedBridgeDir: string | null = null;

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      // readFileSync works with asar paths (Electron patches fs)
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

/**
 * Returns a real filesystem path to the bridge/ directory.
 * In dev (no asar), returns the original path.
 * In packaged app, extracts to userData/bridge-extracted/ and returns that.
 */
export function getRealBridgeDir(appPath: string): string {
  const bridgeDir = join(appPath, "vendor", "upstream", "bridge");

  // Not in asar — use original path directly
  if (!appPath.includes("app.asar")) {
    return bridgeDir;
  }

  // Already extracted this session
  if (extractedBridgeDir && existsSync(extractedBridgeDir)) {
    return extractedBridgeDir;
  }

  // Extract to userData
  const dest = join(app.getPath("userData"), "bridge-extracted");
  try {
    copyDirRecursive(bridgeDir, dest);
    extractedBridgeDir = dest;
    console.log("[bridge-extract] extracted to", dest);
    // Verify key files exist
    const todoPath = join(dest, "todo.ts");
    if (!existsSync(todoPath)) {
      console.error("[bridge-extract] todo.ts missing after extraction!");
    } else {
      console.log("[bridge-extract] todo.ts OK,", statSync(todoPath).size, "bytes");
    }
    return dest;
  } catch (e) {
    console.error("[bridge-extract] failed:", e);
    return bridgeDir;
  }
}
