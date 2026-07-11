'use client';

/**
 * Active goals for the signed-in profile — the single client seam for
 * goal-aware coloring (Focus verdicts, daily deltas, trend sparklines).
 * Fetched once per page via GET /api/goals?active=true and passed down as
 * props; components never fetch goals themselves.
 *
 * Scoping notes:
 *  - Goals are strictly per-user (no dependent column). Viewing a DEPENDENT
 *    profile skips the fetch entirely — the owner's personal goals must not
 *    color a child's vitals.
 *  - Delegate mode fetches the viewed owner's goals (?owner_id=), matching
 *    the fitness authz (delegates read-only).
 *  - Failures fail OPEN to no goals: coloring falls back to the registry
 *    defaults (exactly the no-goals experience) instead of erroring the page.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { FocusFrequencyGoal, FocusMetricGoal } from '@/lib/metrics/focus';

/** Snake-cased goal row as served by /api/goals. */
interface GoalWire {
  kind: 'metric' | 'frequency';
  metric_key: string | null;
  direction: 'increase' | 'decrease' | 'maintain' | null;
  target_value: number | null;
  session_type: string | null;
  per_week: number | null;
}

const NO_METRIC_GOALS: FocusMetricGoal[] = [];
const NO_FREQUENCY_GOALS: FocusFrequencyGoal[] = [];

export function useActiveGoals(): {
  metricGoals: FocusMetricGoal[];
  frequencyGoals: FocusFrequencyGoal[];
  loading: boolean;
} {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const skip = dependentId !== null;

  const [metricGoals, setMetricGoals] = useState<FocusMetricGoal[]>(NO_METRIC_GOALS);
  const [frequencyGoals, setFrequencyGoals] =
    useState<FocusFrequencyGoal[]>(NO_FREQUENCY_GOALS);
  const [loading, setLoading] = useState(!skip);

  useEffect(() => {
    if (skip) {
      setMetricGoals(NO_METRIC_GOALS);
      setFrequencyGoals(NO_FREQUENCY_GOALS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchGoals() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ active: 'true' });
        if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
        const rows = await apiFetch<GoalWire[]>(`/api/goals?${params}`);
        if (cancelled) return;
        setMetricGoals(
          rows
            .filter((r) => r.kind === 'metric' && r.metric_key !== null && r.direction !== null)
            .map((r) => ({
              metricKey: r.metric_key as string,
              direction: r.direction as FocusMetricGoal['direction'],
              targetValue: r.target_value,
            })),
        );
        setFrequencyGoals(
          rows
            .filter((r) => r.kind === 'frequency' && r.session_type !== null && r.per_week !== null)
            .map((r) => ({
              sessionType: r.session_type as string,
              perWeek: r.per_week as number,
            })),
        );
      } catch {
        // Fail open — see module doc.
        if (!cancelled) {
          setMetricGoals(NO_METRIC_GOALS);
          setFrequencyGoals(NO_FREQUENCY_GOALS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchGoals();
    return () => {
      cancelled = true;
    };
  }, [skip, delegateOwnerId]);

  return { metricGoals, frequencyGoals, loading };
}
