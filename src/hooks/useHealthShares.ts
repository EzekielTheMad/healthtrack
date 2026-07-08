'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HealthShare } from '@/lib/types';

interface CreateShareData {
  shared_with_email: string;
  access_level: 'read' | 'read_write';
  shared_sections: string[];
  expires_at?: string;
}

interface UpdateShareData {
  access_level?: 'read' | 'read_write';
  shared_sections?: string[];
}

export function useHealthShares() {
  const [sentShares, setSentShares] = useState<HealthShare[]>([]);
  const [receivedShares, setReceivedShares] = useState<HealthShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [sentRes, receivedRes] = await Promise.all([
        fetch('/api/share?type=sent'),
        fetch('/api/share?type=received'),
      ]);

      if (!sentRes.ok) {
        const err = await sentRes.json();
        throw new Error(err.message || 'Failed to fetch sent shares');
      }
      if (!receivedRes.ok) {
        const err = await receivedRes.json();
        throw new Error(err.message || 'Failed to fetch received shares');
      }

      const sentData: HealthShare[] = await sentRes.json();
      const receivedData: HealthShare[] = await receivedRes.json();

      setSentShares(sentData);
      setReceivedShares(receivedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch shares');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const createShare = useCallback(
    async (data: CreateShareData): Promise<HealthShare | null> => {
      setError(null);
      try {
        const res = await fetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to create share');
        }

        const created: HealthShare = await res.json();
        setSentShares((prev) => [created, ...prev]);
        return created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create share';
        setError(msg);
        return null;
      }
    },
    [],
  );

  const acceptShare = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/share', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'accept' }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to accept share');
        }

        const updated: HealthShare = await res.json();
        setReceivedShares((prev) =>
          prev.map((s) => (s.id === id ? updated : s)),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept share');
        return false;
      }
    },
    [],
  );

  const revokeShare = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/share', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'revoke' }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to revoke share');
        }

        setSentShares((prev) => prev.filter((s) => s.id !== id));
        setReceivedShares((prev) => prev.filter((s) => s.id !== id));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke share');
        return false;
      }
    },
    [],
  );

  const updateShare = useCallback(
    async (id: string, updates: UpdateShareData): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/share', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'update', ...updates }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to update share');
        }

        const updated: HealthShare = await res.json();
        setSentShares((prev) =>
          prev.map((s) => (s.id === id ? updated : s)),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update share');
        return false;
      }
    },
    [],
  );

  return {
    sentShares,
    receivedShares,
    loading,
    error,
    createShare,
    acceptShare,
    revokeShare,
    updateShare,
    refresh: fetchShares,
  };
}
