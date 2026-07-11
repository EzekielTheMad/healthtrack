'use client';

/**
 * Recent workout sessions (type + startedAt only) for the Focus activity
 * panel's frequency-goal week progress, via GET /api/workouts?from=.
 * `enabled: false` (no active frequency goals) skips the fetch entirely.
 * Failures fail open to an empty list — the panel then shows 0/N progress
 * rather than erroring the view.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { FocusWeekSession } from '@/lib/metrics/focus';

/** Snake-cased session slice as served by /api/workouts. */
interface WorkoutWire {
  type: string;
  started_at: string;
}

const NO_SESSIONS: FocusWeekSession[] = [];

export function useRecentWorkouts(options: {
  /** Inclusive started_at lower bound (ISO). */
  from: string;
  enabled: boolean;
}): { sessions: FocusWeekSession[]; loading: boolean } {
  const { from, enabled } = options;
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const [sessions, setSessions] = useState<FocusWeekSession[]>(NO_SESSIONS);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setSessions(NO_SESSIONS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function fetchWorkouts() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ from });
        if (delegateOwnerId) params.set('owner_id', delegateOwnerId);
        else if (dependentId) params.set('dependent_id', dependentId);
        const rows = await apiFetch<WorkoutWire[]>(`/api/workouts?${params}`);
        if (cancelled) return;
        setSessions(rows.map((r) => ({ type: r.type, startedAt: r.started_at })));
      } catch {
        if (!cancelled) setSessions(NO_SESSIONS); // fail open — see module doc
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchWorkouts();
    return () => {
      cancelled = true;
    };
  }, [enabled, from, dependentId, delegateOwnerId]);

  return { sessions, loading };
}
