import type {
  ComparisonMetric,
  ComparisonResponse,
  ComparisonSource,
} from '@/lib/metrics/comparison-types';

export interface ComparisonChoice {
  metric: string;
  /** Null uses the saved/default source supplied by the server. */
  source: string | null;
}

export interface ComparisonPoint {
  date: string;
  left: number | null;
  right: number | null;
}

export const COMPARISON_PRESETS = [
  { label: 'AHI and sleep', left: 'vital:ahi', right: 'vital:sleep_score' },
  { label: 'Calories and weight', left: 'nutrition:calories', right: 'vital:weight' },
  { label: 'Training and readiness', left: 'fitness:duration_min', right: 'vital:readiness_score' },
] as const;

export function hasComparisonData(metric: ComparisonMetric): boolean {
  return metric.sources.some((source) => source.recorded_days > 0);
}

export function defaultComparison(metrics: ComparisonMetric[]): [string, string] {
  const available = metrics.filter(hasComparisonData);
  const preset = COMPARISON_PRESETS.find((pair) =>
    [pair.left, pair.right].every((key) => available.some((metric) => metric.key === key))
  );
  return preset
    ? [preset.left, preset.right]
    : [
        available[0]?.key ?? metrics[0]?.key ?? '',
        available[1]?.key ?? available[0]?.key ?? metrics[0]?.key ?? '',
      ];
}

export function comparisonSource(
  metric: ComparisonMetric | undefined,
  override: string | null
): ComparisonSource | undefined {
  const selected = override ?? metric?.selected_source;
  return selected == null
    ? undefined
    : metric?.sources.find((source) => source.source === selected);
}

/** Build every calendar day explicitly; missing observations stay null, including between points. */
export function comparisonPoints(
  response: Pick<ComparisonResponse, 'start_date' | 'days'>,
  left: ComparisonSource | undefined,
  right: ComparisonSource | undefined
): ComparisonPoint[] {
  const values = (source: ComparisonSource | undefined) =>
    new Map(source?.points.map((point) => [point.date, point.value]) ?? []);
  const leftValues = values(left);
  const rightValues = values(right);
  const firstDay = new Date(`${response.start_date}T00:00:00Z`);
  return Array.from({ length: response.days }, (_, index) => {
    const day = new Date(firstDay);
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    const finite = (value: number | null | undefined) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    return { date, left: finite(leftValues.get(date)), right: finite(rightValues.get(date)) };
  });
}

/** Preserve the actual numeric value, rather than rounding it to an integer or treating zero as missing. */
export function comparisonValue(value: number | null, unit: string | null): string {
  return value === null
    ? 'No data'
    : `${value.toLocaleString('en-US', { maximumFractionDigits: 10 })}${unit ? ` ${unit}` : ''}`;
}
