'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { LabVisit, LabResult } from '@/lib/types';
import type { ParsedLabResult } from '@/lib/claude/parse-lab';
import { isValidDayKey } from '@/lib/dates';

export interface LabVisitWithResults extends LabVisit {
  lab_results: LabResult[];
}

export interface LabVisitUpdates {
  visit_date?: string;
  notes?: string | null;
  reason?: string;
  results?: Array<
    Partial<
      Pick<
        LabResult,
        | 'panel_name'
        | 'test_name'
        | 'value'
        | 'unit'
        | 'reference_range_low'
        | 'reference_range_high'
        | 'reference_range_text'
        | 'flag'
      >
    > & { id: string }
  >;
}

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/labs?${qs}` : '/api/labs';
}

export function useLabResults() {
  const [labVisits, setLabVisits] = useState<LabVisitWithResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  const fetchLabResults = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiFetch<LabVisitWithResults[]>(listUrl(dependentId, delegateOwnerId));
      setLabVisits(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lab results');
    } finally {
      setLoading(false);
    }
  }, [dependentId, delegateOwnerId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<LabVisitWithResults[]>(listUrl(dependentId, delegateOwnerId));
        if (cancelled) return;
        setLabVisits(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load lab results');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [dependentId, delegateOwnerId]);

  const saveLabVisit = useCallback(
    async (parsedData: ParsedLabResult, storagePath: string) => {
      if (!parsedData.visit_date || !isValidDayKey(parsedData.visit_date)) {
        throw new Error('Enter the collection / visit date from the report before saving.');
      }
      const payload: Record<string, unknown> = {
        visit_date: parsedData.visit_date,
        source_pdf_path: storagePath,
        notes: parsedData.provider_name
          ? `Imported from ${parsedData.provider_name}`
          : 'Imported from lab PDF',
        results: parsedData.results.map((r) => ({
          panel_name: r.panel_name,
          test_name: r.test_name,
          value: r.value,
          unit: r.unit || null,
          reference_range_low: r.reference_range_low,
          reference_range_high: r.reference_range_high,
          reference_range_text: r.reference_range_text,
          flag: r.flag,
        })),
      };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      await apiFetch<LabVisitWithResults>('/api/labs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Refetch to update state
      await fetchLabResults();
    },
    [fetchLabResults, dependentId, delegateOwnerId]
  );

  const updateLabVisit = useCallback(async (id: string, updates: LabVisitUpdates) => {
    const updated = await apiFetch<LabVisitWithResults>(`/api/labs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    setLabVisits((previous) => previous.map((visit) => (visit.id === id ? updated : visit)));
  }, []);

  return { labVisits, loading, error, saveLabVisit, updateLabVisit, refetch: fetchLabResults };
}
