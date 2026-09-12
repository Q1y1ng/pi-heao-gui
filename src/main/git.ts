/**
 * Git support, ported from upstream `src/gitCommit/*`:
 *   - `truncateDiffByFile` is a direct port (a plain head-cut used to drop every
 *     file after the first large one);
 *   - the commit-message prompts are upstream's defaults verbatim, including the
 *     commit-language instruction;
 *   - generation runs pi as a separate one-shot process, exactly like upstream
 *     used a resource-loader-isolated session, so the chat session is untouched.
 */
import { runPiCli } from "./pi-cli";
import { log, errText } from "./log";

/** Upstream's default system prompt (conventional commits). */
export const DEFAULT_COMMIT_SYSTEM_PROMPT =
  "You are a helpful assistant that generates informative git commit messages based on git diffs output. Skip preamble and remove all backticks surrounding the commit message. Based on the provided git diff, generate a conventional format commit message.\n\n```\n<type>[optional scope]: <description>\n\n[optional body list]\n```";

export const DEFAULT_COMMIT_USER_PROMPT =
  "Notes from developer (ignore if not relevant): {{USER_CURRENT_INPUT}}";

const TRUNCATED_DIFF_SIZE = 64 * 1024;
export const FILE_TRUNCATED_MARK = "\n[... file diff truncated ...]";

/**
 * Split a diff by `diff --git` headers and truncate each file's chunk so the
 * total stays within `maxSize`, keeping every file represented.
 */
export function truncateDiffByFile(diff: string, maxSize: number): string {
  if (diff.length <= maxSize) return diff;

  const firstHeader = diff.indexOf("diff --git ");
  const preamble = firstHeader > 0 ? diff.slice(0, firstHeader) : "";
  const body = firstHeader >= 0 ? diff.slice(firstHeader) : diff;

  const indices: number[] = [];
  const headerRegex = /^diff --git .*$/gm;
  let m: RegExpExecArray | null = headerRegex.exec(body);
  while (m !== null) {
    indices.push(m.index);
    m = headerRegex.exec(body);
  }
  if (indices.length === 0) return diff.slice(0, maxSize);

  const chunks: string[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : body.length;
    chunks.push(body.slice(start, end));
  }

  const budget = Math.max(1000, maxSize - preamble.length);
  const perFile = Math.max(500, Math.floor(budget / chunks.length));
  const kept = chunks.map((chunk) =>
    chunk.length <= perFile
      ? chunk
      : chunk.slice(0, Math.max(0, perFile - FILE_TRUNCATED_MARK.length)) + FILE_TRUNCATED_MARK,
  );
  return preamble + kept.join("");
}

export interface CommitPromptInput {
  diff: string;
  /** Whatever the user already typed in the commit box. */
  currentInput?: string;
  language?: string;
  systemPrompt?: string;
}

/** Build the system + user prompt exactly as upstream does. */
export function buildCommitPrompt(input: CommitPromptInput): { system: string; user: string } {
  const system = input.systemPrompt?.trim() || DEFAULT_COMMIT_SYSTEM_PROMPT;
  const language = (input.language || "English").trim() || "English";
  const parts: string[] = [];
  const notes = (input.currentInput || "").trim();
  if (notes) parts.push(DEFAULT_COMMIT_USER_PROMPT.replace("{{USER_CURRENT_INPUT}}", notes));
  parts.push(truncateDiffByFile(input.diff, TRUNCATED_DIFF_SIZE));
  return {
    system: `${system}\n\nGenerate commit message in ${language}.`,
    user: parts.join("\n\n"),
  };
}

/** Strip code fences / stray backticks the model sometimes adds. */
export function cleanCommitMessage(text: string): string {
  let out = text.trim();
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(out);
  if (fenced) out = fenced[1].trim();
  out = out.replace(/^["'`]+|["'`]+$/g, "").trim();
  return out;
}

export interface CommitMessageResult {
  ok: boolean;
  message?: string;
  error?: string;
  /** True when the diff had to be truncated before sending. */
  truncated?: boolean;
}

/**
 * Ask pi (one-shot, no session, no tools) for a commit message for `diff`.
 */
export async function generateCommitMessage(opts: {
  piPath: string;
  cwd: string;
  diff: string;
  currentInput?: string;
  language?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}): Promise<CommitMessageResult> {
  const prompt = buildCommitPrompt({
    diff: opts.diff,
    currentInput: opts.currentInput,
    language: opts.language,
    systemPrompt: opts.systemPrompt,
  });
  const args = ["-p", prompt.user, "--system-prompt", prompt.system, "--no-session", "--no-tools"];
  const res = await runPiCli(opts.piPath, args, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs ?? 180_000,
  });
  if (!res.ok) {
    log.warn("commit message generation failed:", res.error || res.stderr.slice(0, 200));
    return { ok: false, error: res.error || res.stderr.trim().slice(0, 400) || "生成失败" };
  }
  const message = cleanCommitMessage(res.stdout);
  if (!message) return { ok: false, error: "模型没有返回内容" };
  return { ok: true, message, truncated: opts.diff.length > TRUNCATED_DIFF_SIZE };
}

/** `git` runner used by the status/diff IPC handlers. */
export async function git(
  args: string[],
  cwd: string,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const res = await runPiCli("git", args, { cwd, timeoutMs });
    return { ok: res.ok, stdout: res.stdout, stderr: res.stderr };
  } catch (e) {
    return { ok: false, stdout: "", stderr: errText(e) };
  }
}
