'use client';

/**
 * One Monday-keyed week's computed rollup for the Fitness Weekly tab, via
 * GET /api/weeks/{weekStart}, plus the check-in upsert (PUT
 * /api/checkins/{weekStart} — full-replacement semantics). Saving a check-in
 * refetches the rollup so the embedded check-in row, neck/waist latest and
 * nutrition figures stay coherent. Mutation failures THROW (ApiRequestError)
 * for inline form errors; delegate mode reads via ?owner_id=.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { CheckinWire, WeekRollupWire } from '@/lib/fitness/api-types';

export function useWeekRollup(weekStart: string) {
  const { delegateOwnerId } = useActiveProfile();
  const [rollup, setRollup] = useState<WeekRollupWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchRollup() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
        const qs = params.toString();
        const data = await apiFetch<WeekRollupWire>(
          qs ? `/api/weeks/${weekStart}?${qs}` : `/api/weeks/${weekStart}`,
        );
        if (!cancelled) setRollup(data);
      } catch (err) {
        if (!cancelled) {
          setRollup(null);
          setError(err instanceof Error ? err.message : 'Failed to load week');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRollup();
    return () => {
      cancelled = true;
    };
  }, [weekStart, delegateOwnerId, version]);

  /** PUT /api/checkins/{weekStart} — wire-shaped (snake_case) body, FULL
      replacement. Throws on failure; refetches the rollup on success. */
  const saveCheckin = useCallback(
    async (body: Record<string, unknown>) => {
      const row = await apiFetch<CheckinWire>(`/api/checkins/${weekStart}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setVersion((v) => v + 1);
      return row;
    },
    [weekStart],
  );

  return { rollup, loading, error, saveCheckin };
}
