'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Vaccine } from '@/lib/types';

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/vaccines?${qs}` : '/api/vaccines';
}

export function useVaccines() {
  const [vaccines, setVaccines] = useState<Vaccine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchVaccines() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Vaccine[]>(listUrl(dependentId, delegateOwnerId));
        if (cancelled) return;
        setVaccines(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load vaccines');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchVaccines();
    return () => {
      cancelled = true;
    };
  }, [dependentId, delegateOwnerId]);

  const addVaccine = useCallback(
    async (vaccine: Omit<Vaccine, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...vaccine };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Vaccine>('/api/vaccines', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setVaccines((prev) =>
          [data, ...prev].sort(
            (a, b) => (b.vaccine_date ?? '').localeCompare(a.vaccine_date ?? ''),
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add vaccine');
      }
    },
    [dependentId, delegateOwnerId],
  );

  const updateVaccine = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Vaccine, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
    ) => {
      setError(null);

      try {
        const data = await apiFetch<Vaccine>(
          `/api/vaccines/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify(updates) },
        );
        setVaccines((prev) =>
          prev
            .map((v) => (v.id === id ? data : v))
            .sort((a, b) => (b.vaccine_date ?? '').localeCompare(a.vaccine_date ?? '')),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update vaccine');
      }
    },
    [],
  );

  const deleteVaccine = useCallback(async (id: string) => {
    setError(null);

    try {
      await apiFetch<void>(`/api/vaccines/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setVaccines((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete vaccine');
    }
  }, []);

  return { vaccines, loading, error, addVaccine, updateVaccine, deleteVaccine };
}
