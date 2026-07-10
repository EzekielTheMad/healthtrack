// ---------------------------------------------------------------------------
// Vitals aggregation for AI context (spec §5).
//
// Pure module: turns raw vitals rows into per-metric aggregates honoring each
// registry entry's `aggregate` hint, and formats them as a compact prompt
// block (one line per metric, grouped by category). Used by the health-summary
// and health-query prompt builders so the model sees trajectory, not a row
// dump.
// ---------------------------------------------------------------------------

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  METRICS,
  getMetric,
  type MetricCategory,
  type MetricDef,
} from './registry';

/**
 * Minimal structural row — the repo's `VitalRow` (drizzle camelCase select)
 * is assignable to this, and prompt builders that receive snake_case shapes
 * can map into it without touching the DB layer.
 */
export interface AggregateVitalRow {
  metricKey: string;
  value: number;
  recordedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface MetricAggregate {
  key: string;
  label: string;
  category: MetricCategory;
  unit: string | null;
  latest: number;
  /** Ordinal metrics only: ordinalLabels[value-1] from the registry, with
      metadata.label as a legacy-row fallback (registry wins — metadata is
      client-controlled and must not steer prompt text). */
  latestLabel?: string;
  latestAt: string;
  /** Mean over the trailing 7d window — TOTAL for `aggregate: 'sum'` metrics. */
  avg7d: number | null;
  /** Mean over the trailing 30d window — TOTAL for `aggregate: 'sum'` metrics. */
  avg30d: number | null;
  /** avg7d vs the prior-7d window, with a ±5% dead band. */
  trend: 'up' | 'down' | 'flat';
  count30d: number;
}

/** Milliseconds per day — shared by window math here and in focus.ts. */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Relative change within ±5% counts as flat. */
const TREND_DEAD_BAND = 0.05;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Registry declaration order (categories are contiguous in METRICS). */
const REGISTRY_INDEX: ReadonlyMap<string, number> = new Map(
  METRICS.map((m, i) => [m.key, i]),
);

/**
 * Collapse a window of raw values per the registry aggregate hint: total for
 * `sum` metrics, mean otherwise; null for an empty window. Shared with the
 * focus-view math (src/lib/metrics/focus.ts).
 */
export function windowValue(kind: MetricDef['aggregate'], values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return kind === 'sum' ? sum : sum / values.length;
}

function trendOf(cur: number | null, prior: number | null): MetricAggregate['trend'] {
  if (cur === null || prior === null) return 'flat';
  if (prior === 0) return cur === 0 ? 'flat' : cur > 0 ? 'up' : 'down';
  const rel = (cur - prior) / Math.abs(prior);
  if (Math.abs(rel) <= TREND_DEAD_BAND) return 'flat';
  return rel > 0 ? 'up' : 'down';
}

function ordinalLabelFor(metric: MetricDef, row: AggregateVitalRow): string | undefined {
  if (metric.valueType !== 'ordinal') return undefined;
  // Registry label first — metadata.label is client-controlled and must not
  // steer prompt text. Legacy rows whose value falls outside the registry
  // label range fall back to the stored label.
  const registryLabel = metric.ordinalLabels?.[row.value - 1];
  if (registryLabel !== undefined) return registryLabel;
  const metaLabel = row.metadata?.['label'];
  if (typeof metaLabel === 'string' && metaLabel.length > 0) return metaLabel;
  return undefined;
}

/**
 * Aggregate raw vitals rows (any order, any window) into one entry per
 * registry-known metric, ordered by registry declaration. Rows with unknown
 * metric keys are skipped. Windows are trailing from `now` (default: current
 * time): 7d, prior-7d (days 8–14), and 30d.
 */
export function aggregateVitals(
  rows: AggregateVitalRow[],
  now: Date = new Date(),
): MetricAggregate[] {
  const t = now.getTime();
  const cut7 = t - 7 * DAY_MS;
  const cut14 = t - 14 * DAY_MS;
  const cut30 = t - 30 * DAY_MS;

  const byKey = new Map<string, AggregateVitalRow[]>();
  for (const row of rows) {
    if (!REGISTRY_INDEX.has(row.metricKey)) continue; // closed registry
    const list = byKey.get(row.metricKey);
    if (list) list.push(row);
    else byKey.set(row.metricKey, [row]);
  }

  const out: MetricAggregate[] = [];
  for (const [key, list] of byKey) {
    const metric = getMetric(key)!;

    let latestRow = list[0];
    const in7: number[] = [];
    const prior7: number[] = [];
    const in30: number[] = [];
    for (const row of list) {
      if (row.recordedAt > latestRow.recordedAt) latestRow = row;
      const rt = Date.parse(row.recordedAt);
      if (Number.isNaN(rt)) continue;
      if (rt > cut7) in7.push(row.value);
      else if (rt > cut14) prior7.push(row.value);
      if (rt > cut30) in30.push(row.value);
    }

    out.push({
      key,
      label: metric.label,
      category: metric.category,
      unit: metric.unit,
      latest: latestRow.value,
      latestLabel: ordinalLabelFor(metric, latestRow),
      latestAt: latestRow.recordedAt,
      avg7d: windowValue(metric.aggregate, in7),
      avg30d: windowValue(metric.aggregate, in30),
      trend: trendOf(
        windowValue(metric.aggregate, in7),
        windowValue(metric.aggregate, prior7),
      ),
      count30d: in30.length,
    });
  }

  return out.sort(
    (a, b) => REGISTRY_INDEX.get(a.key)! - REGISTRY_INDEX.get(b.key)!,
  );
}

/** `104` / `213.4` — fixed to the metric's decimals, trailing zeros stripped. */
function fmtNum(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toString();
}

/** Compact totals for sum metrics: 25368 → `25k`, 3624 → `3.6k`, 840 → `840`. */
function fmtCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${Math.round(value / 1000)}k`;
  if (abs >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return fmtNum(value, 0);
}

/** `2026-07-07T00:00:00Z` → `Jul 7` (UTC). */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `2026-07-07T08:12:00Z` → `Jul 7 08:12` (UTC). */
function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${fmtDay(iso)} ${hh}:${mm}`;
}

