export const DEFAULT_HEALTHTRACK_TIMEZONE = 'Etc/UTC';
export const HEALTHTRACK_TIMEZONE_ENV = 'TZ';

/**
 * Resolve the application calendar timezone used for provider date windows.
 * Intl validates IANA identifiers using the runtime's installed tzdata.
 */
export function getHealthTrackTimeZone(configured = process.env.TZ): string {
  const timeZone = configured?.trim() || DEFAULT_HEALTHTRACK_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new Error(
      `${HEALTHTRACK_TIMEZONE_ENV} must be a valid IANA timezone (received '${timeZone}')`
    );
  }
  return timeZone;
}

/** Calendar date containing an instant in the configured IANA timezone. */
export function calendarDayInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error(`Unable to resolve calendar day in ${timeZone}`);
  return `${year}-${month}-${day}`;
}

/** Add calendar days to a YYYY-MM-DD key without depending on host timezone. */
export function addCalendarDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
