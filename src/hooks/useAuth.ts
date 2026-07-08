'use client';

/**
 * Session hook — Better Auth edition.
 *
 * Wraps better-auth's `useSession` while preserving the interface the data
 * hooks consumed from the pre-migration version: `{ user, session, loading,
 * signOut }`. `user.id` is a 32-char better-auth id (not a UUID).
 */
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { authClient, useSession } from '@/lib/auth/client';

type SessionData = ReturnType<typeof useSession>['data'];

export type AuthUser = NonNullable<SessionData>['user'];
export type AuthSession = NonNullable<SessionData>['session'];

export function useAuth() {
  const { data, isPending } = useSession();
  const router = useRouter();

  const signOut = useCallback(async () => {
    await authClient.signOut();
    router.push('/login');
  }, [router]);

  return {
    user: data?.user ?? null,
    session: data?.session ?? null,
    loading: isPending,
    signOut,
  };
}
