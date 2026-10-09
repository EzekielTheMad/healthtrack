/**
 * Pure body-measurement view/report helpers — the sparse point-in-time model
 * behind the Vitals → Measurements view, the Fitness weekly summary and the
 * AI prompt block.
 */
import { describe, it, expect } from 'vitest';
import {
  MEASUREMENT_GAP_DAYS,
  MEASUREMENT_GROUPS,
  MEASUREMENT_PRESETS,
  buildLatestSession,
  buildMeasurementReport,
  buildMeasurementSeries,
  buildWeeklyMeasurementSummary,
  filterMeasurementRows,
  formatMeasurementsForPrompt,
  presetKeys,
  type MeasurementEntry,
} from './measurements';
import type { ViewVitalRow } from './vitals-view';

function row(
  metric_key: string,
  value: number,
  day: string,
  source = 'example_tape',
): ViewVitalRow {
  return {
    metric_key,
    value,
    unit: 'in',
    source,
    recorded_at: `${day}T00:00:00.000Z`,
    metadata: {},
  };
}

/** Flatten a latest-session view to `key → entry` for terse assertions. */
function entriesByKey(
  session: NonNullable<ReturnType<typeof buildLatestSession>>,
): Map<string, MeasurementEntry> {
  const out = new Map<string, MeasurementEntry>();
  for (const group of session.groups) {
    for (const r of group.rows) {
      for (const entry of [r.unsided, r.left, r.right]) {
        if (entry) out.set(entry.key, entry);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. No measurement data
// ---------------------------------------------------------------------------

describe('filterMeasurementRows', () => {
  it('keeps only registered body_measurement rows', () => {
    const rows = [row('waist', 38.1, '2026-09-01'), row('weight', 210, '2026-09-01')];
    expect(filterMeasurementRows(rows).map((r) => r.metric_key)).toEqual(['waist']);
  });

  it('drops keys the registry does not know', () => {
    expect(filterMeasurementRows([row('wingspan', 70, '2026-09-01')])).toEqual([]);
  });
});

describe('buildLatestSession', () => {
  it('returns null when there are no body measurements at all', () => {
    expect(buildLatestSession([])).toBeNull();
    expect(buildLatestSession([row('weight', 210, '2026-09-01')])).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. One baseline session
  // -------------------------------------------------------------------------

  it('labels a single session as the baseline and reports no change', () => {
    const session = buildLatestSession([
      row('waist', 38.1, '2026-09-01'),
      row('chest', 40.1, '2026-09-01'),
    ])!;

    expect(session.baseline).toBe(true);
    expect(session.asOf).toBe('2026-09-01T00:00:00.000Z');
    expect(session.sources).toEqual(['example_tape']);
    expect(session.count).toBe(2);
    expect(session.mixedDates).toBe(false);

    const entries = entriesByKey(session);
    expect(entries.get('waist')!.change).toBeNull();
    expect(entries.get('chest')!.change).toBeNull();
    expect(entries.get('waist')!.readings).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 3. Multiple sessions — per-metric previous value
  // -------------------------------------------------------------------------

  it('compares each metric against its own immediately previous reading', () => {
    const session = buildLatestSession([
      row('waist', 38.1, '2026-09-01'),
      row('waist', 38.6, '2026-08-01'),
      row('waist', 39.4, '2026-06-01'),
      row('chest', 40.1, '2026-09-01'),
      row('chest', 39.9, '2026-08-15'),
    ])!;

    expect(session.baseline).toBe(false);
    const entries = entriesByKey(session);

    const waist = entries.get('waist')!.change!;
    expect(waist.amount).toBeCloseTo(-0.5, 10);
    expect(waist.direction).toBe('down');
    expect(waist.display).toBe('0.5');
    expect(waist.previous.recordedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(entries.get('waist')!.readings).toBe(3);

    const chest = entries.get('chest')!.change!;
    expect(chest.amount).toBeCloseTo(0.2, 10);
    expect(chest.direction).toBe('up');
    expect(chest.previous.recordedAt).toBe('2026-08-15T00:00:00.000Z');
  });

  it('stays tone-neutral without an explicit goal for the metric', () => {
    const session = buildLatestSession([
      row('waist', 38.1, '2026-09-01'),
      row('waist', 38.6, '2026-08-01'),
    ])!;
    expect(entriesByKey(session).get('waist')!.change!.tone).toBe('neutral');
  });

  it('uses goal-aware toning only when an active goal supplies the direction', () => {
    const rows = [row('waist', 38.1, '2026-09-01'), row('waist', 38.6, '2026-08-01')];
    const session = buildLatestSession(rows, [
      { metricKey: 'waist', direction: 'decrease' },
    ])!;
    expect(entriesByKey(session).get('waist')!.change!.tone).toBe('good');
  });

  // -------------------------------------------------------------------------
  // 4 & 5. Partial sessions / metrics recorded on different dates
  // -------------------------------------------------------------------------

  it('shows the latest value per metric even when sessions are partial', () => {
    const session = buildLatestSession([
      row('waist', 38.1, '2026-09-01'),
      row('chest', 40.1, '2026-08-01'),
    ])!;

    expect(session.asOf).toBe('2026-09-01T00:00:00.000Z');
    expect(session.mixedDates).toBe(true);
    const entries = entriesByKey(session);
    expect(entries.get('chest')!.latest.recordedAt).toBe('2026-08-01T00:00:00.000Z');
    // The stale value keeps its own date rather than borrowing the header's.
    expect(entries.get('chest')!.stale).toBe(true);
    expect(entries.get('waist')!.stale).toBe(false);
  });

  it('lists every source contributing to the latest date', () => {
    const session = buildLatestSession([
      row('waist', 38.1, '2026-09-01', 'example_tape'),
      row('neck', 15.2, '2026-09-01', 'manual'),
    ])!;
    expect(session.sources).toEqual(['example_tape', 'manual']);
  });

  // -------------------------------------------------------------------------
  // 6. Missing values omitted, never zero
  // -------------------------------------------------------------------------

  it('omits unmeasured metrics instead of rendering them as zero', () => {
    const session = buildLatestSession([row('waist', 38.1, '2026-09-01')])!;
    const entries = entriesByKey(session);
    expect(entries.has('hips')).toBe(false);
    expect(entries.size).toBe(1);
    // Groups with nothing populated are dropped entirely.
    expect(session.groups.map((g) => g.id)).toEqual(['core']);
  });

  it('keeps a genuine zero-valued reading', () => {
    const session = buildLatestSession([row('waist', 0, '2026-09-01')])!;
    expect(entriesByKey(session).get('waist')!.latest.value).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 7 & 8. Bilateral independence
  // -------------------------------------------------------------------------

  it('keeps left and right as independent series in one bilateral row', () => {
    const session = buildLatestSession([
      row('left_bicep', 14.2, '2026-09-01'),
      row('right_bicep', 14.6, '2026-09-01'),
      row('left_bicep', 14.0, '2026-08-01'),
    ])!;

    const arms = session.groups.find((g) => g.id === 'arms')!;
    const bicep = arms.rows.find((r) => r.base === 'bicep')!;
    expect(bicep.left!.latest.value).toBe(14.2);
    expect(bicep.right!.latest.value).toBe(14.6);
    // Right has one reading only — baseline, not compared against left.
    expect(bicep.right!.change).toBeNull();
    expect(bicep.left!.change!.amount).toBeCloseTo(0.2, 10);
  });

  it('never synthesizes an unsided value from left and right', () => {
    const session = buildLatestSession([
      row('left_bicep', 14.2, '2026-09-01'),
      row('right_bicep', 14.6, '2026-09-01'),
    ])!;
    const bicep = session.groups
      .find((g) => g.id === 'arms')!
      .rows.find((r) => r.base === 'bicep')!;
    expect(bicep.unsided).toBeUndefined();
    expect(entriesByKey(session).has('bicep')).toBe(false);
  });

  it('carries an unsided reading alongside sided ones without merging them', () => {
    const session = buildLatestSession([
      row('bicep', 14.4, '2026-09-01'),
      row('left_bicep', 14.2, '2026-09-01'),
    ])!;
    const bicep = session.groups
      .find((g) => g.id === 'arms')!
      .rows.find((r) => r.base === 'bicep')!;
    expect(bicep.unsided!.latest.value).toBe(14.4);
    expect(bicep.left!.latest.value).toBe(14.2);
    expect(bicep.right).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 9 & 10. Display precision vs stored precision
  // -------------------------------------------------------------------------

  it('renders at registry precision without touching the stored value', () => {
    const stored = 96.8 / 2.54; // 38.11023622047244 — the unrounded cm→in write
    const session = buildLatestSession([row('waist', stored, '2026-09-01')])!;
    const waist = entriesByKey(session).get('waist')!;
    expect(waist.latest.value).toBe(stored);
    expect(waist.display).toBe('38.1');
  });

  it('reads a sub-display-step change as unchanged rather than +0.0', () => {
    const session = buildLatestSession([
      row('waist', 38.12, '2026-09-01'),
      row('waist', 38.1, '2026-08-01'),
    ])!;
    const change = entriesByKey(session).get('waist')!.change!;
    expect(change.direction).toBe('flat');
    expect(change.amount).toBeCloseTo(0.02, 10);
  });

  it('treats a change past the display half-step as a real move', () => {
    const session = buildLatestSession([
      row('waist', 38.16, '2026-09-01'),
      row('waist', 38.1, '2026-08-01'),
    ])!;
    expect(entriesByKey(session).get('waist')!.change!.direction).toBe('up');
  });

  it('orders groups and rows by the registry, not by input order', () => {
    const session = buildLatestSession([
      row('left_calf', 15.0, '2026-09-01'),
      row('chest', 40.1, '2026-09-01'),
      row('waist', 38.1, '2026-09-01'),
      row('bicep', 14.4, '2026-09-01'),
    ])!;
    expect(session.groups.map((g) => g.id)).toEqual(['core', 'arms', 'legs']);
    // Registry declares waist before chest.
    expect(session.groups[0].rows.map((r) => r.base)).toEqual(['waist', 'chest']);
  });
});

// ---------------------------------------------------------------------------
// 11 & 12. Deterministic report + range filtering
// ---------------------------------------------------------------------------

describe('buildMeasurementReport', () => {
  it('reports first, latest, change and sample count per metric', () => {
    const report = buildMeasurementReport([
      row('waist', 39.4, '2026-06-01'),
      row('waist', 38.6, '2026-08-01'),
      row('waist', 38.1, '2026-09-01'),
    ]);

    expect(report).toHaveLength(1);
    const waist = report[0];
    expect(waist.key).toBe('waist');
    expect(waist.first.value).toBe(39.4);
    expect(waist.first.recordedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(waist.latest.value).toBe(38.1);
    expect(waist.latest.recordedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(waist.readings).toBe(3);
    expect(waist.change!.amount).toBeCloseTo(-1.3, 10);
    expect(waist.change!.display).toBe('1.3');
  });

  it('reports a single in-range reading as baseline only', () => {
    const report = buildMeasurementReport([row('waist', 38.1, '2026-09-01')]);
    expect(report[0].readings).toBe(1);
    expect(report[0].change).toBeNull();
    expect(report[0].first.recordedAt).toBe(report[0].latest.recordedAt);
  });

  it('keeps left and right as separate report rows', () => {
    const report = buildMeasurementReport([
      row('left_bicep', 14.2, '2026-09-01'),
      row('right_bicep', 14.6, '2026-09-01'),
    ]);
    expect(report.map((r) => r.key)).toEqual(['left_bicep', 'right_bicep']);
  });

  it('renders a sub-display-step range change as unchanged', () => {
    const report = buildMeasurementReport([
      row('waist', 38.1, '2026-06-01'),
      row('waist', 38.12, '2026-09-01'),
    ]);
    expect(report[0].change!.direction).toBe('flat');
  });

  it('follows registry order', () => {
    const report = buildMeasurementReport([
      row('chest', 40.1, '2026-09-01'),
      row('waist', 38.1, '2026-09-01'),
    ]);
    expect(report.map((r) => r.key)).toEqual(['waist', 'chest']);
  });
});

describe('filterMeasurementRows range bounds', () => {
  const rows = [
    row('waist', 39.4, '2026-01-15'),
    row('waist', 38.6, '2026-06-15'),
    row('waist', 38.1, '2026-09-01'),
  ];

  it('keeps readings inside an inclusive range', () => {
    const kept = filterMeasurementRows(rows, {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
    });
    expect(kept.map((r) => r.value)).toEqual([38.6, 38.1]);
  });

  it('is unbounded when no range is supplied', () => {
    expect(filterMeasurementRows(rows)).toHaveLength(3);
  });

  it('reports nothing when the range excludes every reading', () => {
    const kept = filterMeasurementRows(rows, {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
    });
    expect(kept).toEqual([]);
    expect(buildMeasurementReport(kept)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chart series
// ---------------------------------------------------------------------------

describe('buildMeasurementSeries', () => {
  it('builds one chronological series per requested key', () => {
    const series = buildMeasurementSeries(
      [
        row('waist', 38.1, '2026-09-01'),
        row('waist', 38.6, '2026-08-01'),
        row('left_bicep', 14.2, '2026-09-01'),
      ],
      ['waist', 'left_bicep'],
    );

    expect(series.map((s) => s.key)).toEqual(['waist', 'left_bicep']);
    expect(series[0].points.map((p) => p.value)).toEqual([38.6, 38.1]);
    expect(series[0].points[0].source).toBe('example_tape');
    expect(series[0].label).toBe('Waist');
    expect(series[0].unit).toBe('in');
  });

  it('omits series with no readings rather than plotting an empty line', () => {
    const series = buildMeasurementSeries(
      [row('waist', 38.1, '2026-09-01')],
      ['waist', 'hips'],
    );
    expect(series.map((s) => s.key)).toEqual(['waist']);
  });

  it('renders a single reading as one point', () => {
    const series = buildMeasurementSeries([row('waist', 38.1, '2026-09-01')], ['waist']);
    expect(series[0].points).toHaveLength(1);
    expect(series[0].points[0].value).toBe(38.1);
  });

  it('breaks the line across a gap long enough to be misleading', () => {
    const series = buildMeasurementSeries(
      [row('waist', 39.4, '2026-01-01'), row('waist', 38.1, '2026-09-01')],
      ['waist'],
    );
    // Jan 1 → Sep 1 is well beyond MEASUREMENT_GAP_DAYS, so a null break sits
    // between the two readings and no segment is drawn across it.
    expect(MEASUREMENT_GAP_DAYS).toBeLessThan(243);
    expect(series[0].points.map((p) => p.value)).toEqual([39.4, null, 38.1]);
  });

  it('connects readings inside the gap threshold', () => {
    const series = buildMeasurementSeries(
      [row('waist', 38.6, '2026-08-01'), row('waist', 38.1, '2026-09-01')],
      ['waist'],
    );
    expect(series[0].points.map((p) => p.value)).toEqual([38.6, 38.1]);
  });

  it('assigns each series a distinct color', () => {
    const series = buildMeasurementSeries(
      [
        row('waist', 38.1, '2026-09-01'),
        row('chest', 40.1, '2026-09-01'),
        row('hips', 37.6, '2026-09-01'),
      ],
      ['waist', 'chest', 'hips'],
    );
    expect(new Set(series.map((s) => s.color)).size).toBe(3);
  });
});

describe('presets and groups', () => {
  it('exposes Core, Upper body, Arms and Legs presets', () => {
    expect(MEASUREMENT_PRESETS.map((p) => p.id)).toEqual([
      'core',
      'upper',
      'arms',
      'legs',
    ]);
  });

  it('presets only select registered measurement keys', () => {
    for (const preset of MEASUREMENT_PRESETS) {
      expect(preset.keys.length).toBeGreaterThan(0);
      expect(presetKeys(preset.id)).toEqual(preset.keys);
    }
  });

  it('every registered measurement belongs to exactly one display group', () => {
    const grouped = MEASUREMENT_GROUPS.flatMap((g) => g.keys);
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

// ---------------------------------------------------------------------------
// 14 & 15. Fitness → Weekly compact summary
// ---------------------------------------------------------------------------

describe('buildWeeklyMeasurementSummary', () => {
  const wire = (value: number, day: string) => ({
    value,
    recorded_at: `${day}T00:00:00.000Z`,
    source: 'example_tape',
    unit: 'in',
  });

  it('returns null with no measurements', () => {
    expect(buildWeeklyMeasurementSummary({})).toBeNull();
  });

  it('summarizes a single measurement with no overflow count', () => {
    const summary = buildWeeklyMeasurementSummary({ waist: wire(38.1, '2026-09-01') })!;
    expect(summary.items.map((i) => i.label)).toEqual(['Waist']);
    expect(summary.items[0].display).toBe('38.1');
    expect(summary.moreCount).toBe(0);
    expect(summary.total).toBe(1);
    expect(summary.asOf).toBe('2026-09-01T00:00:00.000Z');
  });

  it('shows exactly three measurements with no overflow count', () => {
    const summary = buildWeeklyMeasurementSummary({
      waist: wire(38.1, '2026-09-01'),
      chest: wire(40.1, '2026-09-01'),
      hips: wire(37.6, '2026-09-01'),
    })!;
    expect(summary.items).toHaveLength(3);
    expect(summary.moreCount).toBe(0);
  });

  it('caps at three in registry order and counts the rest', () => {
    const summary = buildWeeklyMeasurementSummary({
      left_calf: wire(15.0, '2026-09-01'),
      waist: wire(38.1, '2026-09-01'),
      abdomen: wire(39.0, '2026-09-01'),
      hips: wire(37.6, '2026-09-01'),
      chest: wire(40.1, '2026-09-01'),
      neck: wire(15.2, '2026-09-01'),
    })!;
    // Registry order: waist, abdomen, hips, neck, shoulder, chest, …
    expect(summary.items.map((i) => i.label)).toEqual(['Waist', 'Abdomen', 'Hips']);
    expect(summary.moreCount).toBe(3);
    expect(summary.total).toBe(6);
  });

  it('marks readings older than the newest one as stale and dates them', () => {
    const summary = buildWeeklyMeasurementSummary({
      waist: wire(38.1, '2026-09-01'),
      chest: wire(40.1, '2026-07-04'),
    })!;
    expect(summary.asOf).toBe('2026-09-01T00:00:00.000Z');
    const chest = summary.items.find((i) => i.label === 'Chest')!;
    expect(chest.stale).toBe(true);
    expect(chest.recordedAt).toBe('2026-07-04T00:00:00.000Z');
    expect(summary.items.find((i) => i.label === 'Waist')!.stale).toBe(false);
  });

  it('renders values at registry precision', () => {
    const summary = buildWeeklyMeasurementSummary({
      waist: wire(96.8 / 2.54, '2026-09-01'),
    })!;
    expect(summary.items[0].display).toBe('38.1');
  });
});

// ---------------------------------------------------------------------------
// 16. AI prompt formatting
// ---------------------------------------------------------------------------

describe('formatMeasurementsForPrompt', () => {
  it('is empty when there are no measurements', () => {
    expect(formatMeasurementsForPrompt([])).toBe('');
    expect(formatMeasurementsForPrompt([row('weight', 210, '2026-09-01')])).toBe('');
  });

  it('frames readings as sparse point-in-time values, not averages', () => {
    const block = formatMeasurementsForPrompt([
      row('waist', 38.1, '2026-09-01'),
      row('waist', 38.6, '2026-08-01'),
    ]);
    expect(block).toContain('point-in-time');
    // None of the daily-vital aggregate vocabulary formatAggregatesForPrompt
    // emits — these readings have no 7d/30d window to average over.
    expect(block).not.toMatch(/\d+d avg|avg \d|trend (up|down|flat)/);
    expect(block).toContain('- Waist: 38.1 in (Sep 1, 2026)');
    expect(block).toContain('previous 38.6 in (Aug 1, 2026)');
    expect(block).toContain('change -0.5 in');
    expect(block).toContain('2 readings');
  });

  it('labels a lone reading as a baseline', () => {
    const block = formatMeasurementsForPrompt([row('waist', 38.1, '2026-09-01')]);
    expect(block).toContain('baseline');
    expect(block).toContain('1 reading');
  });

  it('tells the model not to judge direction or bilateral differences', () => {
    const block = formatMeasurementsForPrompt([
      row('left_bicep', 14.2, '2026-09-01'),
      row('right_bicep', 14.6, '2026-09-01'),
    ]);
    expect(block).toMatch(/improvement|regression/i);
    expect(block).toMatch(/independent series/i);
    expect(block).toMatch(/date-frame/i);
    expect(block).toContain('- Left Bicep');
    expect(block).toContain('- Right Bicep');
  });
});
