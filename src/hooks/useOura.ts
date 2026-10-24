'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIntegrationHealth } from './useIntegrationHealth';
import { apiFetch } from '@/lib/api/client';

interface SyncSummary {
  synced: number;
  errors: string[];
  outcome?: 'success' | 'partial' | 'failed';
}

/** Actions share the same operational snapshot as Settings and the app warning. */
export function useOura() {
  const router = useRouter();
  const snapshot = useIntegrationHealth();
  const state = snapshot.integrations.find((item) => item.source === 'oura');
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  const inFlight = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function sync() {
    if (inFlight.current || snapshot.error || !state?.canSyncNow) return;
    inFlight.current = true;
    setBusy('sync');
    setActionError(null);
    setResult(null);
    try {
      const summary = await apiFetch<SyncSummary>('/api/sync-oura', { method: 'POST' });
      setResult(
        summary.outcome === 'failed'
          ? 'Sync failed. Review the current status below.'
          : summary.outcome === 'partial' || summary.errors.length
            ? 'Some Oura collections could not be retrieved. Review the available measurement dates.'
            : summary.synced === 0
              ? 'Oura responded successfully; no measurements were returned.'
              : 'Oura sync completed. Measurement dates show the data available.'
      );
    } catch {
      setActionError(
        'Could not complete Oura sync. Check the refreshed status and retry when available.'
      );
    } finally {
      await snapshot.refresh(true);
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function disconnect() {
    if (inFlight.current || snapshot.error) return false;
    inFlight.current = true;
    setBusy('disconnect');
    setActionError(null);
    try {
      await apiFetch('/api/oura/disconnect', { method: 'POST' });
      setResult('Oura disconnected. Your imported health records have been retained.');
      return true;
    } catch {
      setActionError('Could not disconnect Oura. Please try again.');
      return false;
    } finally {
      await snapshot.refresh(true);
      inFlight.current = false;
      setBusy(null);
    }
  }

  return {
    state,
    busy,
    error: actionError,
    result,
    sync,
    disconnect,
    connected: state?.connectionStatus === 'active',
    loading: snapshot.loading,
    connect: () => router.push('/settings?tab=integrations#oura'),
  };
}
