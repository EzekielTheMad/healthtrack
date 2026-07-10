/**
 * Pure view logic for the vitals page: daily-view grouping + deltas vs the
 * trailing 7-day average, and weekly bar bucketing for long ranges.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDailySections,
  defaultDayKey,
  bucketWeekly,
  shouldBucketWeekly,
  WEEKLY_BUCKET_THRESHOLD_DAYS,
  type ViewVitalRow,
} from './vitals-view';

function row(
  metric_key: string,
  value: number,
  recorded_at: string,
  extra: Partial<ViewVitalRow> = {},
): ViewVitalRow {
  return {
    metric_key,
    value,
    unit: null,
    source: 'manual',
    recorded_at,
    metadata: {},
    ...extra,
  };
}

/** Day-normalized recorded_at for day key (non-intraday row convention). */
function day(key: string): string {
  return `${key}T00:00:00Z`;
}

describe('defaultDayKey', () => {
  it('returns the most recent day with any data', () => {
    const rows = [
      row('sleep_score', 80, day('2026-07-06')),
      row('sleep_score', 82, day('2026-07-08')),
      row('weight', 210, day('2026-07-07')),
    ];
    expect(defaultDayKey(rows)).toBe('2026-07-08');
  });

  it('returns null for empty input', () => {
    expect(defaultDayKey([])).toBeNull();
  });
});

