'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface CreateKeyData {
  name: string;
  scopes: string[];
  expires_at?: string;
}

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/api-keys');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch API keys');
      }
      const data: ApiKey[] = await res.json();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const createKey = useCallback(
    async (data: CreateKeyData): Promise<string | null> => {
      setError(null);
      try {
        const res = await fetch('/api/api-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create API key');
        }

        const result: { key: ApiKey; token: string } = await res.json();
        setKeys((prev) => [result.key, ...prev]);
        return result.token;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create API key';
        setError(msg);
        return null;
      }
    },
    [],
  );

  const revokeKey = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(`/api/api-keys?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to revoke API key');
        }

        setKeys((prev) =>
          prev.map((k) =>
            k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k,
          ),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke API key');
        return false;
      }
    },
    [],
  );

  return {
    keys,
    loading,
    error,
    createKey,
    revokeKey,
    refresh: fetchKeys,
  };
}
