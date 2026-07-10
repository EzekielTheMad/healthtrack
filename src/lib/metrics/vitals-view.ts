// ---------------------------------------------------------------------------
// Pure view logic for the vitals page.
//
// Daily view: group one day's readings by registry category and compute a
// delta against the trailing 7-day average. Trends view: bucket bar-chart
// data into calendar weeks when the visible range is long enough that
// per-day bars become unreadable.
// ---------------------------------------------------------------------------

import { getVitalDayKey, shiftDayKey } from '../dates';
import { formatDuration, isDurationMetric } from './format';
import {
  CATEGORY_ORDER,
  METRICS,
  getMetric,
  type MetricCategory,
  type MetricDef,
} from './registry';

/** Structural subset of `Vital` — snake_case API rows are assignable. */
export interface ViewVitalRow {
  metric_key: string;
  value: number;
  unit: string | null;
  source: string;
  recorded_at: string;
  metadata?: Record<string, unknown> | null;
}

export interface DailyReading {
  value: number;
  /** Formatted value: ordinal label text, or number at registry decimals. */
  display: string;
  recordedAt: string;
  source: string;
}

export interface DailyDelta {
  direction: 'up' | 'down' | 'flat';
  /** dayValue − baseline, in metric units (signed). */
  amount: number;
  /** |amount| formatted at display precision (ordinals: 1 decimal). */
  display: string;
  /**
   * Whether the move reads as an improvement, from the registry
   * goalDirection; metrics without a direction (and flat deltas) stay neutral.
   */
  tone: 'good' | 'bad' | 'neutral';
}

export interface DailyEntry {
  key: string;
  label: string;
  unit: string | null;
  intraday: boolean;
  /** True when readings render as h/m durations (minute-based sleep metrics). */
  duration: boolean;
  /** Registry aggregate hint — sum metrics compare vs the 7d DAILY average. */
  aggregate: MetricDef['aggregate'];
  /**
   * Intraday metrics: every reading of the day, chronological. Others: a
   * single reading whose display is the day value (mean of same-day rows;
   * sum metrics show the day total).
   */
  readings: DailyReading[];
  /** Day value compared against the baseline (sum metrics: day total). */
  dayValue: number;
  /**
   * vs the trailing 7-day window (the 7 days before the selected day).
   * Mean/latest metrics compare against the window mean; sum metrics
   * against the 7-day daily average (window total / 7). Null when the
   * window has no data.
   */
  delta: DailyDelta | null;
}

export interface DailySection {
  category: MetricCategory;
  entries: DailyEntry[];
}

const REGISTRY_INDEX: ReadonlyMap<string, number> = new Map(
  METRICS.map((m, i) => [m.key, i]),
);

/** Most recent calendar day (YYYY-MM-DD) with any data; null when empty. */
export function defaultDayKey(rows: ViewVitalRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    const key = getVitalDayKey(row.recorded_at, row.metric_key);
    if (latest === null || key > latest) latest = key;
  }
  return latest;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Numeric display at metric decimals with trailing zeros stripped. */
function fmtNum(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toString();
}

/** Ordinal display: metadata.label (user-entered) first, registry fallback. */
function ordinalDisplay(metric: MetricDef, row: ViewVitalRow): string {
  const metaLabel = row.metadata?.['label'];
  if (typeof metaLabel === 'string' && metaLabel.length > 0) return metaLabel;
  return metric.ordinalLabels?.[row.value - 1] ?? String(row.value);
}

function displayDecimals(metric: MetricDef | undefined): number {
  if (!metric) return 1; // registry-unknown keys
  if (metric.valueType === 'ordinal') return 1; // deltas between labels stay visible
  return metric.decimals ?? 0;
}

function buildDelta(
  dayValue: number,
  baseline: number | null,
  decimals: number,
  goalDirection: MetricDef['goalDirection'],
): DailyDelta | null {
  if (baseline === null) return null;
  const amount = dayValue - baseline;
  // Deltas that round to zero at display precision read as "no change".
  const flat = Math.abs(amount) < 0.5 * 10 ** -decimals;
  let tone: DailyDelta['tone'] = 'neutral';
  if (!flat && goalDirection !== undefined) {
    tone = (amount > 0) === (goalDirection === 'higher') ? 'good' : 'bad';
  }
  return {
    direction: flat ? 'flat' : amount > 0 ? 'up' : 'down',
    amount,
    display: fmtNum(Math.abs(amount), decimals),
    tone,
  };
}

/**
 * One section per registry category with data on `dayKey`, in CATEGORY_ORDER;
 * entries follow registry declaration order (unknown keys append under
 * cardiovascular, matching the trends view fallback).
 */
