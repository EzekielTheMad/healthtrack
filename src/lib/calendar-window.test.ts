import { describe, expect, it } from 'vitest';
import { calendarDayWindow } from './calendar-window';
describe('configured calendar bounds', () => {
  it('supports UTC and Phoenix with different midnight boundaries', () => {
    expect(calendarDayWindow('2026-10-23', 'Etc/UTC')).toEqual({
      startAt: '2026-10-23T00:00:00.000Z',
      endAt: '2026-10-23T23:59:59.999Z',
    });
    expect(calendarDayWindow('2026-10-23', 'America/Phoenix')).toEqual({
      startAt: '2026-10-23T07:00:00.000Z',
      endAt: '2026-10-24T06:59:59.999Z',
    });
  });
  it('includes all 23 or 25 local hours at DST changes', () => {
    for (const [day, hours] of [
      ['2026-03-08', 23],
      ['2026-11-01', 25],
    ] as const) {
      const span = calendarDayWindow(day, 'America/New_York');
      expect(Date.parse(span.endAt) + 1 - Date.parse(span.startAt)).toBe(hours * 3600000);
    }
  });
});
