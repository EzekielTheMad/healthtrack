'use client';

/**
 * Full workout sessions (nested entries) for the Fitness History tab, via
 * GET /api/workouts, plus the create/edit/delete mutations (POST
 * /api/workouts, PATCH/DELETE /api/workouts/{id}). List failures land in
 * `error`; mutation failures THROW (ApiRequestError) so forms can surface
 * them inline (409 dedupe etc.). Scoping mirrors useVitals: ?owner_id= in
 * delegate mode, ?dependent_id= for an active dependent profile.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { WorkoutWire } from '@/lib/fitness/api-types';

interface UseWorkoutSessionsOptions {
  /** Inclusive started_at lower bound (ISO). */
  from?: string;
  /** Inclusive started_at upper bound (ISO). */
  to?: string;
  type?: string;
}

export function useWorkoutSessions(options: UseWorkoutSessionsOptions = {}) {
  const { from, to, type } = options;
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const [sessions, setSessions] = useState<WorkoutWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
        else if (dependentId) params.set('dependent_id', dependentId);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (type) params.set('type', type);
        const qs = params.toString();
        const rows = await apiFetch<WorkoutWire[]>(
          qs ? `/api/workouts?${qs}` : '/api/workouts',
        );
        if (!cancelled) setSessions(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workouts');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSessions();
    return () => {
      cancelled = true;
    };
  }, [from, to, type, dependentId, delegateOwnerId]);

  /** POST /api/workouts — wire-shaped (snake_case) create body with nested
      entries. Scope keys mirror the list params: owner_id in delegate mode,
      dependent_id for an active dependent profile. Throws on failure
      (409 dedupe etc.). */
  const createSession = useCallback(
    async (body: Record<string, unknown>) => {
      const payload: Record<string, unknown> = { ...body };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;
      const created = await apiFetch<WorkoutWire>('/api/workouts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // Keep the list's started_at-descending order without a refetch.
      setSessions((prev) =>
        [created, ...prev].sort((a, b) => b.started_at.localeCompare(a.started_at)),
      );
      return created;
    },
    [dependentId, delegateOwnerId],
  );

  /** PATCH /api/workouts/{id} — wire-shaped (snake_case) partial body;
      `entries` present = full replacement. Throws on failure. */
  const updateSession = useCallback(async (id: string, body: Record<string, unknown>) => {
    const updated = await apiFetch<WorkoutWire>(`/api/workouts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    return updated;
  }, []);

  /** DELETE /api/workouts/{id}. Throws on failure. */
  const deleteSession = useCallback(async (id: string) => {
    await apiFetch<undefined>(`/api/workouts/${id}`, { method: 'DELETE' });
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { sessions, loading, error, createSession, updateSession, deleteSession };
}
