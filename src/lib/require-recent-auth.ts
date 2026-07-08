/**
 * Maximum age (in ms) of the user's session before we require
 * re-authentication for sensitive actions like data export or account
 * deletion.
 *
 * Set to 5 minutes — same window the pre-migration check applied to
 * `last_sign_in_at`. With Better Auth the equivalent freshness signal is the
 * session's `createdAt`: signing in again mints a new session, so a recent
 * password prompt yields a recent `createdAt`.
 */
const MAX_AUTH_AGE_MS = 5 * 60 * 1000;

/**
 * Returns true if the session was created recently enough to allow a
 * destructive / sensitive action. The client is expected to re-authenticate
 * (sign in again) immediately before such actions so the session is fresh.
 */
export function isRecentlyAuthenticated(session: {
  createdAt: Date | string;
}): boolean {
  const created = new Date(session.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  return Date.now() - created < MAX_AUTH_AGE_MS;
}
