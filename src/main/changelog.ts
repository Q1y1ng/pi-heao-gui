/**
 * "pi 更新日志" — a direct port of upstream `src/chat/pi-changelog.ts`.
 *
 * The changelog belongs to the pi *package*, not to the app, so the package root
 * is found by walking up from the resolved pi binary looking for a package.json
 * whose name is the pi package, with `npm root -g` as a fallback (that is what
 * upstream does, including the 20 000 character cap).
 */
import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { log, errText } from "./log";

const execFileAsync = promisify(execFile);
export const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const MAX_CHARS = 20000;
const MAX_DEPTH = 12;

export function truncate(content: string, max = MAX_CHARS): string {
  return content.length > max ? `${content.slice(0, max)}\n\n...(已截断)...` : content;
}

/** Walk up from `startDir` until a package.json with the pi package name appears. */
export async function findPackageRoot(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < MAX_DEPTH; i++) {
    try {
      const raw = await readFile(join(dir, "package.json"), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { name?: unknown }).name === PI_PACKAGE_NAME
      ) {
        return dir;
      }
    } catch {
      // not this directory — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function readChangelogAt(dir: string): Promise<string | null> {
  try {
    return truncate(await readFile(join(dir, "CHANGELOG.md"), "utf8"));
  } catch {
    return null;
  }
}

export interface ChangelogResult {
  ok: boolean;
  content?: string;
  root?: string;
  version?: string;
  error?: string;
}

/** Resolve the pi package root, then read its CHANGELOG.md. */
export async function readPiChangelog(piPath: string | undefined): Promise<ChangelogResult> {
  if (!piPath) return { ok: false, error: "未找到 pi 可执行文件" };

  let resolved = piPath;
  try {
    resolved = await realpath(piPath);
  } catch {
    // keep the original path — the walk-up still often works
  }

  const candidates: string[] = [];
  const fromBinary = await findPackageRoot(dirname(resolved));
  if (fromBinary) candidates.push(fromBinary);

  try {
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    const { stdout } = await execFileAsync(npmBin, ["root", "-g"], { timeout: 15_000 });
    const globalRoot = stdout.trim();
    if (globalRoot) candidates.push(join(globalRoot, PI_PACKAGE_NAME));
  } catch (e) {
    log.warn("changelog: npm root -g failed:", errText(e));
  }

  for (const dir of candidates) {
    const content = await readChangelogAt(dir);
    if (content !== null) {
      let version: string | undefined;
      try {
        const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
          version?: string;
        };
        version = pkg.version;
      } catch {
        // version is optional metadata for the header only
      }
      return { ok: true, content, root: dir, version };
    }
  }

  return { ok: false, error: "未找到 pi 的 CHANGELOG.md（可能安装方式不含该文件）" };
}

/** Cheap existence probe used by the settings tab (avoids reading 20k chars twice). */
export async function changelogPathExists(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, "CHANGELOG.md"));
    return true;
  } catch {
    return false;
  }
}
