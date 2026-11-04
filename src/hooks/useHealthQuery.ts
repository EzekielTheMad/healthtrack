'use client';
import { useCallback, useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import type { QueryHistoryEntry } from '@/lib/types';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useSession } from '@/lib/auth/client';

export function useHealthQuery() {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const { data: session } = useSession();
  const userId = session?.user.id;
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [days, setDays] = useState<30 | 90 | 365>(90);
  const [configEpoch, setConfigEpoch] = useState(0);
  const identity = JSON.stringify([userId, dependentId, delegateOwnerId, days, configEpoch]);
  const visit = useMemo(() => ({ identity }), [identity]);
  const visitRef = useRef<typeof visit | null>(visit);
  useLayoutEffect(() => {
    visitRef.current = visit;
    return () => {
      if (visitRef.current === visit) visitRef.current = null;
    };
  }, [visit]);
  const mounted = useRef(true);
  const lastQueryRef = useRef<{ visit: typeof visit; text: string } | null>(null);
  const latestRequest = useRef(0);
  const current = useCallback(() => mounted.current && visitRef.current === visit, [visit]);
  useEffect(() => {
    mounted.current = true;
    const changed = () => setConfigEpoch((v) => v + 1);
    window.addEventListener('healthtrack:ai-settings', changed);
    return () => {
      mounted.current = false;
      window.removeEventListener('healthtrack:ai-settings', changed);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Reset only the network status for this newly authorized person/window visit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setNotice(null);
    if (!userId || delegateOwnerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch('/api/query-history', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to fetch query history');
        const rows = (await response.json()) as QueryHistoryEntry[];
        if (!controller.signal.aborted && current())
          setQueryHistory((prev) => [
            ...prev.filter((e) => e.user_id === userId),
            ...rows.filter((row) => row.user_id === userId && !prev.some((e) => e.id === row.id)),
          ]);
      })
      .catch((err) => {
        if (!controller.signal.aborted && current()) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted && current()) setLoading(false);
      });
    return () => controller.abort();
  }, [current, userId, delegateOwnerId]);
  const submitQuery = useCallback(
    async (query: string, opts?: { force?: boolean }): Promise<QueryHistoryEntry | null> => {
      if (!current() || !userId) return null;
      if (delegateOwnerId) {
        setError('Health queries are available for your own record and dependents.');
        return null;
      }
      const trimmed = query.trim();
      if (!trimmed) return null;
      setError(null);
      setNotice(null);
      lastQueryRef.current = { visit, text: trimmed };
      const number = ++latestRequest.current;
      const matches = () => current() && latestRequest.current === number;
      try {
        const response = await fetch('/api/health-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: trimmed,
            dependent_id: dependentId,
            days,
            force: opts?.force ?? false,
          }),
        });
        if (!matches()) return null;
        const result = (await response.json()) as QueryHistoryEntry & {
          message?: string;
          reused?: boolean;
        };
        if (!matches()) return null;
        if (!response.ok) throw new Error(result.message ?? 'Query failed');
        if (result.user_id !== userId || (result.dependent_id ?? null) !== dependentId)
          throw new Error('Query returned an unexpected person. Please try again.');
        setQueryHistory((prev) => [result, ...prev.filter((e) => e.id !== result.id)]);
        if (result.reused)
          setNotice(
            'Showing a saved answer verified against the current records, reporting window and AI settings.'
          );
        return result;
      } catch (err) {
        if (matches()) setError(err instanceof Error ? err.message : 'Query failed');
        return null;
      }
    },
    [current, userId, delegateOwnerId, dependentId, days, visit]
  );
  const refreshLast = useCallback(
    () =>
      lastQueryRef.current?.visit === visit
        ? submitQuery(lastQueryRef.current.text, { force: true })
        : Promise.resolve(null),
    [visit, submitQuery]
  );
  const visibleHistory = delegateOwnerId
    ? []
    : queryHistory.filter((e) => e.user_id === userId && (e.dependent_id ?? null) === dependentId);
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
