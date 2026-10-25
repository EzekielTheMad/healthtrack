import { z } from 'zod';
import { getVitalDayKey, isValidDayKey, shiftDayKey } from '@/lib/dates';
import { calendarDayInTimeZone, getHealthTrackTimeZone } from '@/lib/oura/timezone';
import { listVitals, listVitalSourcePreferences, type VitalRow } from '@/lib/repos/vitals';
import { listNutritionDaily, type NutritionDailyRow } from '@/lib/repos/nutrition';
import { listWorkouts, type WorkoutWithEntries } from '@/lib/repos/workouts';
import { requireListAuthz, type ListScope } from '@/lib/repos/_scope';
import { tonnage } from '@/lib/fitness/e1rm';
import { nutritionSourceLabel } from '@/lib/nutrition/sources';
import { METRICS, getMetric } from './registry';
import { sourceConflicts, type VitalSourcePreferences } from './source-selection';
import { convertToCanonicalUnit } from './units';
import type {
  ComparisonAggregation,
  ComparisonDays,
  ComparisonMetric,
  ComparisonResponse,
  ComparisonSource,
} from './comparison-types';

export const comparisonDaysSchema = z.coerce.number().pipe(z.union([z.literal(30), z.literal(90)]));

// The extra row detects truncation. Nutrition's repository has its own 1000-row cap.
const VITAL_LIMIT = 20000;
const NUTRITION_LIMIT = 1000;
const WORKOUT_LIMIT = 1000;

interface Observation {
  date: string;
  at: string;
  value: number;
}

const VITAL_SOURCE_LABELS: Readonly<Record<string, string>> = {
  oura: 'Oura',
  health_connect_daily: 'Health Connect',
  renpho: 'Renpho',
  myair: 'myAir',
  manual: 'Manual entry',
};

function alignedSource(
  source: string,
  label: string,
  observations: readonly Observation[],
  dates: readonly string[],
  aggregation: ComparisonAggregation
): ComparisonSource {
  const buckets = new Map<string, Observation[]>();
  for (const row of observations) {
    const bucket = buckets.get(row.date) ?? [];
    bucket.push(row);
    buckets.set(row.date, bucket);
  }
  const points = dates.map((date) => {
    const rows = buckets.get(date);
    if (!rows?.length) return { date, value: null };
    let value: number;
    if (aggregation === 'latest') {
      value = rows.reduce((latest, row) =>
        new Date(row.at).getTime() > new Date(latest.at).getTime() ? row : latest
      ).value;
    } else {
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      value = aggregation === 'mean' ? total / rows.length : total;
    }
    return { date, value: Number.isFinite(value) ? value : null };
  });
  return { source, label, points, recorded_days: points.filter((p) => p.value !== null).length };
}

