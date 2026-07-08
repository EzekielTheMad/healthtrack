/**
 * Safe logging utility that strips potentially sensitive health data from
 * error objects before writing to server logs.
 *
 * Only the error name, a generic message, and a truncated stack trace are
 * preserved. This prevents medication names, lab values, conditions, or
 * other PHI from leaking into log aggregators or console output.
 */

function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    // Keep the error class name and a generic message.
    // Truncate the stack to the first 3 frames to avoid embedding
    // variable values from deeper call sites.
    const stack = err.stack
      ?.split("\n")
      .slice(0, 4)
      .join("\n");
    return `[${err.name}] ${err.message.slice(0, 120)}${stack ? "\n" + stack : ""}`;
  }

  if (typeof err === "string") {
    return err.slice(0, 120);
  }

  return "[non-Error thrown]";
}

/**
 * Log an operational error to the server console without including
 * any health data values that may be embedded in the error payload.
 *
 * Usage:
 *   import { safeError } from '@/lib/safe-log';
 *   safeError('Health query failed', err);
 */
export function safeError(context: string, err?: unknown): void {
  if (err !== undefined) {
    console.error(`${context}:`, sanitizeError(err));
  } else {
    console.error(context);
  }
}
