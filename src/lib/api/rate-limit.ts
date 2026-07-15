/**
 * Simple in-memory sliding-window rate limiter, keyed by an arbitrary string
 * (typically `"<bucket>:<userId>"`). Adequate for the single-container
 * self-hosted topology (one process): it protects an operator's Anthropic bill
 * and blunts abuse of expensive AI/model routes. It is NOT shared across
 * replicas and resets on restart — acceptable given the deployment shape.
 *
 * Auth brute-force limiting is handled separately by Better Auth's own limiter
 * (see src/lib/auth/index.ts); this is for our application/AI routes.
 */
const buckets = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 5000;

export interface RateLimit {
  /** Max requests allowed within the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Common presets. */
export const HOUR_MS = 60 * 60 * 1000;

/**
 * Returns true if the request is allowed (and records it), false if the caller
 * has exceeded `max` within `windowMs`.
 */
export function checkRateLimit(key: string, limit: RateLimit): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < limit.windowMs);

  if (recent.length >= limit.max) {
    buckets.set(key, recent);
    return false;
  }

  recent.push(now);
  buckets.set(key, recent);

  // Opportunistic cleanup so the map can't grow unbounded in a long-lived
  // process.
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, v] of buckets) {
      const fresh = v.filter((t) => now - t < limit.windowMs);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }

  return true;
}
