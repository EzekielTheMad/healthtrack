// ---------------------------------------------------------------------------
// Body-measurement view + report logic (pure).
//
// Circumferences are NOT daily vitals. They are sparse point-in-time readings
// taken whenever someone runs a tape or a scan, so every helper here follows
// the same rules:
//
//   - The registry's `body_measurement` category is the source of truth for
//     which metrics exist, what they are called, their canonical unit and
//     their display precision. Nothing is hard-coded twice.
//   - Unsided, `left_*` and `right_*` keys are INDEPENDENT series. Nothing in
//     this module copies, averages or synthesizes one from another.
//   - A missing reading is unknown, never zero — absent metrics are omitted.
//   - One reading is a baseline, not a trend.
//   - Changes are reported neutrally. Direction is only toned when the caller
//     supplies an active goal for that metric (goal-direction.ts); the
//     registry deliberately gives circumferences no `goalDirection`.
//   - Stored values are never mutated. Registry decimals apply to the
//     `display` strings only.
//
// The grouping and preset lists below are PRESENTATION ONLY. They never reach
// persistence or an API contract.
// ---------------------------------------------------------------------------

import { formatUtcDayYear } from '../dates';
import {
  deltaTone,
  resolveGoalDirection,
  type ActiveMetricGoal,
} from '../fitness/goal-direction';
import { formatMetricValue } from './format';
import { BODY_MEASUREMENT_KEYS, getMetric } from './registry';
import type { ViewVitalRow } from './vitals-view';

/** Registry order for body measurements — the ordering every list here uses. */
const MEASUREMENT_INDEX: ReadonlyMap<string, number> = new Map(
  BODY_MEASUREMENT_KEYS.map((key, i) => [key, i]),
);

/** Fallback display precision for a measurement whose registry entry is gone. */
const DEFAULT_DECIMALS = 1;

function decimalsOf(key: string): number {
  return getMetric(key)?.decimals ?? DEFAULT_DECIMALS;
}

function labelOf(key: string): string {
  return getMetric(key)?.label ?? key;
}

function unitOf(key: string, fallback: string | null = null): string | null {
  return getMetric(key)?.unit ?? fallback;
}

/**
 * The "reads as no change" band: half of the metric's displayed unit step.
 * A move smaller than this would render as `+0.0`, which overstates the
 * precision of a tape measure, so it is reported as unchanged instead.
 */
export function flatBandFor(key: string): number {
  return 0.5 * 10 ** -decimalsOf(key);
}

// ---------------------------------------------------------------------------
// Presentation groups + chart presets
// ---------------------------------------------------------------------------

export type MeasurementGroupId = 'core' | 'arms' | 'legs' | 'other';

interface MeasurementGroupDef {
  id: MeasurementGroupId;
  label: string;
  keys: readonly string[];
}

/** A bilateral family: the unsided key plus its `left_`/`right_` variants. */
function sidedKeys(base: string): string[] {
  return [base, `left_${base}`, `right_${base}`];
}

const CORE_KEYS = ['neck', 'shoulder', 'chest', 'waist', 'abdomen', 'hips'] as const;
const ARM_KEYS = [...sidedKeys('bicep'), ...sidedKeys('forearm')];
const LEG_KEYS = [...sidedKeys('thigh'), ...sidedKeys('calf')];

/** Registry-order filter — keeps a group honest if a key is ever removed. */
function registered(keys: readonly string[]): string[] {
  return keys
    .filter((k) => MEASUREMENT_INDEX.has(k))
    .sort((a, b) => MEASUREMENT_INDEX.get(a)! - MEASUREMENT_INDEX.get(b)!);
}

const NAMED_GROUPS: MeasurementGroupDef[] = [
  { id: 'core', label: 'Core', keys: registered(CORE_KEYS) },
  { id: 'arms', label: 'Arms', keys: registered(ARM_KEYS) },
  { id: 'legs', label: 'Legs', keys: registered(LEG_KEYS) },
];

