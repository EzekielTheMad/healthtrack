'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { InteractionAlert, InteractionStatus } from '@/lib/types';

interface InteractionPayload {
  alerts: InteractionAlert[];
  status: InteractionStatus | null;
  snoozed_count: number;
}
const EMPTY: InteractionPayload = { alerts: [], status: null, snoozed_count: 0 };
interface ViewState {
  scope: string;
  data: InteractionPayload;
  loading: boolean;
  checking: boolean;
  error: string | null;
}

export function useInteractionAlerts() {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const scope = JSON.stringify([delegateOwnerId, dependentId]);
  const [view, setView] = useState<ViewState>({
    scope,
    data: EMPTY,
    loading: true,
    checking: false,
    error: null,
  });
  // A generation, rather than just an ID comparison, also handles A -> B -> A
  // while an old A request is still pending.
  const generation = useRef(0);
  const token = useMemo(() => ({ scope }), [scope]);
  const activeToken = useRef<object | null>(null);

  const fetchStatus = useCallback(async (): Promise<InteractionPayload> => {
    const params = new URLSearchParams();
    if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
    else if (dependentId) params.set('dependent_id', dependentId);
    const res = await fetch(`/api/interaction-alerts${params.size ? `?${params}` : ''}`);
    if (!res.ok) throw new Error('Failed to fetch interaction status');
    return (await res.json()) as InteractionPayload;
  }, [dependentId, delegateOwnerId]);

  useEffect(() => {
    const current = ++generation.current;
    activeToken.current = token;
    setView({ scope, data: EMPTY, loading: true, checking: false, error: null });
    if (delegateOwnerId) {
      setView({ scope, data: EMPTY, loading: false, checking: false, error: null });
    } else {
      fetchStatus()
        .then((data) => {
          if (generation.current === current) {
            setView((prev) => ({ ...prev, data, loading: false }));
          }
        })
        .catch(() => {
          if (generation.current === current) {
            setView((prev) => ({
              ...prev,
              loading: false,
              error: 'Failed to fetch interaction status',
            }));
          }
        });
    }
    return () => {
      generation.current = current + 1;
      activeToken.current = null;
    };
  }, [scope, token, delegateOwnerId, fetchStatus]);

  const snoozeAlert = useCallback(
    async (alertId: string, days: number) => {
      if (delegateOwnerId || activeToken.current !== token) return;
      const current = generation.current;
      setView((prev) => ({
        ...prev,
        data: {
          ...prev.data,
          alerts: prev.data.alerts.filter((alert) => alert.id !== alertId),
          snoozed_count: prev.data.snoozed_count + 1,
        },
      }));
      try {
        const res = await fetch(`/api/interaction-alerts/${encodeURIComponent(alertId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snooze_days: days }),
        });
        if (!res.ok) throw new Error('Failed to snooze alert');
      } catch {
        if (generation.current !== current) return;
        setView((prev) => ({ ...prev, error: 'Failed to snooze alert' }));
        try {
          const data = await fetchStatus();
          if (generation.current === current) setView((prev) => ({ ...prev, data }));
        } catch {
          /* Preserve the error if the authoritative refresh also fails. */
        }
      }
    },
    [delegateOwnerId, token, fetchStatus]
  );

  const checkInteractions = useCallback(
    async (triggerMedId?: string): Promise<{ hasInteractions: boolean } | null> => {
      if (delegateOwnerId || activeToken.current !== token) return null;
      const current = generation.current;
      setView((prev) => ({ ...prev, error: null, checking: true }));
      try {
        const res = await fetch('/api/check-interactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dependent_id: dependentId,
            ...(triggerMedId ? { trigger_id: triggerMedId } : {}),
          }),
        });
        if (generation.current !== current) return null;
        if (!res.ok) {
          if (res.status !== 501)
            setView((prev) => ({
              ...prev,
              error: 'Failed to check interactions. Please try again.',
            }));
          return null;
        }
        const result = (await res.json()) as {
          dependent_id?: string | null;
          has_interactions?: boolean;
        };
        if (result.dependent_id !== dependentId || typeof result.has_interactions !== 'boolean') {
          throw new Error('Mismatched interaction result');
        }
        const data = await fetchStatus();
        if (generation.current !== current) return null;
        setView((prev) => ({ ...prev, data }));
        return { hasInteractions: result.has_interactions };
      } catch {
        if (generation.current === current)
          setView((prev) => ({ ...prev, error: 'Failed to check interactions' }));
        return null;
      } finally {
        if (generation.current === current) setView((prev) => ({ ...prev, checking: false }));
      }
    },
    [dependentId, delegateOwnerId, token, fetchStatus]
  );

  // Hide old-profile data on the very first render of a profile change, before
  // effects run. Late loads, checks, snooze failures and unmounts are gated above.
  const visible =
    view.scope === scope && !delegateOwnerId
      ? view
      : { data: EMPTY, checking: false, loading: !delegateOwnerId, error: null };
  return {
    alerts: visible.data.alerts,
    status: visible.data.status,
    snoozedCount: visible.data.snoozed_count,
    loading: visible.loading,
    error: visible.error,
    checking: visible.checking,
    canCheck: !delegateOwnerId,
    snoozeAlert,
    checkInteractions,
  };
}
