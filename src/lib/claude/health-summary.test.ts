import { describe, it, expect } from 'vitest';
import { buildHealthSnapshot, type HealthSummaryInput } from './health-summary';

// Fixed clock for deterministic aggregate windows/dates.
const NOW = new Date('2026-07-09T12:00:00Z');

const emptyInput: HealthSummaryInput = {
  medications: [],
  conditions: [],
  recentLabFlags: [],
  vitals: [],
  interactionAlerts: [],
};

describe('buildHealthSnapshot', () => {
  it('renders vitals as aggregate lines under the device-metrics section', () => {
    const input: HealthSummaryInput = {
      ...emptyInput,
      vitals: [
        { metric_key: 'deep_sleep', value: 104, unit: 'min', recorded_at: '2026-07-07T00:00:00Z' },
        { metric_key: 'deep_sleep', value: 84, unit: 'min', recorded_at: '2026-07-04T00:00:00Z' },
        {
          metric_key: 'resilience',
          value: 3,
          unit: '',
          recorded_at: '2026-07-07T00:00:00Z',
          metadata: { label: 'solid' },
        },
      ],
    };
    const snapshot = buildHealthSnapshot(input, NOW);
    expect(snapshot).toContain('Device & vital metrics (30-day aggregates):');
    expect(snapshot).toContain(
      '- Deep Sleep: 104 min (Jul 7) | 7d avg 94 | 30d avg 94 | trend flat',
    );
    // Ordinal metrics keep their label in the prompt.
    expect(snapshot).toContain('- Resilience: solid (3/5, Jul 7)');
    // The old latest-per-metric dump is gone.
    expect(snapshot).not.toContain('Latest vitals');
  });

  it('omits the vitals section when no row maps to a registry metric', () => {
    const input: HealthSummaryInput = {
      ...emptyInput,
      vitals: [
        { metric_key: 'not_a_metric', value: 1, unit: '', recorded_at: '2026-07-07T00:00:00Z' },
      ],
    };
    const snapshot = buildHealthSnapshot(input, NOW);
    expect(snapshot).not.toContain('Device & vital metrics');
  });

  it('keeps the non-vitals sections unchanged', () => {
    const input: HealthSummaryInput = {
      ...emptyInput,
      medications: [{ name: 'Lisinopril', dosage: '10mg', frequency: 'daily' }],
      conditions: [{ name: 'Hypertension' }],
      recentLabFlags: [
        {
          test_name: 'LDL',
          value: 160,
          unit: 'mg/dL',
          flag: 'high',
          reference_range_low: 0,
          reference_range_high: 100,
          visit_date: '2026-05-26',
        },
      ],
      interactionAlerts: [{ alert_text: 'A interacts with B', severity: 'moderate' }],
    };
    const snapshot = buildHealthSnapshot(input, NOW);
    expect(snapshot).toContain('Active medications (1): Lisinopril');
    expect(snapshot).toContain('Conditions: Hypertension');
    expect(snapshot).toContain('- LDL: 160 mg/dL (high, ref: 0-100) — drawn 2026-05-26');
    expect(snapshot).toContain('- [moderate] A interacts with B');
  });

  it('carries the lab draw date so findings can be date-framed (spec §AI #2)', () => {
    const input: HealthSummaryInput = {
      ...emptyInput,
      recentLabFlags: [
        {
          test_name: 'Vitamin D',
          value: 18,
          unit: 'ng/mL',
          flag: 'low',
          reference_range_low: null,
          reference_range_high: null,
          visit_date: '2026-02-10',
        },
      ],
    };
    const snapshot = buildHealthSnapshot(input, NOW);
    expect(snapshot).toContain('Flagged lab results (with draw dates — date-frame these):');
    expect(snapshot).toContain('drawn 2026-02-10');
  });

  it('adds goals and recent-training blocks when present (spec §AI #1)', () => {
    const input: HealthSummaryInput = {
      ...emptyInput,
      goals: [
        {
          kind: 'metric',
          metricKey: 'weight',
          direction: 'decrease',
          targetValue: 175,
          targetDate: '2026-12-31',
        },
        { kind: 'frequency', sessionType: 'strength', perWeek: 3 },
      ],
      recentWorkouts: [
        { type: 'strength', label: 'Upper A', startedAt: '2026-07-01T17:00:00Z' },
        { type: 'strength', label: 'Upper A', startedAt: '2026-07-08T17:00:00Z' },
      ],
    };
    const snapshot = buildHealthSnapshot(input, NOW);
    expect(snapshot).toContain('Active goals:');
    expect(snapshot).toContain('- Weight: decrease (target 175 lbs by 2026-12-31)');
    expect(snapshot).toContain('- strength sessions: 3x/week');
    expect(snapshot).toContain('Recent training (last 14 days, 2 sessions):');
    expect(snapshot).toContain('- strength: 2 (Upper A — Jul 1, Jul 8) | goal 3x/week');
  });

  it('reads like today when goals and workouts are absent or empty', () => {
    const withEmpty = buildHealthSnapshot({ ...emptyInput, goals: [], recentWorkouts: [] }, NOW);
    expect(withEmpty).toBe(buildHealthSnapshot(emptyInput, NOW));
    expect(withEmpty).not.toContain('Active goals');
    expect(withEmpty).not.toContain('Recent training');
  });

  it('states when no medications are recorded', () => {
    expect(buildHealthSnapshot(emptyInput, NOW)).toContain('No active medications recorded.');
  });
});
