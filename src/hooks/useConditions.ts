'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Condition } from '@/lib/types';

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/conditions?${qs}` : '/api/conditions';
}

export function useConditions() {
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchConditions() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Condition[]>(listUrl(dependentId, delegateOwnerId));
        if (cancelled) return;
        setConditions(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load conditions');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchConditions();
    return () => { cancelled = true; };
  }, [dependentId, delegateOwnerId]);

  const addCondition = useCallback(
    async (condition: Omit<Condition, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...condition };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Condition>('/api/conditions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setConditions((prev) => [data, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add condition');
      }
    },
    [dependentId, delegateOwnerId],
  );

  const updateCondition = useCallback(
    async (id: string, updates: Partial<Omit<Condition, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      setError(null);

      try {
        const data = await apiFetch<Condition>(
          `/api/conditions/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify(updates) },
        );
        setConditions((prev) => prev.map((c) => (c.id === id ? data : c)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update condition');
      }
    },
    [],
  );

  return { conditions, loading, error, addCondition, updateCondition };
}