/**
 * Compact display groups for the Measurements view. Any registered
 * measurement the named groups do not claim lands in a trailing "Other"
 * group, so registering a new circumference can never make it invisible.
 */
export const MEASUREMENT_GROUPS: readonly MeasurementGroupDef[] = (() => {
  const claimed = new Set(NAMED_GROUPS.flatMap((g) => g.keys));
  const rest = BODY_MEASUREMENT_KEYS.filter((k) => !claimed.has(k));
  return rest.length > 0
    ? [...NAMED_GROUPS, { id: 'other' as const, label: 'Other', keys: rest }]
    : NAMED_GROUPS;
})();

export type MeasurementPresetId = 'core' | 'upper' | 'arms' | 'legs';

interface MeasurementPresetDef {
  id: MeasurementPresetId;
  label: string;
  keys: readonly string[];
}

/**
 * Chart presets. These SELECT series and nothing else — no preset derives,
 * combines or averages measurements, and left/right stay separate lines.
 */
export const MEASUREMENT_PRESETS: readonly MeasurementPresetDef[] = [
  { id: 'core', label: 'Core', keys: registered(CORE_KEYS) },
  {
    id: 'upper',
    label: 'Upper body',
    keys: registered([...CORE_KEYS, ...ARM_KEYS]),
  },
  { id: 'arms', label: 'Arms', keys: registered(ARM_KEYS) },
  { id: 'legs', label: 'Legs', keys: registered(LEG_KEYS) },
];

/** Registered keys a preset selects; empty for an unknown id. */
export function presetKeys(id: string): readonly string[] {
  return MEASUREMENT_PRESETS.find((p) => p.id === id)?.keys ?? [];
}

// ---------------------------------------------------------------------------
// Row filtering
// ---------------------------------------------------------------------------

export interface MeasurementRange {
  /** Inclusive ISO lower bound. */
  from: string;
  /** Inclusive ISO upper bound. */
  to: string;
}

/**
 * Registered body-measurement rows only, oldest first, optionally clipped to
 * an inclusive ISO range. Unknown metric keys are dropped (closed registry).
 */
export function filterMeasurementRows(
  rows: readonly ViewVitalRow[],
  range?: MeasurementRange,
): ViewVitalRow[] {
  return rows
    .filter((r) => {
      if (!MEASUREMENT_INDEX.has(r.metric_key)) return false;
      if (!range) return true;
      return r.recorded_at >= range.from && r.recorded_at <= range.to;
    })
    .sort(
      (a, b) =>
        a.recorded_at.localeCompare(b.recorded_at) ||
        a.source.localeCompare(b.source),
    );
}

/**
 * One reading per (metric, timestamp), chronological, per metric key. Two
 * sources writing the same metric on the same day are the same point in time,
 * so the later-sorting source wins rather than counting as a prior reading.
 */
function seriesByMetric(rows: readonly ViewVitalRow[]): Map<string, ViewVitalRow[]> {
  const out = new Map<string, ViewVitalRow[]>();
  for (const row of filterMeasurementRows(rows)) {
    const list = out.get(row.metric_key);
    if (!list) {
      out.set(row.metric_key, [row]);
      continue;
    }
    const last = list[list.length - 1];
    if (last.recorded_at === row.recorded_at) list[list.length - 1] = row;
    else list.push(row);
  }
  return out;
}

/** Registry-order iteration over metrics that actually have readings. */
function orderedKeys(series: Map<string, ViewVitalRow[]>): string[] {
  return [...series.keys()].sort(
    (a, b) => MEASUREMENT_INDEX.get(a)! - MEASUREMENT_INDEX.get(b)!,
  );
}

// ---------------------------------------------------------------------------
// Latest session + change since previous reading
// ---------------------------------------------------------------------------

