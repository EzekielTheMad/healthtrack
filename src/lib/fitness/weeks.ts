// ---------------------------------------------------------------------------
// Monday-anchored week helpers for the fitness domain.
//
// The spec's timezone convention (fitness-domain design §Timezone): weekStart
// and all weekly windows use LOCAL owner-timezone day boundaries, Monday-
// anchored — matching the Mon–Sun convention and the Daily view's
// localDayKey. Session startedAt is a real timestamp; which week it belongs
// to depends on the owner's IANA timezone (America/Phoenix), not UTC and not
// the server's locale.
//
// Day keys are `YYYY-MM-DD` strings; once an instant is resolved to a day key
// in the target timezone, all week arithmetic reuses the DST-free UTC day-key
// math from src/lib/dates.ts (shiftDayKey).
// ---------------------------------------------------------------------------

import { shiftDayKey } from '../dates';

// Intl.DateTimeFormat construction is expensive; cache one formatter per tz.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function tzFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

/** Calendar day (`YYYY-MM-DD`) an instant falls on in the given IANA tz. */
export function dayKeyInTz(date: Date, tz: string): string {
  const parts = tzFormatter(tz).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO day-of-week for a day key: 1 = Monday … 7 = Sunday. */
function isoDayOfWeek(dayKey: string): number {
  const dow = new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

/** Monday day key of the week containing `dayKey`. */
export function weekStartOfDayKey(dayKey: string): string {
  return shiftDayKey(dayKey, 1 - isoDayOfWeek(dayKey));
}

/**
 * Monday day key (`YYYY-MM-DD`) of the week containing `date`, resolved in
 * the given IANA timezone (owner convention: America/Phoenix).
 */
export function weekStartOf(date: Date, tz: string): string {
  return weekStartOfDayKey(dayKeyInTz(date, tz));
}

/** Whether a day key is a Monday (valid `weekStart` per the API contract). */
export function isMonday(dayKey: string): boolean {
  return isoDayOfWeek(dayKey) === 1;
}

/** The 7 day keys of a week, Monday through Sunday, given its Monday key. */
export function weekDayKeys(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDayKey(weekStart, i));
}

/** Monday key of the week before the given week (prior-week deltas). */
export function priorWeekStart(weekStart: string): string {
  return shiftDayKey(weekStart, -7);
}
