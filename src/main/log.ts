/**
 * One logger for the main process.
 *
 * Keeps diagnostics consistent (single prefix, single place to silence them)
 * instead of scattered console.* calls. Best-effort paths log a warning and
 * keep going — nothing here ever throws.
 */
const PREFIX = "[pi-heao]";

let quiet = false;

/** Silence info-level noise (used by the test/smoke harness). */
export function setQuiet(value: boolean): void {
  quiet = value;
}

export const log = {
  info(message: string, ...rest: unknown[]): void {
    if (!quiet) console.log(PREFIX, message, ...rest);
  },
  warn(message: string, ...rest: unknown[]): void {
    console.warn(PREFIX, message, ...rest);
  },
  error(message: string, ...rest: unknown[]): void {
    console.error(PREFIX, message, ...rest);
  },
};

/** Normalize an unknown thrown value into a short message for logs. */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : String(e);
}