export interface MeasurementReading {
  /** Stored value at full precision — never rounded here. */
  value: number;
  recordedAt: string;
  source: string;
}

export interface MeasurementChange {
  /** latest − previous, in canonical units, unrounded. */
  amount: number;
  /** |amount| at the metric's display precision. */
  display: string;
  /** `flat` when |amount| is under the display half-step (see flatBandFor). */
  direction: 'up' | 'down' | 'flat';
  /**
   * Neutral unless an ACTIVE GOAL supplies a direction for this metric.
   * Circumferences carry no registry `goalDirection` on purpose: growing or
   * shrinking is neither good nor bad without the user saying which they want.
   */
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  previous: MeasurementReading;
}

export interface MeasurementEntry {
  key: string;
  label: string;
  unit: string | null;
  decimals: number;
  latest: MeasurementReading;
  /** Latest value at display precision. */
  display: string;
  /** null when this metric has only ever been read once — a baseline. */
  change: MeasurementChange | null;
  /** Total readings for this metric in the input window. */
  readings: number;
  /** True when the latest reading predates the newest measurement overall. */
  stale: boolean;
}

/** One bilateral (or unsided) family rendered as a single row. */
export interface MeasurementSlotRow {
  /** Unsided registry key of the family — `waist`, `bicep`, … */
  base: string;
  label: string;
  unsided?: MeasurementEntry;
  left?: MeasurementEntry;
  right?: MeasurementEntry;
}

export interface MeasurementGroupView {
  id: MeasurementGroupId;
  label: string;
  rows: MeasurementSlotRow[];
}

export interface LatestSessionView {
  /** Newest `recorded_at` across every populated measurement. */
  asOf: string;
  /** Distinct sources that contributed a reading dated `asOf`, sorted. */
  sources: string[];
  /** True when no metric has more than one reading — nothing to compare yet. */
  baseline: boolean;
  /** True when some latest values are older than `asOf` (partial sessions). */
  mixedDates: boolean;
  groups: MeasurementGroupView[];
  /** Populated metric count. */
  count: number;
}

function buildChange(
  key: string,
  latest: ViewVitalRow,
  previous: ViewVitalRow | undefined,
  goals: readonly ActiveMetricGoal[],
): MeasurementChange | null {
  if (!previous) return null;
  const amount = latest.value - previous.value;
  const band = flatBandFor(key);
  const flat = Math.abs(amount) < band;
  const direction = resolveGoalDirection(key, getMetric(key)?.goalDirection, goals);
  const raw = deltaTone(amount, direction, band);
  return {
    amount,
    display: formatMetricValue(Math.abs(amount), decimalsOf(key)),
    direction: flat ? 'flat' : amount > 0 ? 'up' : 'down',
    // Drifting off a `maintain` goal is a caution, not a failure — same
    // mapping the daily vitals deltas use.
    tone: raw === 'bad' && direction === 'maintain' ? 'warn' : raw,
    previous: {
      value: previous.value,
      recordedAt: previous.recorded_at,
      source: previous.source,
    },
  };
}

/**
 * One entry per populated metric, in registry order: latest reading, change
 * against that metric's own immediately previous reading, and total readings.
 *
 * The single source of latest-vs-previous truth — the Measurements view and
 * the AI prompt block both render from this rather than each redoing the
 * comparison. `stale` is left false here; only a caller that knows the newest
 * date across the whole set (buildLatestSession) can fill it in.
 */
export function buildMeasurementEntries(
  rows: readonly ViewVitalRow[],
  activeMetricGoals: readonly ActiveMetricGoal[] = [],
): MeasurementEntry[] {
  const series = seriesByMetric(rows);
  return orderedKeys(series).map((key) => {
    const list = series.get(key)!;
    const latest = list[list.length - 1];
    return {
      key,
      label: labelOf(key),
      unit: unitOf(key, latest.unit),
      decimals: decimalsOf(key),
      latest: {
        value: latest.value,
        recordedAt: latest.recorded_at,
        source: latest.source,
      },
      display: formatMetricValue(latest.value, decimalsOf(key)),
      change: buildChange(key, latest, list[list.length - 2], activeMetricGoals),
      readings: list.length,
      stale: false,
    };
  });
}

