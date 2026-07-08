'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Procedure } from '@/lib/types';

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/procedures?${qs}` : '/api/procedures';
}

export function useProcedures() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchProcedures() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Procedure[]>(listUrl(dependentId, delegateOwnerId));
        if (cancelled) return;
        setProcedures(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load procedures');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProcedures();
    return () => { cancelled = true; };
  }, [dependentId, delegateOwnerId]);

  const addProcedure = useCallback(
    async (procedure: Omit<Procedure, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...procedure };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Procedure>('/api/procedures', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setProcedures((prev) =>
          [data, ...prev].sort(
            (a, b) => (b.procedure_date ?? '').localeCompare(a.procedure_date ?? ''),
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add procedure');
      }
    },
    [dependentId, delegateOwnerId],
  );

  const updateProcedure = useCallback(
    async (id: string, updates: Partial<Omit<Procedure, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      setError(null);

      try {
        const data = await apiFetch<Procedure>(
          `/api/procedures/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify(updates) },
        );
        setProcedures((prev) => prev.map((p) => (p.id === id ? data : p)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update procedure');
      }
    },
    [],
  );

  const deleteProcedure = useCallback(async (id: string) => {
    setError(null);

    try {
      await apiFetch<void>(`/api/procedures/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setProcedures((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete procedure');
    }
  }, []);

  return { procedures, loading, error, addProcedure, updateProcedure, deleteProcedure };
}
