// ---------------------------------------------------------------------------
// Pure chart-point builders for the exercise-trends UI.
//
// Turns exercise history items (one per exercise_entry, with the server's
// derived working weight / top seconds and the typed set array) into:
//  - a chronological trend series with best-Epley e1RM secondaries and
//    PR flags (a point is a PR when it strictly exceeds every prior value);
//  - Monday-anchored weekly tonnage buckets (weeks.ts + e1rm.ts, viewer TZ).
//
// Pure by design (mirrors e1rm.ts / set-parser.ts): no fetching, no registry.
// ---------------------------------------------------------------------------

import { bestE1rm, tonnage } from './e1rm';
import type { ParsedSet } from './set-parser';
import { dayKeyInTz, weekStartOfDayKey } from './weeks';

/** The slice of one history item (exercise_entry + its session) needed here. */
export interface TrendHistoryItem {
  /** Session started_at (ISO timestamp). */
  date: string;
  sets: ParsedSet[];
  /** Server-derived: heaviest non-warmup set's weight (weight mode). */
  workingWeight: number | null;
  /** Server-derived: max non-warmup seconds (time mode). */
  topSeconds: number | null;
}

export interface TrendPoint {
  /** Session started_at (ISO timestamp). */
  date: string;
  /** Working weight (weight mode) or top seconds (time mode). */
  value: number;
  /** Best Epley e1RM over the point's working sets; null for time mode. */
  e1rm: number | null;
  /** True when `value` strictly exceeds every earlier point's value. */
  isPr: boolean;
}

/**
 * Chronological trend series for one exercise. Items may arrive in any order
 * (the history API serves newest-first); entries with no derivable value are
 * skipped. The first point is a baseline, not a PR.
 */
export function buildTrendPoints(
  items: readonly TrendHistoryItem[],
  mode: 'weight' | 'time',
): TrendPoint[] {
  const ordered = [...items].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  const points: TrendPoint[] = [];
  let max = -Infinity;
  let first = true;
  for (const item of ordered) {
    const value = mode === 'time' ? item.topSeconds : item.workingWeight;
    if (value === null) continue;
    const isPr = !first && value > max;
    if (value > max) max = value;
    points.push({
      date: item.date,
      value,
      e1rm: mode === 'weight' ? bestE1rm(item.sets) : null,
      isPr,
    });
    first = false;
  }
  return points;
}

export interface WeeklyTonnageBucket {
  /** Monday day key (YYYY-MM-DD) of the bucket's week. */
  weekStart: string;
  tonnage: number;
}

/**
 * Monday-anchored weekly tonnage totals over the given entries, resolved in
 * the viewer's IANA timezone (matching the Focus view's week convention).
 * Weeks with no working volume are omitted rather than zero-filled — the
 * history API is limit-windowed, so leading gaps would read as missed weeks
 * when they are really just outside the fetched window.
 */
export function weeklyTonnage(
  items: readonly Pick<TrendHistoryItem, 'date' | 'sets'>[],
  tz: string,
): WeeklyTonnageBucket[] {
  const byWeek = new Map<string, number>();
  for (const item of items) {
    const load = tonnage(item.sets);
    if (load <= 0) continue;
    const week = weekStartOfDayKey(dayKeyInTz(new Date(item.date), tz));
    byWeek.set(week, (byWeek.get(week) ?? 0) + load);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, total]) => ({ weekStart, tonnage: total }));
}
