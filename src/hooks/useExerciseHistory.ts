'use client';

/**
 * Recent entries for one exercise (newest session first) for the Fitness
 * Trends charts, via GET /api/exercises/{id}/history. Pass null to skip the
 * fetch (no exercise picked yet). Ownership is enforced server-side off the
 * catalog row, so no scope params apply here.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { ExerciseHistoryItemWire } from '@/lib/fitness/api-types';

/** Trend window — enough for a year of twice-weekly sessions. */
const HISTORY_LIMIT = 100;

const NO_ITEMS: ExerciseHistoryItemWire[] = [];

export function useExerciseHistory(exerciseId: string | null) {
  const [items, setItems] = useState<ExerciseHistoryItemWire[]>(NO_ITEMS);
  const [loading, setLoading] = useState(exerciseId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (exerciseId === null) {
      setItems(NO_ITEMS);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        const rows = await apiFetch<ExerciseHistoryItemWire[]>(
          `/api/exercises/${exerciseId}/history?limit=${HISTORY_LIMIT}`,
        );
        if (!cancelled) setItems(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load exercise history');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  return { items, loading, error };
}
