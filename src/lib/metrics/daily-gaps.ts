import { shiftDayKey } from '@/lib/dates';

/** Explicit nulls break daily chart lines at missing reports instead of implying continuity. */
export function withDailyGaps<T extends { recorded_at: string; value: number }>(
  rows: readonly T[]
): Array<T | { recorded_at: string; value: null }> {
  if (rows.length < 2) return [...rows];
  const sorted = [...rows].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const out: Array<T | { recorded_at: string; value: null }> = [];
  // Bound malformed/outsize histories; the API can expose years of sparse history.
  let count = 0;
  let previousDay: string | null = null;
  for (const row of sorted) {
    const day = row.recorded_at.slice(0, 10);
    if (previousDay)
      for (
        let missing = shiftDayKey(previousDay, 1);
        missing < day && count < 3660;
        missing = shiftDayKey(missing, 1), count += 1
      ) {
        out.push({ recorded_at: `${missing}T00:00:00Z`, value: null });
      }
    out.push(row);
    previousDay = day;
  }
  return count === 3660 ? [...rows] : out;
}
