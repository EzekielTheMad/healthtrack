import { describe, it, expect } from 'vitest';
import {
  METRIC_CATALOG,
  DEVICE_DEFAULTS,
  MANUAL_DEFAULTS,
  getMetricDefinition,
} from './dashboard-metrics';
import { METRICS, getMetric } from './metrics/registry';

describe('dashboard metric catalog (registry-derived)', () => {
  it('contains one entry per dashboard-eligible registry metric', () => {
    const eligible = METRICS.filter((m) => m.dashboardEligible !== false);
    expect(METRIC_CATALOG.length).toBe(eligible.length);
    for (const def of METRIC_CATALOG) {
      expect(getMetric(def.metricKey), `catalog key ${def.metricKey}`).toBeDefined();
    }
  });

  it('fixes the historical sleep_duration mislabel', () => {
    expect(getMetricDefinition('sleep_duration')!.label).toBe('Sleep Duration');
  });

  it('keeps default stat keys valid registry metrics', () => {
    for (const key of [...DEVICE_DEFAULTS, ...MANUAL_DEFAULTS]) {
      expect(getMetric(key), `default key ${key}`).toBeDefined();
      expect(getMetricDefinition(key), `default key ${key} in catalog`).toBeDefined();
    }
  });

  it('formats values with registry decimals', () => {
    expect(getMetricDefinition('sleep_duration')!.formatValue(7.25)).toBe('7.3');
    expect(getMetricDefinition('resting_hr')!.formatValue(61.4)).toBe('61');
  });
});
