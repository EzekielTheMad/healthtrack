'use client';

/**
 * Full goal management (all rows, active and retired) for the Fitness Goals
 * tab, via GET/POST /api/goals + PATCH /api/goals/{id}. Distinct from
 * useActiveGoals, which serves the read-only active slice for coloring.
 * Mutation failures THROW (ApiRequestError) so the form can surface the
 * one-active-per-slot 409 inline. Delegate mode reads via ?owner_id=;
 * writes are owner-only (the API rejects the rest).
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { GoalWire } from '@/lib/fitness/api-types';

export function useGoalManager() {
  const { delegateOwnerId } = useActiveProfile();
  const [goals, setGoals] = useState<GoalWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchGoals() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
        const qs = params.toString();
        const rows = await apiFetch<GoalWire[]>(qs ? `/api/goals?${qs}` : '/api/goals');
        if (!cancelled) setGoals(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load goals');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchGoals();
    return () => {
      cancelled = true;
    };
  }, [delegateOwnerId]);

  /** POST /api/goals — wire-shaped (snake_case) body. Throws on failure
      (409 duplicate active slot included). */
  const createGoal = useCallback(async (body: Record<string, unknown>) => {
    const row = await apiFetch<GoalWire>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setGoals((prev) => [row, ...prev]);
    return row;
  }, []);

  /** PATCH /api/goals/{id} — wire-shaped (snake_case) partial body. Throws
      on failure (409 re-activation conflicts included). */
  const updateGoal = useCallback(async (id: string, body: Record<string, unknown>) => {
    const row = await apiFetch<GoalWire>(`/api/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setGoals((prev) => prev.map((g) => (g.id === id ? row : g)));
    return row;
  }, []);

  return { goals, loading, error, createGoal, updateGoal };
}
