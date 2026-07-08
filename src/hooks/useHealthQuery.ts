'use client';

import { useCallback, useEffect, useState } from 'react';
import type { QueryHistoryEntry } from '@/lib/types';

export function useHealthQuery() {
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchHistory() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/query-history');
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.message ?? 'Failed to fetch query history');
        } else {
          setQueryHistory((await res.json()) as QueryHistoryEntry[]);
        }
      } catch {
        if (!cancelled) setError('Failed to fetch query history');
      }
      if (!cancelled) setLoading(false);
    }

    fetchHistory();
    return () => { cancelled = true; };
  }, []);

  const submitQuery = useCallback(
    async (queryText: string) => {
      setError(null);

      try {
        const response = await fetch('/api/health-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: queryText }),
        });

        if (!response.ok) {
          const body = await response.json();
          setError(body.message ?? 'Query failed');
          return null;
        }

        const result: QueryHistoryEntry = await response.json();
        setQueryHistory((prev) => [result, ...prev]);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Query failed';
        setError(message);
        return null;
      }
    },
    [],
  );

  return { queryHistory, loading, error, submitQuery };
}
