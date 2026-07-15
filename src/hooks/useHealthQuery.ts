'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryHistoryEntry } from '@/lib/types';

export function useHealthQuery() {
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Neutral notice shown when a query was served from saved history instead of
  // spending a fresh AI call (see submitQuery's dedupe below).
  const [notice, setNotice] = useState<string | null>(null);
  const lastQueryRef = useRef<string>('');

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

  /** Actually call the AI and persist the result. */
  const runQuery = useCallback(
    async (queryText: string): Promise<QueryHistoryEntry | null> => {
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

  /**
   * Submit a query. If the exact same question already exists in history, reuse
   * that saved answer (re-surfaced to the top) instead of spending another AI
   * call — a returning visitor clicking the same quick-question chip shouldn't
   * be billed again. `force` bypasses the dedupe for an intentionally fresh run.
   */
  const submitQuery = useCallback(
    async (queryText: string, opts?: { force?: boolean }): Promise<QueryHistoryEntry | null> => {
      setError(null);
      setNotice(null);
      const trimmed = queryText.trim();
      if (!trimmed) return null;
      lastQueryRef.current = trimmed;

      if (!opts?.force) {
        const key = trimmed.toLowerCase();
        const match = queryHistory.find(
          (e) => e.query_text.trim().toLowerCase() === key,
        );
        if (match) {
          // Re-surface the saved answer to the top; no AI call, no new row.
          setQueryHistory((prev) => [match, ...prev.filter((e) => e !== match)]);
          setNotice('Showing your saved answer — no new query used.');
          return match;
        }
      }

      return runQuery(trimmed);
    },
    [queryHistory, runQuery],
  );

  /** Force a fresh AI run of the most recent question (bypasses dedupe). */
  const refreshLast = useCallback((): Promise<QueryHistoryEntry | null> => {
    setNotice(null);
    if (!lastQueryRef.current) return Promise.resolve(null);
    return runQuery(lastQueryRef.current);
  }, [runQuery]);

  return { queryHistory, loading, error, notice, submitQuery, refreshLast };
}
