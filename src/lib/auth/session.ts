/**
 * App Router session helpers.
 *
 * Server components / route handlers use `getUser()` (null-safe) or
 * `requireUser()` (throws UnauthorizedError → map to 401 JSON in routes).
 * Do NOT import from proxy.ts — the proxy only checks cookie presence.
 */
import { headers } from 'next/headers';
import { auth } from './index';

export type SessionUser = (typeof auth.$Infer.Session)['user'];
export type SessionRecord = (typeof auth.$Infer.Session)['session'];

export interface SessionInfo {
  user: SessionUser;
  session: SessionRecord;
}

export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Current signed-in user, or null. Never throws for missing/invalid sessions. */
export async function getUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** Current signed-in user; throws UnauthorizedError (status 401) if absent. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Full session (user + session record incl. createdAt), or null. Used by
 *  freshness checks like require-recent-auth. */
export async function getSessionInfo(): Promise<SessionInfo | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return { user: session.user, session: session.session };
}
