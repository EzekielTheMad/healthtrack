/**
 * Better Auth React client (browser side).
 *
 * baseURL is intentionally omitted — the client targets the same origin's
 * /api/auth/* handler, which works for any APP_URL the instance runs behind.
 */
'use client';

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
