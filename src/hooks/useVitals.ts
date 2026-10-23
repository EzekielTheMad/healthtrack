'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Vital } from '@/lib/types';
import {
  selectVitalSources,
  sourceConflicts,
  type VitalSourcePreferences,
} from '@/lib/metrics/source-selection';

interface UseVitalsOptions {
  startDate?: string;
  endDate?: string;
}

function listUrl(
  dependentId: string | null,
  delegateOwnerId: string | null,
  startDate: string | undefined,
  endDate: string | undefined
): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const qs = params.toString();
  return qs ? `/api/vitals?${qs}` : '/api/vitals';
}

export function useVitals(options: UseVitalsOptions = {}) {
  const { startDate, endDate } = options;
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [preferences, setPreferences] = useState<VitalSourcePreferences>({});
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const scopeKey = JSON.stringify([
    dependentId,
    delegateOwnerId,
    startDate,
    endDate,
    preferenceRevision,
  ]);

  useEffect(() => {
    const refresh = () => setPreferenceRevision((revision) => revision + 1);
    window.addEventListener('vital-source-preferences-changed', refresh);
    return () => window.removeEventListener('vital-source-preferences-changed', refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchVitals() {
      setLoading(true);
      setError(null);
      setVitals([]);
      setPreferences({});

      try {
        const [data, sourcePreferences] = await Promise.all([
          apiFetch<Vital[]>(listUrl(dependentId, delegateOwnerId, startDate, endDate)),
          delegateOwnerId || dependentId
            ? Promise.resolve({})
            : apiFetch<VitalSourcePreferences>('/api/vital-source-preferences'),
        ]);
        if (cancelled) return;
        setVitals(data);
        setPreferences(sourcePreferences);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load vitals');
      } finally {
        if (!cancelled) {
          setLoadedScope(scopeKey);
          setLoading(false);
        }
      }
    }

    fetchVitals();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, dependentId, delegateOwnerId, preferenceRevision, scopeKey]);

  const chooseSource = useCallback(
    async (metricKey: string, source: string | null) => {
      if (delegateOwnerId || dependentId) return;
      setPreferenceError(null);
      try {
        await apiFetch('/api/vital-source-preferences', {
          method: source ? 'PATCH' : 'DELETE',
          body: JSON.stringify({
            metric_key: metricKey,
            ...(source ? { preferred_source: source } : {}),
          }),
        });
        window.dispatchEvent(new Event('vital-source-preferences-changed'));
      } catch (err) {
        setPreferenceError(err instanceof Error ? err.message : 'Could not save source choice');
      }
    },
    [delegateOwnerId, dependentId]
  );

  const addVital = useCallback(
    async (vital: Omit<Vital, 'id' | 'user_id' | 'created_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...vital };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Vital>('/api/vitals', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setVitals((prev) => [data, ...prev.filter((row) => row.id !== data.id)]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add vital');
      }
    },
    [dependentId, delegateOwnerId]
  );

  const inScope = loadedScope === scopeKey;
  const selected = useMemo(
    () => (inScope ? selectVitalSources(vitals, preferences) : []),
    [vitals, preferences, inScope]
  );
  const conflicts = useMemo(
    () => (inScope ? sourceConflicts(vitals, preferences) : []),
    [vitals, preferences, inScope]
  );
  return {
    vitals: selected,
    rawVitals: inScope ? vitals : [],
    loading: loading || !inScope,
    error: inScope ? error : null,
    addVital,
    sourcePreferences: inScope ? preferences : {},
    sourceConflicts: conflicts,
    chooseSource,
    sourcePreferenceError: preferenceError,
    canChooseSource: !delegateOwnerId && !dependentId,
  };
}
