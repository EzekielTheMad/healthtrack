// @vitest-environment node
/**
 * GET /api/v1/metrics — public machine-readable metric registry.
 * Generated from METRICS so it can never drift; this pins the wire shape.
 */
import { describe, it, expect } from 'vitest';
import { GET, OPTIONS } from './route';
import { METRICS, getMetric } from '@/lib/metrics/registry';

describe('GET /api/v1/metrics', () => {
  it('returns every registry metric without requiring auth', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows).toHaveLength(METRICS.length);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('uses snake_case field names and carries ordinal/bounds/intraday info', async () => {
    const rows = (await (await GET()).json()) as Record<string, unknown>[];

    const steps = rows.find((r) => r.key === 'steps')!;
    expect(steps).toMatchObject({
      key: 'steps',
      label: 'Steps',
      category: 'activity',
      unit: 'steps',
      value_type: 'number',
      aggregate: 'sum',
    });
    expect(steps).not.toHaveProperty('valueType');
    expect(steps).not.toHaveProperty('ordinal_labels');

    const resilience = rows.find((r) => r.key === 'resilience')!;
    expect(resilience.value_type).toBe('ordinal');
    expect(resilience.ordinal_labels).toEqual([...getMetric('resilience')!.ordinalLabels!]);

    const pain = rows.find((r) => r.key === 'pain_level')!;
    expect(pain).toMatchObject({ min: 0, max: 10 });

    const glucose = rows.find((r) => r.key === 'blood_glucose')!;
    expect(glucose.intraday).toBe(true);

    // Presentation-only registry fields stay out of the wire schema.
    expect(steps).not.toHaveProperty('chart');
    expect(steps).not.toHaveProperty('decimals');
    expect(steps).not.toHaveProperty('dashboardEligible');
  });

  it('answers CORS preflight with GET, OPTIONS', async () => {
    const res = await OPTIONS();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });
});
