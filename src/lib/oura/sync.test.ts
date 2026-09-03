import { describe, expect, it } from 'vitest';
import { OURA_LOOKBACK_DAYS, selectLongestSleep, syncWindow } from './sync';

describe('Oura sync semantics', () => {
  it('uses an inclusive seven-day self-heal window and next-day sleep end', () => {
    expect(syncWindow(new Date('2026-09-10T12:00:00Z'))).toEqual({
      startDate: '2026-09-04', endDate: '2026-09-10', sleepEndDate: '2026-09-11',
    });
    expect(OURA_LOOKBACK_DAYS).toBe(7);
  });
  it('supports the 30-day initial OAuth backfill', () => {
    expect(syncWindow(new Date('2026-09-10T12:00:00Z'), 30).startDate).toBe('2026-08-12');
  });
  it('selects only the longest sleep session for each day', () => {
    const rows = [
      { day: '2026-09-09', id: 'nap', total_sleep_duration: 1200 },
      { day: '2026-09-09', id: 'main', total_sleep_duration: 28800 },
      { day: '2026-09-08', id: 'other', total_sleep_duration: 24000 },
    ];
    expect(selectLongestSleep(rows).map((r) => r.id)).toEqual(['main', 'other']);
  });
});