function validInstant(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

/** Pure daily builder. Receives only records authorized and scoped by the service below. */
export function comparisonMetrics(
  input: {
    vitals: readonly VitalRow[];
    nutrition: readonly NutritionDailyRow[];
    workouts: readonly WorkoutWithEntries[];
    preferences?: VitalSourcePreferences;
  },
  dates: readonly string[],
  timeZone: string
): { metrics: ComparisonMetric[]; warnings: string[] } {
  const included = new Set(dates);
  const warnings = new Set<string>();
  const windowVitals = input.vitals.filter((row) => {
    if (!getMetric(row.metricKey) || !validInstant(row.recordedAt)) return false;
    return included.has(getVitalDayKey(row.recordedAt, row.metricKey, timeZone));
  });
  const conflicts = new Map(
    sourceConflicts(windowVitals, input.preferences).map((item) => [item.metricKey, item])
  );
  const metrics: ComparisonMetric[] = [];

  for (const metric of METRICS) {
    const rows = windowVitals.filter((row) => row.metricKey === metric.key);
    const preferredSource = input.preferences?.[metric.key];
    if (!rows.length && !preferredSource) continue;
    const conflict = conflicts.get(metric.key);
    const selectedSource = preferredSource ?? conflict?.selectedSource ?? null;
    const sources = new Set(rows.map((row) => row.source));
    const rowsBySource = new Map<string, VitalRow[]>();
    for (const row of rows) {
      const group = rowsBySource.get(row.source) ?? [];
      group.push(row);
      rowsBySource.set(row.source, group);
    }
    if (selectedSource) sources.add(selectedSource);
    // Non-intraday sums are complete daily snapshots (steps, active calories,
    // water, etc.). Repeated snapshots must never be summed into a daily total.
    const aggregation =
      metric.aggregate === 'sum' && !metric.intraday ? 'latest' : metric.aggregate;
    metrics.push({
      key: `vital:${metric.key}`,
      label: metric.label,
      unit: metric.unit,
      domain: 'vitals',
      aggregation,
      selected_source: selectedSource,
      sources: [...sources].sort().map((source) => {
        const observations: Observation[] = [];
        for (const row of rowsBySource.get(source) ?? []) {
          const unit = row.unit?.trim() || metric.unit;
          const value =
            metric.unit === null
              ? unit === null
                ? row.value
                : undefined
              : unit
                ? convertToCanonicalUnit(metric.unit, unit, row.value)
                : undefined;
          if (value === undefined || !Number.isFinite(value)) {
            warnings.add(
              `${metric.label}: some readings have unsupported units or values and are shown as gaps.`
            );
            continue;
          }
          observations.push({
            date: getVitalDayKey(row.recordedAt, row.metricKey, timeZone),
            at: row.recordedAt,
            value,
          });
        }
        return alignedSource(
          source,
          Object.hasOwn(VITAL_SOURCE_LABELS, source) ? VITAL_SOURCE_LABELS[source] : source,
          observations,
          dates,
          aggregation
        );
      }),
    });
  }

  const nutrition = input.nutrition.filter(
    (row) => included.has(row.date) && isValidDayKey(row.date)
  );
  const nutritionSources = [...new Set(nutrition.map((row) => row.sourcePackage))].sort();
  const nutrients = [
    ['calories', 'Calorie intake', 'kcal', 'calories'],
    ['protein', 'Protein intake', 'g', 'proteinGrams'],
    ['carbs', 'Carbohydrate intake', 'g', 'carbsGrams'],
    ['fat', 'Fat intake', 'g', 'fatGrams'],
  ] as const;
  for (const [key, label, unit, field] of nutrients) {
    if (!nutrition.some((row) => row[field] !== null && Number.isFinite(row[field]))) continue;
    metrics.push({
      key: `nutrition:${key}`,
      label,
      unit,
      domain: 'nutrition',
      aggregation: 'latest',
      selected_source: nutritionSources.length === 1 ? nutritionSources[0] : null,
      sources: nutritionSources.map((source) =>
        alignedSource(
          source,
          typeof nutritionSourceLabel(source) === 'string' ? nutritionSourceLabel(source) : source,
          nutrition
            .filter(
              (row) =>
                row.sourcePackage === source && row[field] !== null && Number.isFinite(row[field])
            )
            .map((row) => ({ date: row.date, at: row.updatedAt, value: row[field]! })),
          dates,
          'latest'
        )
      ),
    });
  }
  if (nutritionSources.length > 1) {
    warnings.add(
      'Nutrition sources are separate daily snapshots. Choose one source; totals are never added together.'
    );
  }

  const workouts = input.workouts.filter(
    (row) =>
      validInstant(row.startedAt) &&
      included.has(calendarDayInTimeZone(new Date(row.startedAt), timeZone))
  );
  const durations: Observation[] = [];
  const volumes: Observation[] = [];
  for (const workout of workouts) {
    const date = calendarDayInTimeZone(new Date(workout.startedAt), timeZone);
    if (workout.durationMin !== null && Number.isFinite(workout.durationMin)) {
      durations.push({ date, at: workout.startedAt, value: workout.durationMin });
    }
    const sets = workout.entries
      .flatMap((entry) => entry.sets)
      .filter(
        (set) =>
          !set.warmup &&
          set.weight !== undefined &&
          set.reps !== undefined &&
          Number.isFinite(set.weight) &&
          Number.isFinite(set.reps)
      );
    // No qualifying parsed sets is unknown volume, not an assertion of zero.
    if (sets.length) volumes.push({ date, at: workout.startedAt, value: tonnage(sets) });
  }
  for (const [key, label, unit, observations] of [
    ['duration_min', 'Logged training duration', 'min', durations],
    ['volume_lbs', 'Working-set training volume', 'lb', volumes],
  ] as const) {
    if (!observations.length) continue;
    metrics.push({
      key: `fitness:${key}`,
      label,
      unit,
      domain: 'fitness',
      aggregation: 'sum',
      selected_source: 'workout_log',
      sources: [alignedSource('workout_log', 'Workout log', observations, dates, 'sum')],
    });
  }
  if (workouts.some((row) => row.durationMin === null)) {
    warnings.add(
      'Training duration includes recorded durations only; sessions without a duration are unknown.'
    );
  }
  if (volumes.length) {
    warnings.add(
      'Training volume includes parsed working sets only, excludes warmups, and doubles per-side sets.'
    );
  }
  return { metrics, warnings: [...warnings] };
}

/** A bounded, read-only view of exactly one person. Repository authorization stays authoritative. */
export async function buildMetricComparison(
  actorId: string,
  scope: ListScope,
  days: ComparisonDays = 30,
  now = new Date()
): Promise<ComparisonResponse> {
  comparisonDaysSchema.parse(days);
  const timeZone = getHealthTrackTimeZone();
  const endDate = calendarDayInTimeZone(now, timeZone);
  const startDate = shiftDayKey(endDate, 1 - days);
  const dates = Array.from({ length: days }, (_, i) => shiftDayKey(startDate, i));
  const isSelf = scope.ownerId === actorId && scope.dependentId === null;
  // Retrieve one extra UTC calendar day at either edge, then filter using the
  // instance timezone for instants and the stored clinical day for daily rows.
  const from = shiftDayKey(startDate, -1);
  const to = `${shiftDayKey(endDate, 1)}T23:59:59.999Z`;
  // Keep the delegate-only 'all' authorization boundary, then narrow the
  // repository query itself to one person before its row limit is applied.
  // A large dependent history must not crowd the owner's readings out.
  if (scope.dependentId === 'all') await requireListAuthz(actorId, scope, 'vitals', 'read');
  const vitalScope = scope.dependentId === 'all' ? { ...scope, dependentId: null } : scope;
  const [rawVitals, nutrition, workouts, preferences] = await Promise.all([
    listVitals(actorId, vitalScope, { startDate: from, endDate: to, limit: VITAL_LIMIT + 1 }),
    isSelf ? listNutritionDaily(actorId, { startDate, endDate, limit: NUTRITION_LIMIT }) : [],
    isSelf ? listWorkouts(actorId, scope, { from, to, limit: WORKOUT_LIMIT + 1 }) : [],
    isSelf ? listVitalSourcePreferences(actorId) : [],
  ]);
  const built = comparisonMetrics(
    {
      vitals: rawVitals.slice(0, VITAL_LIMIT),
      nutrition,
      workouts: workouts.slice(0, WORKOUT_LIMIT),
      preferences: Object.fromEntries(
        preferences.map((row) => [row.metricKey, row.preferredSource])
      ),
    },
    dates,
    timeZone
  );
  if (rawVitals.length > VITAL_LIMIT)
    built.warnings.push(
      'Vital history reached its 20000-row limit; comparison coverage may be incomplete.'
    );
  if (nutrition.length >= NUTRITION_LIMIT)
    built.warnings.push(
      'Nutrition history reached its 1000-row limit; comparison coverage may be incomplete.'
    );
  if (workouts.length > WORKOUT_LIMIT)
    built.warnings.push(
      'Workout history reached its 1000-session limit; comparison coverage may be incomplete.'
    );
  if (scope.dependentId === 'all')
    built.warnings.push(
      'This comparison shows the selected owner only; dependent records are excluded.'
    );
  return {
    days,
    start_date: startDate,
    end_date: endDate,
    time_zone: timeZone,
    ...built,
    unavailable_domains: isSelf ? [] : ['nutrition', 'fitness'],
  };
}
