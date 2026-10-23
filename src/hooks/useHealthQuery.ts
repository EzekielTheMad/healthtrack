'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryHistoryEntry } from '@/lib/types';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';

export function useHealthQuery() {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const lastQueryRef = useRef('');
  const subjectRef = useRef(dependentId);
  useEffect(() => {
    subjectRef.current = dependentId;
  }, [dependentId]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/query-history', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to fetch query history');
        const rows = (await response.json()) as QueryHistoryEntry[];
        if (!controller.signal.aborted) setQueryHistory(rows);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const submitQuery = useCallback(
    async (query: string, opts?: { force?: boolean }): Promise<QueryHistoryEntry | null> => {
      setError(null);
      setNotice(null);
      if (delegateOwnerId) {
        setError('Health queries are available for your own record and dependents.');
        return null;
      }
      const trimmed = query.trim();
      if (!trimmed) return null;
      lastQueryRef.current = trimmed;
      const subject = dependentId;
      try {
        const response = await fetch('/api/health-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmed,
            dependent_id: subject,
            days,
            force: opts?.force ?? false,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? 'Query failed');
        if (subjectRef.current !== subject) return null;
        setQueryHistory((prev) => [result, ...prev.filter((e) => e.id !== result.id)]);
        if (result.reused)
          setNotice(
            'Showing a saved answer verified against the current records and reporting window.'
          );
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Query failed');
        return null;
      }
    },
    [dependentId, delegateOwnerId, days]
  );
  const refreshLast = useCallback(
    () => submitQuery(lastQueryRef.current, { force: true }),
    [submitQuery]
  );
  const visibleHistory = delegateOwnerId
    ? []
    : queryHistory.filter((entry) => (entry.dependent_id ?? null) === dependentId);
  return {
    queryHistory: visibleHistory,
    loading,
    error,
    notice,
    submitQuery,
    refreshLast,
    days,
    setDays,
  };
}
