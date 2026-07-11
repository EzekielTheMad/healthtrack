'use client';

/**
 * The per-user exercise catalog for the Fitness Trends picker and the
 * unreviewed-exercises cleanup card, via GET /api/exercises + PATCH
 * /api/exercises/{id}. List failures land in `error`; mutation failures
 * THROW (ApiRequestError) so the cleanup card can surface resolution
 * collisions (400) inline. Delegate mode reads the viewed owner's catalog
 * (?owner_id=); the catalog has no dependent dimension.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { ExerciseWire } from '@/lib/fitness/api-types';

export function useExerciseCatalog() {
  const { delegateOwnerId } = useActiveProfile();
  const [exercises, setExercises] = useState<ExerciseWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCatalog() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
        const qs = params.toString();
        const rows = await apiFetch<ExerciseWire[]>(
          qs ? `/api/exercises?${qs}` : '/api/exercises',
        );
        if (!cancelled) setExercises(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load exercises');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCatalog();
    return () => {
      cancelled = true;
    };
  }, [delegateOwnerId]);

  /** PATCH /api/exercises/{id} — wire-shaped (snake_case) partial body.
      Throws on failure (400 name/alias collisions included). */
  const updateExercise = useCallback(async (id: string, body: Record<string, unknown>) => {
    const updated = await apiFetch<ExerciseWire>(`/api/exercises/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setExercises((prev) => prev.map((e) => (e.id === id ? updated : e)));
    return updated;
  }, []);

  return { exercises, loading, error, updateExercise };
}
