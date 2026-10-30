'use client';

import { useEffect } from 'react';
import { authClient, useSession } from '@/lib/auth/client';
import { startIdleSession } from '@/lib/auth/idle-activity';

interface AutoLogoutProps {
  timeoutMinutes: number;
}

/** Each login has one shared inactivity deadline across browser/TWA documents. */
export function AutoLogout({ timeoutMinutes }: AutoLogoutProps) {
  const { data, isPending } = useSession();
  const sessionId = data?.session.id;

  useEffect(() => {
    if (isPending || !sessionId) return;
    return startIdleSession({
      sessionId,
      timeoutMs: timeoutMinutes * 60 * 1000,
      getCurrentSessionId: async () => {
        const result = await authClient.getSession({
          query: { disableCookieCache: true, disableRefresh: true },
        });
        if (result.error) throw new Error('Session check unavailable');
        return result.data?.session.id ?? null;
      },
      signOut: async () => {
        await authClient.signOut();
      },
      onSessionChanged: () => {
        // Reauthorize a neutral page and discard the previous account/person state.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/health';
      },
      onTimeout: () => {
        // A full navigation discards the expired record/person state.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/login?reason=timeout';
      },
    });
  }, [isPending, sessionId, timeoutMinutes]);

  return null;
}