describe('buildDailySections', () => {
  it('includes only metrics with data on the selected day, grouped by category in order', () => {
    const rows = [
      row('sleep_score', 82, day('2026-07-08')),
      row('resting_hr', 58, day('2026-07-08')),
      row('weight', 210, day('2026-07-07')), // different day — excluded
    ];
    const sections = buildDailySections(rows, '2026-07-08');
    expect(sections.map((s) => s.category)).toEqual(['sleep', 'cardiovascular']);
    expect(sections[0].entries.map((e) => e.key)).toEqual(['sleep_score']);
    expect(sections[1].entries.map((e) => e.key)).toEqual(['resting_hr']);
  });

  it('orders entries within a category by registry declaration order', () => {
    const rows = [
      row('sleep_duration', 7.5, day('2026-07-08')),
      row('sleep_score', 82, day('2026-07-08')),
    ];
    const [sleep] = buildDailySections(rows, '2026-07-08');
    expect(sleep.entries.map((e) => e.key)).toEqual(['sleep_score', 'sleep_duration']);
  });

  it('computes delta vs the mean of the prior 7 days for mean metrics', () => {
    const rows = [
      row('resting_hr', 60, day('2026-07-08')),
      row('resting_hr', 55, day('2026-07-07')),
      row('resting_hr', 57, day('2026-07-05')),
      row('resting_hr', 53, day('2026-07-01')), // still inside the 7-day window
      row('resting_hr', 99, day('2026-06-30')), // outside — ignored
    ];
    const [{ entries: [hr] }] = buildDailySections(rows, '2026-07-08');
    expect(hr.dayValue).toBe(60);
    // baseline = (55 + 57 + 53) / 3 = 55
    expect(hr.delta).not.toBeNull();
    expect(hr.delta!.amount).toBeCloseTo(5);
    expect(hr.delta!.direction).toBe('up');
    expect(hr.delta!.display).toBe('5');
  });

  it("compares sum metrics against the 7-day daily average (total / 7)", () => {
    const rows = [
      row('steps', 10000, day('2026-07-08')),
      row('steps', 7000, day('2026-07-07')),
      row('steps', 7000, day('2026-07-06')),
      // 4 days without data still count in the /7 denominator
    ];
    const [{ entries: [steps] }] = buildDailySections(rows, '2026-07-08');
    expect(steps.dayValue).toBe(10000);
    // baseline = 14000 / 7 = 2000 → delta +8000
    expect(steps.delta!.amount).toBeCloseTo(8000);
    expect(steps.delta!.direction).toBe('up');
  });

  it('sums multiple same-day readings for sum metrics', () => {
    const rows = [
      row('steps', 4000, day('2026-07-08')),
      row('steps', 6000, day('2026-07-08')),
      row('steps', 7000, day('2026-07-05')),
    ];
    const [{ entries: [steps] }] = buildDailySections(rows, '2026-07-08');
    expect(steps.dayValue).toBe(10000);
  });

  it('returns a null delta when the prior 7 days have no data', () => {
    const rows = [row('resting_hr', 60, day('2026-07-08'))];
    const [{ entries: [hr] }] = buildDailySections(rows, '2026-07-08');
    expect(hr.delta).toBeNull();
  });

  it('marks deltas that round to zero at display precision as flat', () => {
    const rows = [
      row('resting_hr', 60, day('2026-07-08')),
      row('resting_hr', 60.2, day('2026-07-07')), // decimals: 0 → |Δ|=0.2 rounds to 0
    ];
    const [{ entries: [hr] }] = buildDailySections(rows, '2026-07-08');
    expect(hr.delta!.direction).toBe('flat');
  });

  it('shows ordinal values as label text with a 1-decimal numeric delta', () => {
    const rows = [
      row('mood', 4, day('2026-07-08')),
      row('mood', 3, day('2026-07-07')),
      row('mood', 2, day('2026-07-06')),
    ];
    const sections = buildDailySections(rows, '2026-07-08');
    const mood = sections.find((s) => s.category === 'subjective')!.entries[0];
    expect(mood.readings[0].display).toBe('good');
    // baseline = (3 + 2) / 2 = 2.5 → delta 1.5
    expect(mood.delta!.amount).toBeCloseTo(1.5);
    expect(mood.delta!.display).toBe('1.5');
  });

  it('prefers metadata.label for ordinal readings when present', () => {
    const rows = [
      row('mood', 4, day('2026-07-08'), { metadata: { label: 'pretty good' } }),
    ];
    const sections = buildDailySections(rows, '2026-07-08');
    expect(sections[0].entries[0].readings[0].display).toBe('pretty good');
  });

  it('lists each intraday reading chronologically, keyed by LOCAL day', () => {
    // Build timestamps that land on local 2026-07-08 regardless of runner TZ.
    const local = (h: number) => {
      const d = new Date(2026, 6, 8, h, 30, 0); // local Jul 8
      return d.toISOString();
    };
    const rows = [
      row('blood_glucose', 140, local(18)),
      row('blood_glucose', 95, local(7)),
    ];
    const [{ entries: [bg] }] = buildDailySections(rows, '2026-07-08');
    expect(bg.intraday).toBe(true);
    expect(bg.readings.map((r) => r.value)).toEqual([95, 140]); // chronological
    expect(bg.dayValue).toBeCloseTo(117.5); // mean aggregate
  });

  it('collapses multiple same-day readings of a mean metric into one row showing the day mean', () => {
    const rows = [
      row('resting_hr', 58, day('2026-07-08')),
      row('resting_hr', 62, day('2026-07-08')),
    ];
    const [{ entries: [hr] }] = buildDailySections(rows, '2026-07-08');
    expect(hr.readings).toHaveLength(1);
    expect(hr.dayValue).toBe(60);
    expect(hr.readings[0].display).toBe('60');
  });

  it('formats numeric displays at registry decimals', () => {
    const rows = [row('sleep_duration', 7.25, day('2026-07-08'))];
    const [{ entries: [dur] }] = buildDailySections(rows, '2026-07-08');
    expect(dur.readings[0].display).toBe('7.3'); // decimals: 1
  });

  it('tones deltas by the registry goalDirection', () => {
    const build = (key: string, today: number, prior: number) => {
      const sections = buildDailySections(
        [row(key, today, day('2026-07-08')), row(key, prior, day('2026-07-07'))],
        '2026-07-08',
      );
      return sections.flatMap((s) => s.entries).find((e) => e.key === key)!.delta!;
    };
    // Lower-is-better: a drop reads positive, a rise negative.
    expect(build('resting_hr', 55, 60)).toMatchObject({ direction: 'down', tone: 'good' });
    expect(build('resting_hr', 65, 60)).toMatchObject({ direction: 'up', tone: 'bad' });
    // Higher-is-better: a drop reads negative (sum baseline is total / 7).
    expect(build('steps', 1000, 21000)).toMatchObject({ direction: 'down', tone: 'bad' });
    // Neutral metrics carry no judgement either way.
    expect(build('body_temp', 98.9, 97.8)).toMatchObject({ direction: 'up', tone: 'neutral' });
    // Flat deltas stay neutral regardless of direction.
    expect(build('resting_hr', 60, 60)).toMatchObject({ direction: 'flat', tone: 'neutral' });
  });

  it('renders minute-based sleep metrics as h/m durations', () => {
    const rows = [row('deep_sleep', 462, day('2026-07-08'))];
    const [{ entries: [deep] }] = buildDailySections(rows, '2026-07-08');
    expect(deep.duration).toBe(true);
    expect(deep.readings[0].display).toBe('7h 42m');
  });
});

