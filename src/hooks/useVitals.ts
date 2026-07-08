'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Vital } from '@/lib/types';

interface UseVitalsOptions {
  startDate?: string;
  endDate?: string;
}

function listUrl(
  dependentId: string | null,
  delegateOwnerId: string | null,
  startDate: string | undefined,
  endDate: string | undefined,
): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const qs = params.toString();
  return qs ? `/api/vitals?${qs}` : '/api/vitals';
}

export function useVitals(options: UseVitalsOptions = {}) {
  const { startDate, endDate } = options;
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchVitals() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Vital[]>(
          listUrl(dependentId, delegateOwnerId, startDate, endDate),
        );
        if (cancelled) return;
        setVitals(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load vitals');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchVitals();
    return () => { cancelled = true; };
  }, [startDate, endDate, dependentId, delegateOwnerId]);

  const addVital = useCallback(
    async (vital: Omit<Vital, 'id' | 'user_id' | 'created_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...vital };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Vital>('/api/vitals', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setVitals((prev) => [data, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add vital');
      }
    },
    [dependentId, delegateOwnerId],
  );

  return { vitals, loading, error, addVital };
}
