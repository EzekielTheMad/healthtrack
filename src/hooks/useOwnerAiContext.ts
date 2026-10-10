'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useAuth } from '@/hooks/useAuth';
import { OWNER_AI_CONTEXT_VERSION, OWNER_AI_ONLY_MESSAGE } from '@/lib/claude/owner-context';

export const OWNER_AI_NOTICE = `${OWNER_AI_ONLY_MESSAGE} Switch to My Health to view your own results.`;

/** A separate identity for every profile visit, including self → other → self. */
export function useOwnerAiContext(enabled = true) {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const { user, loading } = useAuth();
  const ownerId = user?.id ?? null;
  const isOwnerProfile = dependentId === null && delegateOwnerId === null;
  const available = enabled && !loading && Boolean(ownerId) && isOwnerProfile;
  const token = useMemo(
    () => ({}),
    // Each selection/session transition invalidates retained callbacks and data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownerId, loading, dependentId, delegateOwnerId, enabled]
  );
  const active = useRef<{ token: object; controller: AbortController } | null>(null);

  useLayoutEffect(() => {
    const lifetime = { token, controller: new AbortController() };
    active.current = lifetime;
    return () => {
      lifetime.controller.abort();
      if (active.current === lifetime) active.current = null;
    };
  }, [token]);

  // Capture the committed lifetime before any request or state change. Checking
  // both the token and lifetime also invalidates requests on Strict Mode replay.
  const capture = useCallback(() => {
    const lifetime = active.current;
    return {
      signal: lifetime?.controller.signal,
      isCurrent: () =>
        available &&
        lifetime !== null &&
        lifetime.token === token &&
        active.current === lifetime &&
        !lifetime.controller.signal.aborted,
    };
  }, [available, token]);

  const matchesContext = useCallback(
    (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const context = value as Record<string, unknown>;
      return (
        Boolean(ownerId) &&
        context.ownerId === ownerId &&
        context.dependentId === null &&
        context.contextVersion === OWNER_AI_CONTEXT_VERSION
      );
    },
    [ownerId]
  );

  return { ownerId, token, available, isOwnerProfile, capture, matchesContext };
}