describe('shouldBucketWeekly', () => {
  it('is false at or below the threshold and true above it', () => {
    const from = new Date('2026-05-01T00:00:00Z');
    const at = new Date(from.getTime() + WEEKLY_BUCKET_THRESHOLD_DAYS * 86400_000);
    const over = new Date(at.getTime() + 86400_000);
    expect(shouldBucketWeekly(from, at)).toBe(false);
    expect(shouldBucketWeekly(from, over)).toBe(true);
  });
});

describe('bucketWeekly', () => {
  it('groups points into Monday-start UTC weeks, averaging mean metrics', () => {
    const points = [
      { value: 80, date: '2026-07-06T00:00:00Z' }, // Mon
      { value: 90, date: '2026-07-08T00:00:00Z' }, // Wed, same week
      { value: 70, date: '2026-07-13T00:00:00Z' }, // next Mon
    ];
    const out = bucketWeekly(points, 'mean', 0);
    expect(out).toEqual([
      { value: 85, date: '2026-07-06T00:00:00.000Z', days: 2 },
      { value: 70, date: '2026-07-13T00:00:00.000Z', days: 1 },
    ]);
  });

  it('assigns a Sunday to the week starting the previous Monday', () => {
    const points = [
      { value: 10, date: '2026-07-12T00:00:00Z' }, // Sun → week of Jul 6
      { value: 20, date: '2026-07-06T00:00:00Z' }, // Mon
    ];
    const out = bucketWeekly(points, 'mean', 0);
    expect(out).toEqual([{ value: 15, date: '2026-07-06T00:00:00.000Z', days: 2 }]);
  });

  it('sums sum metrics within each week', () => {
    const points = [
      { value: 8000, date: '2026-07-06T00:00:00Z' },
      { value: 12000, date: '2026-07-07T00:00:00Z' },
    ];
    const out = bucketWeekly(points, 'sum', 0);
    expect(out).toEqual([{ value: 20000, date: '2026-07-06T00:00:00.000Z', days: 2 }]);
  });

  it('averages latest-aggregate metrics like mean metrics', () => {
    const points = [
      { value: 210, date: '2026-07-06T00:00:00Z' },
      { value: 212, date: '2026-07-07T00:00:00Z' },
    ];
    const out = bucketWeekly(points, 'latest', 1);
    expect(out).toEqual([{ value: 211, date: '2026-07-06T00:00:00.000Z', days: 2 }]);
  });

  it('reports how many days of data each bucket aggregates (partial edge weeks stay honest)', () => {
    const points = [
      // Partial edge week: only Thu–Sun of the week of Jun 29 are in range.
      { value: 1000, date: '2026-07-02T00:00:00Z' },
      { value: 1000, date: '2026-07-03T00:00:00Z' },
      { value: 1000, date: '2026-07-04T00:00:00Z' },
      { value: 1000, date: '2026-07-05T00:00:00Z' },
      // Full week of Jul 6 (two same-day readings count as one day).
      { value: 500, date: '2026-07-06T00:00:00Z' },
      { value: 500, date: '2026-07-06T00:00:00Z' },
      { value: 1000, date: '2026-07-07T00:00:00Z' },
    ];
    const out = bucketWeekly(points, 'sum', 0);
    expect(out.map((p) => p.days)).toEqual([4, 2]);
  });

  it('rounds bucket values to the given decimals and sorts weeks ascending', () => {
    const points = [
      { value: 3, date: '2026-07-14T00:00:00Z' },
      { value: 1, date: '2026-07-06T00:00:00Z' },
      { value: 2, date: '2026-07-07T00:00:00Z' },
    ];
    const out = bucketWeekly(points, 'mean', 0);
    expect(out.map((p) => p.date)).toEqual([
      '2026-07-06T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
    ]);
    expect(out.map((p) => p.value)).toEqual([2, 3]); // 1.5 → 2 at 0 decimals
  });
});
