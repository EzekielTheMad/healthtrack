import { describe, expect, it } from 'vitest';
import { selectVitalSources, sourceConflicts } from './source-selection';

const reading = (source: string, metric_key = 'steps', day = '2026-10-20', value = 7000) => ({
  source,
  metric_key,
  recorded_at: `${day}T00:00:00Z`,
  value,
});

describe('source selection', () => {
  it('uses Health Connect totals once, while preserving the raw rows', () => {
    const rows = [reading('oura'), reading('health_connect_daily', 'steps', undefined, 8000)];
    expect(selectVitalSources(rows)).toEqual([rows[1]]);
    expect(rows).toHaveLength(2);
  });
  it('requires an explicit choice for competing non-activity sources', () => {
    const rows = [reading('scale-a', 'weight'), reading('scale-b', 'weight')];
    expect(selectVitalSources(rows)).toEqual([]);
    expect(sourceConflicts(rows)[0]).toMatchObject({
      needsChoice: true,
      sources: ['scale-a', 'scale-b'],
    });
    expect(selectVitalSources(rows, { weight: 'scale-b' })).toEqual([rows[1]]);
  });
  it('never fills a selected source gap with a different device', () => {
    const rows = [
      reading('oura', 'steps', '2026-10-20'),
      reading('health_connect_daily', 'steps', '2026-10-21'),
    ];
    expect(selectVitalSources(rows, { steps: 'oura' })).toEqual([rows[0]]);
    expect(selectVitalSources(rows, { steps: 'not-reporting' })).toEqual([]);
  });
  it('retains intraday readings and explicit zeros from one source, with camelCase support', () => {
    const rows = [
      { metricKey: 'cpap_usage', source: 'bridge', recordedAt: '2026-10-20', value: 0 },
      { metricKey: 'cpap_usage', source: 'bridge', recordedAt: '2026-10-21', value: 7 },
    ];
    expect(selectVitalSources(rows)).toEqual(rows);
  });
});