export function buildDailySections(
  rows: ViewVitalRow[],
  dayKey: string,
): DailySection[] {
  // Trailing 7-day baseline window: dayKey-7 .. dayKey-1 inclusive.
  const windowStart = shiftDayKey(dayKey, -7);

  const byMetric = new Map<string, { day: ViewVitalRow[]; window: ViewVitalRow[] }>();
  for (const row of rows) {
    const rowDay = getVitalDayKey(row.recorded_at, row.metric_key);
    const inDay = rowDay === dayKey;
    const inWindow = rowDay >= windowStart && rowDay < dayKey;
    if (!inDay && !inWindow) continue;
    let bucket = byMetric.get(row.metric_key);
    if (!bucket) {
      bucket = { day: [], window: [] };
      byMetric.set(row.metric_key, bucket);
    }
    (inDay ? bucket.day : bucket.window).push(row);
  }

  const byCategory = new Map<MetricCategory, DailyEntry[]>();
  for (const [key, { day, window }] of byMetric) {
    if (day.length === 0) continue;
    const metric = getMetric(key);
    const aggregate = metric?.aggregate ?? 'mean';
    const decimals = displayDecimals(metric);
    const intraday = metric?.intraday === true;
    const duration = isDurationMetric(metric);

    const dayValues = day.map((r) => r.value);
    const dayValue = aggregate === 'sum' ? dayValues.reduce((a, b) => a + b, 0) : mean(dayValues);

    let baseline: number | null = null;
    if (window.length > 0) {
      const total = window.reduce((a, r) => a + r.value, 0);
      baseline = aggregate === 'sum' ? total / 7 : total / window.length;
    }

    const chronological = [...day].sort((a, b) =>
      a.recorded_at.localeCompare(b.recorded_at),
    );
    const readings: DailyReading[] = intraday
      ? chronological.map((r) => ({
          value: r.value,
          display:
            metric?.valueType === 'ordinal'
              ? ordinalDisplay(metric, r)
              : fmtNum(r.value, metric?.decimals ?? decimals),
          recordedAt: r.recorded_at,
          source: r.source,
        }))
      : (() => {
          const latest = chronological[chronological.length - 1];
          return [
            {
              value: dayValue,
              display:
                metric?.valueType === 'ordinal'
                  ? ordinalDisplay(metric, latest)
                  : duration
                    ? formatDuration(dayValue)
                    : fmtNum(dayValue, metric?.decimals ?? decimals),
              recordedAt: latest.recorded_at,
              source: latest.source,
            },
          ];
        })();

    const entry: DailyEntry = {
      key,
      label: metric?.label ?? key,
      unit: metric?.unit ?? day[0].unit,
      intraday,
      duration,
      aggregate,
      readings,
      dayValue,
      delta: buildDelta(dayValue, baseline, decimals, metric?.goalDirection),
    };

    const category = metric?.category ?? 'cardiovascular';
    const list = byCategory.get(category);
    if (list) list.push(entry);
    else byCategory.set(category, [entry]);
  }

  const sections: DailySection[] = [];
  for (const category of CATEGORY_ORDER) {
    const entries = byCategory.get(category);
    if (!entries) continue;
    entries.sort(
      (a, b) =>
        (REGISTRY_INDEX.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
        (REGISTRY_INDEX.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
    sections.push({ category, entries });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Weekly bar bucketing (trends view, long ranges)
// ---------------------------------------------------------------------------

export interface ChartPoint {
  value: number;
  date: string;
  /** Weekly buckets only: distinct days with data aggregated into the bucket,
      so partial edge weeks can be labeled honestly. */
  days?: number;
}

/** Ranges longer than this many days aggregate bar charts to weekly buckets. */
export const WEEKLY_BUCKET_THRESHOLD_DAYS = 60;

export function shouldBucketWeekly(from: Date, to: Date): boolean {
  const days = (to.getTime() - from.getTime()) / 86400_000;
  return days > WEEKLY_BUCKET_THRESHOLD_DAYS;
}

/** Monday-start UTC week key (`YYYY-MM-DD`) for a day-normalized timestamp. */
function weekStartKey(iso: string): string {
  const d = new Date(iso);
  const offset = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Aggregate day-normalized chart points into Monday-start UTC weeks: sum
 * metrics sum within the week, mean/latest metrics average. Bucket values
 * round to `decimals`; output is labeled by week start, sorted ascending, and
 * carries `days` (distinct days with data) so partial buckets — range-clipped
 * edge weeks especially — stay honest in labels and tooltips.
 */
export function bucketWeekly(
  points: ChartPoint[],
  aggregate: MetricDef['aggregate'],
  decimals = 1,
): ChartPoint[] {
  const buckets = new Map<string, { values: number[]; days: Set<string> }>();
  for (const p of points) {
    const key = weekStartKey(p.date);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { values: [], days: new Set() };
      buckets.set(key, bucket);
    }
    bucket.values.push(p.value);
    bucket.days.add(p.date.slice(0, 10));
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { values, days }]) => ({
      date: `${key}T00:00:00.000Z`,
      value: Number(
        (aggregate === 'sum'
          ? values.reduce((a, b) => a + b, 0)
          : mean(values)
        ).toFixed(decimals),
      ),
      days: days.size,
    }));
}