/**
 * The latest measurement picture: every populated metric's most recent
 * reading, its change against that metric's own immediately previous reading,
 * and the presentation grouping the view renders.
 *
 * Returns null when the input holds no body measurements at all. Metrics with
 * no reading are simply absent — this never emits a placeholder row.
 */
export function buildLatestSession(
  rows: readonly ViewVitalRow[],
  activeMetricGoals: readonly ActiveMetricGoal[] = [],
): LatestSessionView | null {
  const flat = buildMeasurementEntries(rows, activeMetricGoals);
  if (flat.length === 0) return null;

  const entries = new Map<string, MeasurementEntry>();
  let asOf = '';
  let baseline = true;
  for (const entry of flat) {
    entries.set(entry.key, entry);
    if (entry.readings > 1) baseline = false;
    if (entry.latest.recordedAt > asOf) asOf = entry.latest.recordedAt;
  }

  let mixedDates = false;
  const sources = new Set<string>();
  for (const entry of entries.values()) {
    entry.stale = entry.latest.recordedAt < asOf;
    if (entry.stale) mixedDates = true;
    else sources.add(entry.latest.source);
  }

  const groups: MeasurementGroupView[] = [];
  for (const group of MEASUREMENT_GROUPS) {
    const rowsOut: MeasurementSlotRow[] = [];
    const seen = new Set<string>();
    for (const key of group.keys) {
      // Sided keys fold into their family's row; the unsided key anchors it.
      const base = key.startsWith('left_')
        ? key.slice(5)
        : key.startsWith('right_')
          ? key.slice(6)
          : key;
      if (seen.has(base)) continue;
      seen.add(base);

      const unsided = entries.get(base);
      const left = entries.get(`left_${base}`);
      const right = entries.get(`right_${base}`);
      // Nothing measured in this family — omit rather than render dashes.
      if (!unsided && !left && !right) continue;
      rowsOut.push({ base, label: labelOf(base), unsided, left, right });
    }
    if (rowsOut.length > 0) groups.push({ id: group.id, label: group.label, rows: rowsOut });
  }

  return {
    asOf,
    sources: [...sources].sort(),
    baseline,
    mixedDates,
    groups,
    count: entries.size,
  };
}

// ---------------------------------------------------------------------------
// Deterministic range report
// ---------------------------------------------------------------------------

export interface MeasurementReportEntry {
  key: string;
  label: string;
  unit: string | null;
  decimals: number;
  first: MeasurementReading;
  firstDisplay: string;
  latest: MeasurementReading;
  latestDisplay: string;
  /** null when only one reading falls in the range — baseline only. */
  change: Pick<MeasurementChange, 'amount' | 'display' | 'direction'> | null;
  readings: number;
}

function readingOf(row: ViewVitalRow): MeasurementReading {
  return { value: row.value, recordedAt: row.recorded_at, source: row.source };
}

/**
 * First reading, latest reading, absolute change and sample count per metric
 * over whatever rows are passed in (clip with filterMeasurementRows first).
 *
 * Deterministic and AI-free: no extrapolation, no annualization, no
 * improvement/regression verdict, and left/right never merge. A metric with a
 * single reading reports `change: null` — a baseline, not a trend of zero.
 */
