'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Medication } from '@/lib/types';

interface UseMedicationsOptions {
  activeOnly?: boolean;
}

function listUrl(
  dependentId: string | null,
  delegateOwnerId: string | null,
  activeOnly: boolean | undefined,
): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  if (activeOnly !== undefined) params.set('active', String(activeOnly));
  const qs = params.toString();
  return qs ? `/api/medications?${qs}` : '/api/medications';
}

export function useMedications(options: UseMedicationsOptions = {}) {
  const { activeOnly } = options;
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchMedications() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Medication[]>(
          listUrl(dependentId, delegateOwnerId, activeOnly),
        );
        if (cancelled) return;
        setMedications(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load medications');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMedications();
    return () => { cancelled = true; };
  }, [activeOnly, dependentId, delegateOwnerId]);

  const addMedication = useCallback(
    async (med: Omit<Medication, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...med };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Medication>('/api/medications', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMedications((prev) => [data, ...prev]);
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add medication');
        return undefined;
      }
    },
    [dependentId, delegateOwnerId],
  );

  const updateMedication = useCallback(
    async (id: string, updates: Partial<Omit<Medication, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      setError(null);

      try {
        const data = await apiFetch<Medication>(
          `/api/medications/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify(updates) },
        );
        setMedications((prev) => prev.map((m) => (m.id === id ? data : m)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update medication');
      }
    },
    [],
  );

  return { medications, loading, error, addMedication, updateMedication };
}
