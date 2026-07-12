/**
 * Fire-and-forget scheduling for route handlers.
 *
 * Next's `after()` (next/server) is the documented way to run work AFTER the
 * response is sent — supported on the Node.js server / Docker deployment this
 * app ships as (see the after() Platform Support table). It is the right tool
 * for the health-summary background refresh: the user gets the last good
 * summary instantly, and regeneration happens off the response path.
 *
 * `after()` throws synchronously when called outside a request scope (e.g. unit
 * tests that invoke a route's GET() directly, with no Next request context).
 * Because the app runs as a long-lived Node process — not a serverless function
 * that freezes after responding — a plain detached promise is a perfectly valid
 * fallback there. So we try `after()` first and fall back to running detached.
 *
 * Errors are always swallowed: background work must never surface to the caller.
 */
import { after } from 'next/server';

export function scheduleAfterResponse(task: () => Promise<unknown>): void {
  const run = () => {
    void Promise.resolve()
      .then(task)
      .catch(() => {
        // Background work is best-effort; a failure must not break anything
        // (and must never overwrite a good cached row — the caller guarantees
        // it only writes on success).
      });
  };
  try {
    after(run);
  } catch {
    // No request scope — run detached on the current process.
    run();
  }
}