export function buildMeasurementReport(
  rows: readonly ViewVitalRow[],
): MeasurementReportEntry[] {
  const series = seriesByMetric(rows);
  const out: MeasurementReportEntry[] = [];

  for (const key of orderedKeys(series)) {
    const list = series.get(key)!;
    const first = list[0];
    const latest = list[list.length - 1];
    const decimals = decimalsOf(key);

    let change: MeasurementReportEntry['change'] = null;
    if (list.length > 1) {
      const amount = latest.value - first.value;
      change = {
        amount,
        display: formatMetricValue(Math.abs(amount), decimals),
        direction:
          Math.abs(amount) < flatBandFor(key) ? 'flat' : amount > 0 ? 'up' : 'down',
      };
    }

    out.push({
      key,
      label: labelOf(key),
      unit: unitOf(key, latest.unit),
      decimals,
      first: readingOf(first),
      firstDisplay: formatMetricValue(first.value, decimals),
      latest: readingOf(latest),
      latestDisplay: formatMetricValue(latest.value, decimals),
      change,
      readings: list.length,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Chart series
// ---------------------------------------------------------------------------

/**
 * Categorical series palette for measurement charts. Sage anchors the set
 * (matching every other chart in the app); the rest are distinct hues at
 * comparable lightness so no series reads as "the good one".
 */
export const MEASUREMENT_SERIES_COLORS: readonly string[] = [
  '#81B29A', // sage
  '#E07A5F', // terracotta
  '#7FA8D9', // steel blue
  '#C99BD3', // orchid
  '#E0B76A', // sand
  '#6FC3C0', // teal
  '#B7C86F', // olive
  '#D98BA6', // rose
];

/**
 * Consecutive readings further apart than this are NOT joined by a line
 * segment: a straight run across a quarter-long silence looks like measured
 * progress that was never taken.
 */
export const MEASUREMENT_GAP_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MeasurementSeriesPoint {
  /** Epoch millis — the chart plots on a numeric time axis. */
  t: number;
  /** null marks a deliberate break across a long gap. */
  value: number | null;
  date: string;
  source: string;
}

export interface MeasurementSeries {
  key: string;
  label: string;
  unit: string | null;
  decimals: number;
  color: string;
  points: MeasurementSeriesPoint[];
}

/**
 * One chronological series per requested key, in the order requested. Keys
 * with no readings are omitted rather than drawn as empty lines, so a preset
 * degrades cleanly on sparse data; a single reading yields a single point.
 * Left and right stay separate series — nothing is combined.
 */
export function buildMeasurementSeries(
  rows: readonly ViewVitalRow[],
  keys: readonly string[],
): MeasurementSeries[] {
  const series = seriesByMetric(rows);
  const out: MeasurementSeries[] = [];

  for (const key of keys) {
    const list = series.get(key);
    if (!list || list.length === 0) continue;

    const points: MeasurementSeriesPoint[] = [];
    for (const row of list) {
      const t = Date.parse(row.recorded_at);
      const prev = points[points.length - 1];
      if (prev && prev.value !== null && t - prev.t > MEASUREMENT_GAP_DAYS * DAY_MS) {
        points.push({
          t: prev.t + (t - prev.t) / 2,
          value: null,
          date: row.recorded_at,
          source: row.source,
        });
      }
      points.push({ t, value: row.value, date: row.recorded_at, source: row.source });
    }

    out.push({
      key,
      label: labelOf(key),
      unit: unitOf(key, list[list.length - 1].unit),
      decimals: decimalsOf(key),
      color: MEASUREMENT_SERIES_COLORS[out.length % MEASUREMENT_SERIES_COLORS.length],
      points,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Fitness → Weekly compact summary
// ---------------------------------------------------------------------------

/** Structural subset of one `body.measurements_latest` wire entry. */
export interface WeeklyMeasurementWire {
  value: number;
  recorded_at: string;
  source: string;
  unit?: string | null;
}

export interface WeeklyMeasurementItem {
  key: string;
  label: string;
  /** Value at registry display precision. */
  display: string;
  unit: string | null;
  recordedAt: string;
  /** True when this reading is older than `asOf` — kept visibly dated. */
  stale: boolean;
}

export interface WeeklyMeasurementSummary {
  /** Newest reading date across the whole set. */
  asOf: string;
  /** Up to `max` populated measurements in registry order. */
  items: WeeklyMeasurementItem[];
  /** Populated measurements beyond the ones listed. */
  moreCount: number;
  total: number;
}

/**
 * Compact weekly-card summary of `body.measurements_latest`: the measurement
 * date, a few readings in registry order, and how many more there are. The
 * wire contract is untouched — this only changes how it is presented.
 *
 * Returns null when nothing is populated. Readings older than the newest one
 * are flagged `stale` so the card can date them instead of implying they were
 * all taken together.
 */
export function buildWeeklyMeasurementSummary(
  measurements: Readonly<Record<string, WeeklyMeasurementWire>>,
  max = 3,
): WeeklyMeasurementSummary | null {
  const keys = Object.keys(measurements)
    .filter((k) => MEASUREMENT_INDEX.has(k))
    .sort((a, b) => MEASUREMENT_INDEX.get(a)! - MEASUREMENT_INDEX.get(b)!);
  if (keys.length === 0) return null;

  let asOf = '';
  for (const key of keys) {
    const at = measurements[key].recorded_at;
    if (at > asOf) asOf = at;
  }

  const items = keys.slice(0, max).map((key) => {
    const m = measurements[key];
    return {
      key,
      label: labelOf(key),
      display: formatMetricValue(m.value, decimalsOf(key)),
      unit: unitOf(key, m.unit ?? null),
      recordedAt: m.recorded_at,
      stale: m.recorded_at < asOf,
    };
  });

  return { asOf, items, moreCount: keys.length - items.length, total: keys.length };
}

// ---------------------------------------------------------------------------
// AI prompt block
// ---------------------------------------------------------------------------

/** `-0.5` / `+1.3` — signed change at display precision. */
function signedChange(amount: number, decimals: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${formatMetricValue(Math.abs(amount), decimals)}`;
}

/**
 * Body measurements as SPARSE POINT-IN-TIME readings for a model prompt —
 * deliberately not the 7d/30d average lines `formatAggregatesForPrompt`
 * produces for daily vitals, which would imply a density these readings do
 * not have. Each line carries the latest reading, the previous one, the
 * change between them and the sample count; a lone reading says `baseline`.
 *
 * The trailing guidance is part of the block (rather than a system-prompt
 * rule) so every consumer of this data gets it. Empty string when there are
 * no measurements, so callers can drop the section entirely.
 */
export function formatMeasurementsForPrompt(rows: readonly ViewVitalRow[]): string {
  // No goals are passed: the prompt states the numbers and leaves every
  // judgement to the model, which the trailing guidance then constrains.
  const entries = buildMeasurementEntries(rows);
  if (entries.length === 0) return '';

  return [
    'Body measurements (circumference readings — sparse point-in-time values, NOT daily averages):',
    ...entries.map(promptLine),
    'Interpreting these: date-frame every measurement statement. Do NOT call a change an improvement or a regression unless an explicit goal for that measurement is listed above. Unsided, left and right measurements are independent series — do not interpret a left/right difference medically. A single reading is a baseline, not a trend.',
  ].join('\n');
}

/** One prompt line for an entry: latest, previous, change, sample count. */
function promptLine(entry: MeasurementEntry): string {
  const suffix = entry.unit ? ` ${entry.unit}` : '';
  const head = `- ${entry.label}: ${entry.display}${suffix} (${formatUtcDayYear(entry.latest.recordedAt)})`;

  if (!entry.change) return `${head} | baseline (first reading) | 1 reading`;

  const { change } = entry;
  return (
    `${head} | previous ${formatMetricValue(change.previous.value, entry.decimals)}${suffix}` +
    ` (${formatUtcDayYear(change.previous.recordedAt)})` +
    ` | change ${signedChange(change.amount, entry.decimals)}${suffix}` +
    ` | ${entry.readings} readings`
  );
}
