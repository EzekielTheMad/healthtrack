/**
 * Vital date formatting — day-normalized rows (recorded_at T00:00:00Z) must
 * render from UTC date parts (date only); intraday metrics keep local
 * datetimes. Regression: TZ<0 used to show the previous day + "5:00 PM".
 */
import { describe, it, expect } from 'vitest';
import {
  formatVitalDate,
  formatVitalDateLong,
  formatUtcDay,
  formatUtcMonthYear,
  formatLocalTime,
  getVitalDayKey,
  shiftDayKey,
  dayKeyToUtcIso,
  localDayKey,
  formatDateOnly,
  isValidDayKey,
} from './dates';

describe('clinical calendar dates', () => {
  it('preserves the printed day, including a year boundary, without timezone conversion', () => {
    expect(formatDateOnly('2026-10-22')).toBe('Oct 22, 2026');
    expect(formatDateOnly('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDateOnly('2024-02-29', { month: 'long', day: 'numeric', year: 'numeric' })).toBe(
      'February 29, 2024'
    );
  });

  it('keeps unknown and invalid calendar dates explicit', () => {
    expect(formatDateOnly(null)).toBe('—');
    expect(formatDateOnly('not a date')).toBe('not a date');
    expect(isValidDayKey('2026-02-30')).toBe(false);
    expect(isValidDayKey('2026-02-29')).toBe(false);
    expect(isValidDayKey('2024-02-29')).toBe(true);
  });
});

describe('formatUtcDay', () => {
  it('formats from UTC date parts regardless of local timezone', () => {
    // In TZ-0700 local rendering would say "Jul 7" — the bug this guards.
    expect(formatUtcDay('2026-07-08T00:00:00Z')).toBe('Jul 8');
    expect(formatUtcDay('2026-01-01T00:00:00Z')).toBe('Jan 1');
    expect(formatUtcDay('2025-12-31T00:00:00.000Z')).toBe('Dec 31');
  });
});

describe('formatUtcMonthYear', () => {
  it('formats month + year from UTC parts', () => {
    expect(formatUtcMonthYear('2026-07-08T00:00:00Z')).toBe('Jul 2026');
    expect(formatUtcMonthYear('2025-01-01T00:00:00Z')).toBe('Jan 2025');
  });
});

describe('formatVitalDate', () => {
  it('renders day-normalized non-intraday rows as UTC date only', () => {
    expect(formatVitalDate('2026-07-08T00:00:00Z', 'sleep_score')).toBe('Jul 8');
    expect(formatVitalDate('2026-07-08T00:00:00Z', 'weight')).toBe('Jul 8');
  });

  it('renders unknown metric keys as UTC date only (non-intraday default)', () => {
    expect(formatVitalDate('2026-07-08T00:00:00Z', 'mystery_metric')).toBe('Jul 8');
  });

  it('renders intraday metrics as local datetime', () => {
    const iso = '2026-07-08T14:30:00Z';
    const expected = new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(formatVitalDate(iso, 'blood_glucose')).toBe(expected);
    expect(formatVitalDate(iso, 'bp_systolic')).toBe(expected);
  });
});

describe('formatVitalDateLong', () => {
  it('includes the year for non-intraday rows (UTC parts)', () => {
    expect(formatVitalDateLong('2026-07-08T00:00:00Z', 'sleep_score')).toBe('Jul 8, 2026');
  });

  it('renders intraday rows as full local datetime', () => {
    const iso = '2026-07-08T14:30:00Z';
    const expected = new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(formatVitalDateLong(iso, 'blood_glucose')).toBe(expected);
  });
});

describe('formatLocalTime', () => {
  it('formats the local time of day', () => {
    const iso = '2026-07-08T14:30:00Z';
    const expected = new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    expect(formatLocalTime(iso)).toBe(expected);
  });
});

describe('getVitalDayKey', () => {
  it('uses the configured instance day across a browser-timezone midnight disagreement', () => {
    const instant = '2026-10-23T06:30:00Z';
    expect(getVitalDayKey(instant, 'bp_systolic', 'America/Phoenix')).toBe('2026-10-22');
    expect(getVitalDayKey(instant, 'bp_systolic', 'America/New_York')).toBe('2026-10-23');
    expect(localDayKey(new Date(instant), 'America/Phoenix')).toBe('2026-10-22');
    // Day-normalized metrics retain the provider's printed calendar date.
    expect(getVitalDayKey('2026-10-23T00:00:00Z', 'sleep_score', 'America/Phoenix')).toBe(
      '2026-10-23'
    );
    expect(formatVitalDateLong(instant, 'bp_systolic', 'America/Phoenix')).toBe(
      new Date(instant).toLocaleString(undefined, {
        timeZone: 'America/Phoenix',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    );
  });

  it('keeps the same reporting day across the DST spring clock jump', () => {
    const before = '2026-03-08T06:59:00Z';
    const after = '2026-03-08T07:00:00Z';
    expect(getVitalDayKey(before, 'blood_glucose', 'America/New_York')).toBe('2026-03-08');
    expect(getVitalDayKey(after, 'blood_glucose', 'America/New_York')).toBe('2026-03-08');
    expect(formatLocalTime(before, 'America/New_York')).toBe(
      new Date(before).toLocaleTimeString(undefined, {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      })
    );
    expect(formatLocalTime(after, 'America/New_York')).toBe(
      new Date(after).toLocaleTimeString(undefined, {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      })
    );
  });

  it('keys non-intraday rows by UTC date parts', () => {
    expect(getVitalDayKey('2026-07-08T00:00:00Z', 'sleep_score')).toBe('2026-07-08');
    // Even a non-midnight timestamp on a non-intraday metric keys by UTC day.
    expect(getVitalDayKey('2026-07-08T23:59:59Z', 'weight')).toBe('2026-07-08');
  });

  it('keys intraday rows by local date parts', () => {
    const iso = '2026-07-08T14:30:00Z';
    const d = new Date(iso);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(getVitalDayKey(iso, 'blood_glucose')).toBe(expected);
  });
});

describe('shiftDayKey', () => {
  it('shifts across month and year boundaries', () => {
    expect(shiftDayKey('2026-07-08', 1)).toBe('2026-07-09');
    expect(shiftDayKey('2026-07-01', -1)).toBe('2026-06-30');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01'); // not a leap year
    expect(shiftDayKey('2024-02-28', 1)).toBe('2024-02-29'); // leap year
  });
});

describe('dayKeyToUtcIso', () => {
  it('produces a day-normalized UTC ISO timestamp', () => {
    expect(dayKeyToUtcIso('2026-07-08')).toBe('2026-07-08T00:00:00.000Z');
  });
});

describe('localDayKey', () => {
  it('uses local date parts', () => {
    const d = new Date(2026, 6, 8, 23, 30); // local Jul 8, any TZ
    expect(localDayKey(d)).toBe('2026-07-08');
  });
});
