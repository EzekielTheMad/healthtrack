'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryHistoryEntry } from '@/lib/types';
import { OWNER_AI_CONTEXT_VERSION } from '@/lib/claude/owner-context';
import { useOwnerAiContext } from '@/hooks/useOwnerAiContext';

interface QueryView {
  token: object;
  queryHistory: QueryHistoryEntry[];
  loading: boolean;
  submitting: boolean;
  error: string | null;
  notice: string | null;
}

export function useHealthQuery(enabled = true) {
  const { token, ownerId, available, isOwnerProfile, capture, matchesContext } =
    useOwnerAiContext(enabled);
  const [view, setView] = useState<QueryView>({
    token,
    queryHistory: [],
    loading: available,
    submitting: false,
    error: null,
    notice: null,
  });
  const lastQueryRef = useRef<{ token: object; text: string } | null>(null);
  const latestQuery = useRef(0);

  const isCurrentEntry = useCallback(
    (value: unknown): value is QueryHistoryEntry => {
      if (!value || typeof value !== 'object') return false;
      const entry = value as QueryHistoryEntry;
      return (
        Boolean(ownerId) &&
        entry.user_id === ownerId &&
        entry.dependent_id === null &&
        entry.context_version === OWNER_AI_CONTEXT_VERSION &&
        typeof entry.id === 'string' &&
        typeof entry.query_text === 'string' &&
        typeof entry.response_text === 'string'
      );
    },
    [ownerId]
  );

  useEffect(() => {
    const request = capture();
    if (!request.isCurrent()) return;
    setView({
      token,
      queryHistory: [],
      loading: true,
      submitting: false,
      error: null,
      notice: null,
    });

    async function fetchHistory() {
      try {
        const res = await fetch('/api/query-history?dependent_id=self', { signal: request.signal });
        if (!request.isCurrent()) return;
        const body: unknown = await res.json();
        if (!request.isCurrent()) return;
        if (!res.ok || !Array.isArray(body)) throw new Error('Failed to fetch query history');
        const history = body.filter(isCurrentEntry);
        setView((prev) => ({
          ...prev,
          queryHistory: [
            ...prev.queryHistory,
            ...history.filter((entry) => !prev.queryHistory.some((saved) => saved.id === entry.id)),
          ],
        }));
      } catch {
        if (request.isCurrent())
          setView((prev) => ({ ...prev, error: 'Failed to fetch query history' }));
      } finally {
        if (request.isCurrent()) setView((prev) => ({ ...prev, loading: false }));
      }
    }

    void fetchHistory();
  }, [capture, token, isCurrentEntry]);

  /** Call the AI only while the captured owner-profile visit is still active. */
  const runQuery = useCallback(
    async (queryText: string): Promise<QueryHistoryEntry | null> => {
      const request = capture();
      if (!request.isCurrent()) return null;
      const queryNumber = ++latestQuery.current;
      setView((prev) => ({ ...prev, error: null, notice: null, submitting: true }));
      try {
        const response = await fetch('/api/health-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: queryText, dependent_id: 'self' }),
          signal: request.signal,
        });
        if (!request.isCurrent()) return null;
        const result = await response.json();
        if (!request.isCurrent()) return null;
        if (!response.ok) throw new Error(result?.message ?? 'Query failed');
        if (!matchesContext(result?.context) || !isCurrentEntry(result)) {
          throw new Error('Query returned an unexpected profile context. Please try again.');
        }
        setView((prev) => ({
          ...prev,
          queryHistory: [result, ...prev.queryHistory.filter((entry) => entry.id !== result.id)],
        }));
        return result;
      } catch (err) {
        if (request.isCurrent() && latestQuery.current === queryNumber) {
          setView((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : 'Query failed',
          }));
        }
        return null;
      } finally {
        if (request.isCurrent() && latestQuery.current === queryNumber) {
          setView((prev) => ({ ...prev, submitting: false }));
        }
      }
    },
    [capture, isCurrentEntry, matchesContext]
  );

  /** Reuse only current-version owner history; legacy mixed-context answers cannot dedupe. */
  const submitQuery = useCallback(
    async (queryText: string, opts?: { force?: boolean }): Promise<QueryHistoryEntry | null> => {
      const request = capture();
      if (!request.isCurrent()) return null;
      const trimmed = queryText.trim();
      if (!trimmed) return null;
      setView((prev) => ({ ...prev, error: null, notice: null }));
      lastQueryRef.current = { token, text: trimmed };
      if (!opts?.force && view.token === token) {
        const key = trimmed.toLowerCase();
        const match = view.queryHistory.find(
          (entry) => isCurrentEntry(entry) && entry.query_text.trim().toLowerCase() === key
        );
        if (match) {
          setView((prev) => ({
            ...prev,
            queryHistory: [match, ...prev.queryHistory.filter((entry) => entry.id !== match.id)],
            notice: 'Showing your saved answer — no new query used.',
          }));
          return match;
        }
      }
      return runQuery(trimmed);
    },
    [capture, token, view.token, view.queryHistory, isCurrentEntry, runQuery]
  );

  const refreshLast = useCallback((): Promise<QueryHistoryEntry | null> => {
    if (!capture().isCurrent() || lastQueryRef.current?.token !== token)
      return Promise.resolve(null);
    return runQuery(lastQueryRef.current.text);
  }, [capture, token, runQuery]);

  // Never render a previous profile visit's data, even before effects run.
  const visible =
    available && view.token === token
      ? view
      : {
          queryHistory: [],
          loading: available,
          submitting: false,
          error: null,
          notice: null,
        };
  return { ...visible, canQuery: available, ownerId, isOwnerProfile, submitQuery, refreshLast };
}
