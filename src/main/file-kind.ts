/**
 * Which preview a file gets in the dock's file panel.
 *
 * The panel used to offer exactly one answer for every file: read it as UTF-8 and put it in the
 * editor. That is right for text and wrong for everything else — clicking a PNG filled the editor
 * with replacement characters, and the only way to look at an image was "open it in the system
 * program".
 *
 * This module is the single source of truth for the decision. It is pure and dependency-free on
 * purpose: the dock's script is a *string* (it runs in the chat window's renderer), so the main
 * process injects these extension lists into it instead of the lists being written twice. That
 * keeps them unit-testable without opening a window, and keeps the renderer from disagreeing with
 * the handler about what an image is.
 */

export type PreviewKind = "image" | "audio" | "text";

/** Extensions the panel renders as an <img>. `.svg` is safe here: an <img> never runs its script. */
export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".avif",
  ".svg",
];

/** Extensions the panel renders as an <audio controls>. */
export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus"];

const MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
} as const;

/**
 * The extension of `name`, lowercased, including the dot — or `""` when there is none.
 *
 * The last separator wins on purpose: `a.b/README` is a file called README with **no** extension,
 * and reading it as a `.b` would send it to the media branch. Directories are not passed here, but
 * the dock's paths arrive as plain strings and can carry either separator.
 */
export function extensionOf(name: string): string {
  const s = String(name ?? "")
    .trim()
    .toLowerCase();
  const dot = s.lastIndexOf(".");
  const slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return dot > slash ? s.slice(dot) : "";
}

export function previewKindFor(name: string): PreviewKind {
  const ext = extensionOf(name);
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return "text";
}

/** The MIME type for a previewable extension, or `null` when the file is not media. */
export function mediaMimeFor(name: string): string | null {
  const ext = extensionOf(name);
  if (!(ext in MIME_BY_EXTENSION)) return null;
  return MIME_BY_EXTENSION[ext as keyof typeof MIME_BY_EXTENSION];
}
