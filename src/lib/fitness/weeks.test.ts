/**
 * Monday-anchored week helpers — owner timezone (America/Phoenix, no DST)
 * plus a DST-transition timezone (America/New_York) to prove week boundaries
 * follow the target tz's wall clock, not UTC or the test machine's locale.
 *
 * 2026 calendar facts used below: Jul 6 / Jan 12 / Mar 2 / Mar 9 / Oct 26 /
 * Nov 2 are Mondays; Mar 8 (spring forward) and Nov 1 (fall back) are the
 * 2026 US DST-transition Sundays.
 */
import { describe, it, expect } from 'vitest';
import {
  dayKeyInTz,
  weekStartOf,
  weekStartOfDayKey,
  isMonday,
  weekDayKeys,
  priorWeekStart,
} from './weeks';

const PHX = 'America/Phoenix';
const NYC = 'America/New_York';

describe('dayKeyInTz', () => {
  it('resolves the calendar day in the target timezone, not UTC', () => {
    // 06:59Z is 23:59 the previous day in Phoenix (UTC-7).
    expect(dayKeyInTz(new Date('2026-07-08T06:59:00Z'), PHX)).toBe('2026-07-07');
    expect(dayKeyInTz(new Date('2026-07-08T07:00:00Z'), PHX)).toBe('2026-07-08');
  });
});

describe('weekStartOf — Phoenix (no DST, fixed UTC-7)', () => {
  it('anchors mid-week instants to the Monday of that local week', () => {
    // Wed Jul 8 in Phoenix -> week of Mon Jul 6.
    expect(weekStartOf(new Date('2026-07-08T19:00:00Z'), PHX)).toBe('2026-07-06');
  });

  it('keeps late-Sunday instants in the ending week and Phoenix-midnight Monday in the next', () => {
    // Sun Jul 12 23:59 Phoenix -> still week of Jul 6.
    expect(weekStartOf(new Date('2026-07-13T06:59:00Z'), PHX)).toBe('2026-07-06');
    // Mon Jul 13 00:00 Phoenix -> week of Jul 13.
    expect(weekStartOf(new Date('2026-07-13T07:00:00Z'), PHX)).toBe('2026-07-13');
  });

  it('uses the same UTC-7 boundary in winter (DST-irrelevant)', () => {
    // Phoenix never shifts: the Sunday/Monday boundary is 07:00Z year-round.
    expect(weekStartOf(new Date('2026-01-12T06:59:00Z'), PHX)).toBe('2026-01-05');
    expect(weekStartOf(new Date('2026-01-12T07:00:00Z'), PHX)).toBe('2026-01-12');
  });
});

describe('weekStartOf — New York (DST transitions)', () => {
  it('spring forward (Mar 8): week boundary follows the EDT wall clock', () => {
    // Sun Mar 8 23:59 EDT (UTC-4 after the jump) -> week of Mon Mar 2.
    expect(weekStartOf(new Date('2026-03-09T03:59:00Z'), NYC)).toBe('2026-03-02');
    // Mon Mar 9 00:00 EDT -> week of Mar 9. (Under UTC-5 this instant would
    // still be Sunday — the DST shift moves the boundary an hour earlier.)
    expect(weekStartOf(new Date('2026-03-09T04:00:00Z'), NYC)).toBe('2026-03-09');
  });

  it('fall back (Nov 1): week boundary follows the EST wall clock', () => {
    // Sun Nov 1 23:59 EST (UTC-5 after the shift) -> week of Mon Oct 26.
    expect(weekStartOf(new Date('2026-11-02T04:59:00Z'), NYC)).toBe('2026-10-26');
    // Mon Nov 2 00:00 EST -> week of Nov 2.
    expect(weekStartOf(new Date('2026-11-02T05:00:00Z'), NYC)).toBe('2026-11-02');
  });
});

describe('weekStartOfDayKey', () => {
  it('maps every day of a week to its Monday', () => {
    expect(weekStartOfDayKey('2026-07-06')).toBe('2026-07-06'); // Monday itself
    expect(weekStartOfDayKey('2026-07-08')).toBe('2026-07-06'); // Wednesday
    expect(weekStartOfDayKey('2026-07-12')).toBe('2026-07-06'); // Sunday
  });

  it('crosses month and year boundaries', () => {
    expect(weekStartOfDayKey('2026-07-01')).toBe('2026-06-29'); // Wed -> prior June Monday
    expect(weekStartOfDayKey('2026-01-01')).toBe('2025-12-29'); // Thu -> prior-year Monday
  });
});

describe('isMonday', () => {
  it('accepts Mondays and rejects other days', () => {
    expect(isMonday('2026-07-06')).toBe(true);
    expect(isMonday('2026-07-07')).toBe(false); // Tuesday
    expect(isMonday('2026-07-12')).toBe(false); // Sunday
    expect(isMonday('2026-07-05')).toBe(false); // prior Sunday
  });

  it('rejects malformed keys instead of throwing', () => {
    expect(isMonday('not-a-date')).toBe(false);
  });
});

describe('weekDayKeys', () => {
  it('returns Monday through Sunday', () => {
    expect(weekDayKeys('2026-07-06')).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]);
  });

  it('crosses a month boundary', () => {
    expect(weekDayKeys('2026-06-29')).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ]);
  });
});

describe('priorWeekStart', () => {
  it('steps back exactly one week', () => {
    expect(priorWeekStart('2026-07-06')).toBe('2026-06-29');
  });

  it('crosses a year boundary', () => {
    expect(priorWeekStart('2026-01-05')).toBe('2025-12-29');
  });
});
