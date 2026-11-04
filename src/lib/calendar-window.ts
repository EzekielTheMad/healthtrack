import { getHealthTrackTimeZone } from './oura/timezone';
import { isValidDayKey, shiftDayKey } from './dates';

/** UTC bounds of an instance-calendar day, including 23/25-hour DST days. */
export function calendarDayWindow(
  day: string,
  timezone = getHealthTrackTimeZone()
): { startAt: string; endAt: string } {
  if (!isValidDayKey(day)) throw new Error('Invalid calendar day');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const localDay = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: string) => parts.find((part) => part.type === type)!.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  const boundary = (key: string) => {
    const utc = Date.parse(`${key}T00:00:00Z`);
    let low = utc - 36 * 3600000;
    let high = utc + 36 * 3600000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (localDay(mid) < key) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const start = boundary(day);
  if (localDay(start) !== day)
    throw new Error('This calendar day does not exist in the configured timezone');
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(boundary(shiftDayKey(day, 1)) - 1).toISOString(),
  };
}
