// ---------------------------------------------------------------------------
// Vital date formatting.
//
// Non-intraday rows are stored day-normalized (`recorded_at: "YYYY-MM-DDT00:00:00Z"`).
// Rendering those through local-timezone date APIs shows the PREVIOUS day (plus
// a meaningless clock time) anywhere west of UTC — so they must always be
// formatted from UTC date parts, date only. Intraday metrics (blood_glucose,
// bp_* — `intraday: true` in the registry) carry real timestamps and keep
// local datetimes.
// ---------------------------------------------------------------------------

import { getMetric } from './metrics/registry';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isIntraday(metricKey: string): boolean {
  return getMetric(metricKey)?.intraday === true;
}

/** `2026-07-08T00:00:00Z` → `Jul 8` — UTC date parts, timezone-independent. */
export function formatUtcDay(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `2026-07-08T00:00:00Z` → `Jul 8, 2026` — UTC date parts. */
export function formatUtcDayYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** `2026-07-08T00:00:00Z` → `Jul 2026` — UTC parts, for long-range axes. */
export function formatUtcMonthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Local time of day (`5:23 PM`) — intraday readings in the daily table. */
export function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Short display date for a vital reading (stat cards, tables, chart axes).
 * Intraday metrics → local datetime (`Jul 8, 5:23 PM`); everything else
 * (including registry-unknown keys) → UTC date only (`Jul 8`).
 */
export function formatVitalDate(recordedAt: string, metricKey: string): string {
  if (isIntraday(metricKey)) {
    return new Date(recordedAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return formatUtcDay(recordedAt);
}

/** Long display date with year (chart tooltips). Same UTC/local split. */
export function formatVitalDateLong(recordedAt: string, metricKey: string): string {
  if (isIntraday(metricKey)) {
    return new Date(recordedAt).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return formatUtcDayYear(recordedAt);
}

/**
 * Calendar-day bucket (`YYYY-MM-DD`) a reading belongs to: UTC date parts for
 * day-normalized non-intraday rows (their UTC date IS the intended day),
 * local date parts for intraday rows (readings group under the user's day).
 */
export function getVitalDayKey(recordedAt: string, metricKey: string): string {
  const d = new Date(recordedAt);
  if (isIntraday(metricKey)) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Shift a `YYYY-MM-DD` day key by whole days (UTC math — no DST edges). */
export function shiftDayKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** `2026-07-08` → `2026-07-08T00:00:00.000Z` (day-normalized row convention). */
export function dayKeyToUtcIso(dayKey: string): string {
  return `${dayKey}T00:00:00.000Z`;
}

/** Today's (or `d`'s) calendar day in the user's local timezone. */
export function localDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