function formatLine(agg: MetricAggregate): string {
  const metric = getMetric(agg.key);
  const decimals = metric?.decimals ?? 0;
  const day = fmtDay(agg.latestAt);

  let head: string;
  if (agg.latestLabel && metric?.ordinalLabels) {
    // e.g. `- Resilience: solid (3/5, Jul 7)`
    head = `- ${agg.label}: ${agg.latestLabel} (${fmtNum(agg.latest, 0)}/${metric.ordinalLabels.length}, ${day})`;
  } else {
    const unit = agg.unit ? ` ${agg.unit}` : '';
    head = `- ${agg.label}: ${fmtNum(agg.latest, decimals)}${unit} (${day})`;
  }

  const segments = [head];
  if (metric?.aggregate === 'sum') {
    if (agg.avg7d !== null) {
      segments.push(`7d total ${fmtCompact(agg.avg7d)} (avg ${fmtCompact(agg.avg7d / 7)}/day)`);
    }
    if (agg.avg30d !== null) {
      segments.push(`30d total ${fmtCompact(agg.avg30d)} (avg ${fmtCompact(agg.avg30d / 30)}/day)`);
    }
  } else {
    // Ordinal averages keep one decimal so trends between labels are visible.
    const avgDecimals = metric?.valueType === 'ordinal' ? 1 : decimals;
    if (agg.avg7d !== null) segments.push(`7d avg ${fmtNum(agg.avg7d, avgDecimals)}`);
    if (agg.avg30d !== null) segments.push(`30d avg ${fmtNum(agg.avg30d, avgDecimals)}`);
  }
  segments.push(`trend ${agg.trend}`);
  return segments.join(' | ');
}

/**
 * One line per metric, grouped under category headers in CATEGORY_ORDER:
 *
 *   Sleep:
 *   - Deep Sleep: 104 min (Jul 7) | 7d avg 92 | 30d avg 88 | trend up
 *
 * Empty input → empty string (callers substitute their own placeholder).
 */
export function formatAggregatesForPrompt(aggs: MetricAggregate[]): string {
  const blocks: string[] = [];
  for (const category of CATEGORY_ORDER) {
    const inCategory = aggs.filter((a) => a.category === category);
    if (inCategory.length === 0) continue;
    blocks.push(
      `${CATEGORY_LABELS[category]}:\n${inCategory.map(formatLine).join('\n')}`,
    );
  }
  return blocks.join('\n\n');
}

/**
 * Raw recent readings for intraday-capable metrics (blood glucose, blood
 * pressure) — aggregates alone hide clinically relevant spikes. One line per
 * intraday metric with data, newest first, capped at `max` readings.
 * Empty string when no intraday metric has rows.
 */
export function formatIntradayReadings(
  rows: AggregateVitalRow[],
  max = 5,
): string {
  const lines: string[] = [];
  for (const metric of METRICS) {
    if (!metric.intraday) continue;
    const readings = rows
      .filter((r) => r.metricKey === metric.key)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, max);
    if (readings.length === 0) continue;
    const unit = metric.unit ? ` (${metric.unit})` : '';
    const values = readings
      .map((r) => `${fmtNum(r.value, metric.decimals ?? 0)} (${fmtDayTime(r.recordedAt)})`)
      .join(', ');
    lines.push(`- ${metric.label}${unit}: ${values}`);
  }
  if (lines.length === 0) return '';
  return `Recent intraday readings (last ${max} per metric):\n${lines.join('\n')}`;
}
