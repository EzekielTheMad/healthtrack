'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Delegate, DelegatePermissionLevel } from '@/lib/types';

export function useDelegates() {
  const [sentDelegates, setSentDelegates] = useState<Delegate[]>([]);
  const [receivedDelegates, setReceivedDelegates] = useState<Delegate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDelegates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [sentRes, receivedRes] = await Promise.all([
        fetch('/api/delegates?type=sent'),
        fetch('/api/delegates?type=received'),
      ]);

      if (!sentRes.ok) {
        const err = await sentRes.json();
        throw new Error(err.message || 'Failed to fetch sent delegates');
      }
      if (!receivedRes.ok) {
        const err = await receivedRes.json();
        throw new Error(err.message || 'Failed to fetch received delegates');
      }

      const sentData: Delegate[] = await sentRes.json();
      const receivedData: Delegate[] = await receivedRes.json();

      setSentDelegates(sentData);
      setReceivedDelegates(receivedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch delegates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDelegates();
  }, [fetchDelegates]);

  const inviteDelegate = useCallback(
    async (data: {
      delegate_email: string;
      permission_level: DelegatePermissionLevel;
      expires_at?: string;
    }): Promise<Delegate | null> => {
      setError(null);
      try {
        const res = await fetch('/api/delegates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to send invitation');
        }

        const created: Delegate = await res.json();
        setSentDelegates((prev) => [created, ...prev]);
        return created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to send invitation';
        setError(msg);
        return null;
      }
    },
    [],
  );

  const acceptDelegate = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/delegates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'accept' }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to accept invitation');
        }

        const updated: Delegate = await res.json();
        setReceivedDelegates((prev) =>
          prev.map((d) => (d.id === id ? updated : d)),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept invitation');
        return false;
      }
    },
    [],
  );

  const rejectDelegate = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/delegates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'reject' }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to reject invitation');
        }

        const updated: Delegate = await res.json();
        setReceivedDelegates((prev) =>
          prev.map((d) => (d.id === id ? updated : d)),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reject invitation');
        return false;
      }
    },
    [],
  );

  const revokeDelegate = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(`/api/delegates?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to revoke delegate');
        }

        setSentDelegates((prev) => prev.filter((d) => d.id !== id));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke delegate');
        return false;
      }
    },
    [],
  );

  const updatePermission = useCallback(
    async (id: string, permission_level: DelegatePermissionLevel): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch('/api/delegates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'update_permission', permission_level }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || 'Failed to update permission');
        }

        const updated: Delegate = await res.json();
        setSentDelegates((prev) =>
          prev.map((d) => (d.id === id ? updated : d)),
        );
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update permission');
        return false;
      }
    },
    [],
  );

  return {
    sentDelegates,
    receivedDelegates,
    loading,
    error,
    inviteDelegate,
    acceptDelegate,
    rejectDelegate,
    revokeDelegate,
    updatePermission,
    refresh: fetchDelegates,
  };
}
