'use client';

import { useCallback, useEffect, useState } from 'react';
import { ouraErrorMessage } from '@/lib/oura/errors';

interface SyncSummary {
  synced: number;
  errors: string[];
  outcome?: string;
}
interface OuraStatus {
  status: string | null;
  last_sync_at: string | null;
  last_success_at?: string | null;
  last_attempt_at?: string | null;
  last_outcome?: string | null;
  last_error_code?: string | null;
  next_retry_at?: string | null;
  retry_blocked?: boolean;
}

export function useOura() {
  const [state, setState] = useState<OuraStatus>({ status: null, last_sync_at: null });
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/oura/status');
      if (!res.ok) throw new Error('Failed to check Oura status');
      setState(await res.json());
    } catch {
      setError('Failed to check Oura status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const onFocus = () => {
      if (active) void refresh();
    };
    queueMicrotask(onFocus);
    const timer = window.setInterval(onFocus, 60_000);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const connect = useCallback(() => {
    window.location.assign(new URL('/api/oura/start', window.location.origin).href);
  }, []);
  const disconnect = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/oura/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to disconnect');
      await refresh();
    } catch {
      setError('Failed to disconnect');
    }
  }, [refresh]);

  const sync = useCallback(async (): Promise<SyncSummary | null> => {
    setError(null);
    setSyncing(true);
    try {
      const res = await fetch('/api/sync-oura', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Sync failed');
      const summary = data as SyncSummary;
      if (summary.errors.length) setError(summary.errors.join('; '));
      return summary;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      return null;
    } finally {
      await refresh();
      window.dispatchEvent(new Event('integration-health-changed'));
      setSyncing(false);
    }
  }, [refresh]);

  return {
    connected: state.status === 'active',
    status: state.status,
    lastSync: state.last_success_at ?? null,
    lastAttempt: state.last_attempt_at ?? null,
    lastOutcome: state.last_outcome ?? null,
    nextRetryAt: state.next_retry_at ?? null,
    retryBlocked: state.retry_blocked ?? false,
    syncing,
    loading,
    error:
      error ??
      (state.status === 'expired'
        ? ouraErrorMessage('auth_required')
        : state.last_error_code
          ? ouraErrorMessage(state.last_error_code)
          : null),
    connect,
    disconnect,
    sync,
  };
}
