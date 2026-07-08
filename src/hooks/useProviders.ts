'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Provider } from '@/lib/types';

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/providers?${qs}` : '/api/providers';
}

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  // Each distinct fetch is identified by a key; `loading` is derived from
  // whether the latest fetch has settled, so no setState is needed at the
  // synchronous start of the effect.
  const [refreshCount, setRefreshCount] = useState(0);
  const fetchKey = `${refreshCount}|${delegateOwnerId ?? ''}|${dependentId ?? ''}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const loading = settledKey !== fetchKey;

  useEffect(() => {
    let cancelled = false;

    apiFetch<Provider[]>(listUrl(dependentId, delegateOwnerId))
      .then((data) => {
        if (cancelled) return;
        setProviders(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load providers');
      })
      .finally(() => {
        if (!cancelled) setSettledKey(fetchKey);
      });

    return () => {
      cancelled = true;
    };
  }, [dependentId, delegateOwnerId, fetchKey]);

  const refetch = useCallback(() => {
    setRefreshCount((count) => count + 1);
  }, []);

  const addProvider = async (
    provider: Omit<Provider, 'id' | 'user_id' | 'created_at' | 'updated_at'>
  ) => {
    const payload: Record<string, unknown> = { ...provider };
    if (delegateOwnerId) payload.owner_id = delegateOwnerId;
    else if (dependentId) payload.dependent_id = dependentId;

    const data = await apiFetch<Provider>('/api/providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setProviders((prev) => [data, ...prev]);
    return data;
  };

  const updateProvider = async (id: string, updates: Partial<Provider>) => {
    const data = await apiFetch<Provider>(`/api/providers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    setProviders((prev) => prev.map((p) => (p.id === id ? data : p)));
    return data;
  };

  const deleteProvider = async (id: string) => {
    await apiFetch<void>(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setProviders((prev) => prev.filter((p) => p.id !== id));
  };

  return { providers, loading, error, addProvider, updateProvider, deleteProvider, refetch };
}
