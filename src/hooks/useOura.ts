'use client';

import { useCallback, useEffect, useState } from 'react';

interface SyncSummary {
  synced: number;
  errors: string[];
}

export function useOura() {
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check connection status on mount
  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/oura/status');
        if (cancelled) return;

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? 'Failed to check Oura status');
        } else {
          const data = (await res.json()) as {
            status: string | null;
            last_sync_at: string | null;
          };
          if (data.status === 'active') {
            setConnected(true);
            setLastSync(data.last_sync_at);
          } else {
            setConnected(false);
            setLastSync(null);
          }
        }
      } catch {
        if (!cancelled) setError('Failed to check Oura status');
      }
      if (!cancelled) setLoading(false);
    }

    checkStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Redirect to the server-side start route which sets a CSRF state cookie
   * and 302s to Oura's OAuth authorization page.
   */
  const connect = useCallback(() => {
    window.location.href = '/api/oura/start';
  }, []);

  /**
   * Disconnect the Oura Ring integration.
   */
  const disconnect = useCallback(async () => {
    setError(null);

    const res = await fetch('/api/oura/disconnect', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.message ?? 'Failed to disconnect');
    } else {
      setConnected(false);
      setLastSync(null);
    }
  }, []);

  /**
   * Trigger a manual sync via the API route.
   */
  const sync = useCallback(async (): Promise<SyncSummary | null> => {
    setError(null);
    setSyncing(true);

    try {
      const res = await fetch('/api/sync-oura', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message ?? 'Sync failed');
        return null;
      }

      const summary = data as SyncSummary;

      if (summary.errors.length > 0) {
        setError(summary.errors.join('; '));
      }

      // Refresh last sync time
      setLastSync(new Date().toISOString());
      return summary;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      return null;
    } finally {
      setSyncing(false);
    }
  }, []);

  return { connected, lastSync, syncing, loading, error, connect, disconnect, sync };
}
