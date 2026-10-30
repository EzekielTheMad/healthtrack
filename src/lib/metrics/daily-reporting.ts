import { getVitalDayKey, shiftDayKey } from '@/lib/dates';
import { getMetric } from './registry';
import type { ViewVitalRow } from './vitals-view';

export interface MissingDailyReport {
  metricKey: string;
  label: string;
  source: string;
  state: 'awaiting' | 'missing';
}

/** Only daily device metrics seen recently are expected; sparse body/lab readings are excluded. */
export function missingDailyReports(
  rows: readonly ViewVitalRow[],
  day: string,
  today: string,
  timeZone?: string
): MissingDailyReport[] {
  if (day > today) return [];
  const present = new Set(
    rows
      .filter((r) => getVitalDayKey(r.recorded_at, r.metric_key, timeZone) === day)
      .map((r) => r.metric_key)
  );
  const previous = new Map<string, ViewVitalRow>();
  for (const row of rows) {
    const metric = getMetric(row.metric_key);
    const rowDay = getVitalDayKey(row.recorded_at, row.metric_key, timeZone);
    if (
      !metric ||
      row.source === 'manual' ||
      rowDay >= day ||
      rowDay < shiftDayKey(day, -7) ||
      present.has(row.metric_key)
    )
      continue;
    if (
      !['sleep', 'respiratory', 'recovery', 'activity'].includes(metric.category) ||
      ['vo2_max', 'resilience'].includes(metric.key)
    )
      continue;
    previous.set(row.metric_key, row);
  }
  return [...previous.values()].map((row) => ({
    metricKey: row.metric_key,
    label: getMetric(row.metric_key)!.label,
    source: row.source,
    state: day >= shiftDayKey(today, -1) ? 'awaiting' : 'missing',
  }));
}
