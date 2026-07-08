'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { InteractionAlert } from '@/lib/types';

export function useInteractionAlerts() {
  const [alerts, setAlerts] = useState<InteractionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  // Scope params mirror the old PostgREST query: delegate mode targets the
  // owner with no dependent filter (the API returns [] there — the table is
  // owner-only); otherwise exact dependent (or self) filter.
  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (delegateOwnerId) {
      params.set('owner_id', delegateOwnerId);
    } else if (dependentId) {
      params.set('dependent_id', dependentId);
    }
    const qs = params.toString();
    return qs ? `/api/interaction-alerts?${qs}` : '/api/interaction-alerts';
  }, [dependentId, delegateOwnerId]);

  const fetchAlerts = useCallback(async (): Promise<InteractionAlert[] | null> => {
    const res = await fetch(buildUrl());
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? 'Failed to fetch alerts');
    }
    return (await res.json()) as InteractionAlert[];
  }, [buildUrl]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAlerts();
        if (!cancelled && data) setAlerts(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch alerts');
        }
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fetchAlerts]);

  const dismissAlert = useCallback(
    async (alertId: string) => {
      // Optimistic update
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));

      const res = await fetch(
        `/api/interaction-alerts/${encodeURIComponent(alertId)}`,
        { method: 'PATCH' },
      );

      if (!res.ok) {
        // Revert on error: re-fetch
        const body = await res.json().catch(() => null);
        setError(body?.message ?? 'Failed to dismiss alert');
        try {
          const data = await fetchAlerts();
          if (data) setAlerts(data);
        } catch {
          // keep the optimistic state if the refresh also fails
        }
      }
    },
    [fetchAlerts],
  );

  const checkInteractions = useCallback(
    async (triggerMedId?: string) => {
      setError(null);

      try {
        const body: Record<string, unknown> = {};
        if (triggerMedId) {
          body.trigger_id = triggerMedId;
          body.medication_ids = [triggerMedId];
        }
        if (!delegateOwnerId && dependentId) {
          body.dependent_id = dependentId;
        }
        if (delegateOwnerId) {
          body.delegate_owner_id = delegateOwnerId;
        }

        const res = await fetch('/api/check-interactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          // 501 = AI not configured on this instance — interaction checks are
          // an optional feature; skip silently rather than surface an error.
          if (res.status === 501) return;
          const errData = await res.json().catch(() => null);
          setError(errData?.message ?? 'Failed to check interactions');
          return;
        }

        // Refresh alerts from the API after the check
        const data = await fetchAlerts();
        if (data) setAlerts(data);
      } catch {
        setError('Failed to check interactions');
      }
    },
    [dependentId, delegateOwnerId, fetchAlerts],
  );

  return { alerts, loading, error, dismissAlert, checkInteractions };
}
