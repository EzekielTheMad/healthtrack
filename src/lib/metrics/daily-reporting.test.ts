import { describe, expect, it } from 'vitest';
import { missingDailyReports } from './daily-reporting';
import { withDailyGaps } from './daily-gaps';

const row = (metric_key: string, value: number, day: string, source = 'bridge') => ({
  metric_key,
  value,
  recorded_at: `${day}T00:00:00Z`,
  source,
  unit: null,
});
describe('daily reporting states', () => {
  it('marks yesterday as awaiting without fabricating zero; older gaps are missing', () => {
    const rows = [row('cpap_usage', 7, '2026-10-20')];
    expect(missingDailyReports(rows, '2026-10-21', '2026-10-22')[0].state).toBe('awaiting');
    expect(missingDailyReports(rows, '2026-10-21', '2026-10-23')[0].state).toBe('missing');
  });
  it('accepts a reported zero and excludes sparse measurements or manual metrics', () => {
    const rows = [
      row('cpap_usage', 7, '2026-10-20'),
      row('cpap_usage', 0, '2026-10-21'),
      row('waist', 35, '2026-10-20'),
      row('resting_hr', 60, '2026-10-20', 'manual'),
    ];
    expect(missingDailyReports(rows, '2026-10-21', '2026-10-22')).toEqual([]);
  });
  it('fills daily line gaps with null and preserves multiple observations on a day', () => {
    const rows = [
      row('ahi', 0, '2026-10-20'),
      row('ahi', 1, '2026-10-20'),
      row('ahi', 2, '2026-10-22'),
    ];
    expect(withDailyGaps(rows).map((r) => r.value)).toEqual([0, 1, null, 2]);
  });
});
