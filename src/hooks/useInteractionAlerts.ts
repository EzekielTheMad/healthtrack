'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { InteractionAlert, InteractionStatus } from '@/lib/types';

interface InteractionPayload {
  alerts: InteractionAlert[];
  status: InteractionStatus | null;
  snoozed_count: number;
}

export function useInteractionAlerts() {
  const [alerts, setAlerts] = useState<InteractionAlert[]>([]);
  const [status, setStatus] = useState<InteractionStatus | null>(null);
  const [snoozedCount, setSnoozedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `loading` (initial fetch): true while an interaction check
  // is running, so a manual "Check interactions" button can show progress.
  const [checking, setChecking] = useState(false);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  // Scope params mirror the old PostgREST query: delegate mode targets the
  // owner with no dependent filter (the API returns empty there — the data is
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

  const fetchStatus = useCallback(async (): Promise<InteractionPayload | null> => {
    const res = await fetch(buildUrl());
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? 'Failed to fetch interaction status');
    }
    return (await res.json()) as InteractionPayload;
  }, [buildUrl]);

  const applyPayload = useCallback((data: InteractionPayload) => {
    setAlerts(data.alerts ?? []);
    setStatus(data.status ?? null);
    setSnoozedCount(data.snoozed_count ?? 0);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchStatus();
        if (!cancelled && data) applyPayload(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch interaction status');
        }
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fetchStatus, applyPayload]);

  /** Snooze an alert for `days`; the server clamps to the severity cap. */
  const snoozeAlert = useCallback(
    async (alertId: string, days: number) => {
      // Optimistic: drop it from the active list and bump the snoozed count.
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      setSnoozedCount((n) => n + 1);

      const res = await fetch(
        `/api/interaction-alerts/${encodeURIComponent(alertId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snooze_days: days }),
        },
      );

      if (!res.ok) {
        // Revert by re-fetching authoritative state.
        const body = await res.json().catch(() => null);
        setError(body?.message ?? 'Failed to snooze alert');
        try {
          const data = await fetchStatus();
          if (data) applyPayload(data);
        } catch {
          // keep optimistic state if refresh also fails
        }
      }
    },
    [fetchStatus, applyPayload],
  );

  /**
   * Run the interaction check. Returns `{ hasInteractions }` on success (so a
   * manual caller can show an "all clear" confirmation) or `null` on failure.
   * Auto-triggers on med add/toggle ignore the return value.
   */
  const checkInteractions = useCallback(
    async (triggerMedId?: string): Promise<{ hasInteractions: boolean } | null> => {
      setError(null);
      setChecking(true);

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
          // Background auto-checks stay silent (501 = AI off, or a transient
          // AI error). A manual caller gets `null` and decides what to show.
          return null;
        }

        const result = (await res.json()) as { has_interactions?: boolean };

        // Refresh the whole status (alerts + last-check + snoozed count).
        const data = await fetchStatus();
        if (data) applyPayload(data);
        return { hasInteractions: Boolean(result.has_interactions) };
      } catch {
        setError('Failed to check interactions');
        return null;
      } finally {
        setChecking(false);
      }
    },
    [dependentId, delegateOwnerId, fetchStatus, applyPayload],
  );

  return {
    alerts,
    status,
    snoozedCount,
    loading,
    error,
    checking,
    snoozeAlert,
    checkInteractions,
  };
}
