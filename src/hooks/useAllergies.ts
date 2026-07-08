'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Allergy } from '@/lib/types';

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/allergies?${qs}` : '/api/allergies';
}

export function useAllergies() {
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchAllergies() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Allergy[]>(listUrl(dependentId, delegateOwnerId));
        if (cancelled) return;
        setAllergies(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load allergies');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAllergies();
    return () => { cancelled = true; };
  }, [dependentId, delegateOwnerId]);

  const addAllergy = useCallback(
    async (allergy: Omit<Allergy, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...allergy };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Allergy>('/api/allergies', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setAllergies((prev) => [data, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add allergy');
      }
    },
    [dependentId, delegateOwnerId],
  );

  const updateAllergy = useCallback(
    async (id: string, updates: Partial<Omit<Allergy, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      setError(null);

      try {
        const data = await apiFetch<Allergy>(
          `/api/allergies/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify(updates) },
        );
        setAllergies((prev) => prev.map((a) => (a.id === id ? data : a)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update allergy');
      }
    },
    [],
  );

  const deleteAllergy = useCallback(async (id: string) => {
    setError(null);

    try {
      await apiFetch<void>(`/api/allergies/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setAllergies((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete allergy');
    }
  }, []);

  return { allergies, loading, error, addAllergy, updateAllergy, deleteAllergy };
}
