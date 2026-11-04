/** Native projection rules. Raw records remain the authority; every affected
 * source/day is replaced from its surviving records, never incremented. */
import crypto from 'node:crypto';
import { z } from 'zod';
import { getMetric } from '@/lib/metrics/registry';
import { validateVitalWrite } from '@/lib/repos/vitals';
import { calendarDayInTimeZone, getHealthTrackTimeZone } from '@/lib/oura/timezone';
import { nativeInstant, type NativeRecord } from './native-schema';

export function nativeSource(packageName: string): string {
  return `hc:${crypto.createHash('sha256').update(packageName).digest('base64url')}`;
}
export function nativeObservationId(
  record: Pick<NativeRecord, 'record_type' | 'source_package' | 'record_id'>
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([record.record_type, record.source_package, record.record_id]))
    .digest('hex');
}
export function nativeRecordDay(
  record: Pick<NativeRecord, 'record_type' | 'start_time' | 'end_time'>
): string {
  const instant =
    record.record_type === 'sleep' ? (record.end_time ?? record.start_time) : record.start_time;
  return calendarDayInTimeZone(new Date(instant), getHealthTrackTimeZone());
}
export const NATIVE_METRIC_KEYS: Readonly<Record<string, readonly string[]>> = {
  weight: ['weight'],
  body_fat: ['body_fat_pct'],
  resting_heart_rate: ['resting_hr'],
  heart_rate_variability: ['hrv_rmssd'],
  oxygen_saturation: ['spo2'],
  respiratory_rate: ['respiratory_rate'],
  blood_pressure: ['bp_systolic', 'bp_diastolic'],
  blood_glucose: ['blood_glucose'],
  body_temperature: ['body_temp'],
  basal_body_temperature: ['basal_body_temp'],
  vo2_max: ['vo2_max'],
  hydration: ['water_intake'],
  sleep: ['sleep_duration', 'deep_sleep', 'light_sleep', 'rem_sleep', 'awake_time', 'time_in_bed'],
};

export interface NativeMetricValue {
  metricKey: string;
  value: number;
  unit: string;
  recordedAt: string;
  nativeRecordId: string | null;
  metadata: Record<string, unknown>;
}
const scalar = z.object({ value: z.number().finite(), unit: z.string().min(1).max(24) });
const stagesSchema = z
  .array(
    z.object({
      start_time: nativeInstant,
      end_time: nativeInstant,
      stage: z.enum(['awake', 'sleeping', 'light', 'deep', 'rem', 'unknown', 'out_of_bed']),
    })
  )
  .max(1000);

export function recordMetricValues(record: NativeRecord): NativeMetricValue[] {
  const day = nativeRecordDay(record);
  const metadata = {
    health_connect: true,
    source_package: record.source_package,
    source_record_id: record.record_id,
    source_modified_at: record.source_modified_at,
    observed_at: record.start_time,
    observed_end_at: record.end_time ?? null,
    timezone: getHealthTrackTimeZone(),
  };
  const build = (metricKey: string, value: number, unit: string): NativeMetricValue => {
    const intraday = getMetric(metricKey)?.intraday;
    const normalized = validateVitalWrite({
      metricKey,
      value,
      unit,
      source: nativeSource(record.source_package),
      recordedAt: intraday ? record.start_time : `${day}T00:00:00Z`,
    });
    return {
      metricKey,
      value: normalized.value,
      unit: normalized.unit ?? unit,
      recordedAt: normalized.recordedAt,
      nativeRecordId: intraday ? nativeObservationId(record) : null,
      metadata,
    };
  };
  if (record.record_type === 'blood_pressure') {
    const parsed = z
      .object({
        systolic: z.number().finite().positive(),
        diastolic: z.number().finite().positive(),
        unit: z.literal('mmHg'),
      })
      .safeParse(record.data);
    if (!parsed.success) return [];
    return [
      build('bp_systolic', parsed.data.systolic, 'mmHg'),
      build('bp_diastolic', parsed.data.diastolic, 'mmHg'),
    ];
  }
  if (record.record_type === 'sleep') {
    if (!record.end_time) return [];
    const parsed = stagesSchema.safeParse(record.data.stages);
    if (!parsed.success || parsed.data.length === 0) return [];
    const start = Date.parse(record.start_time),
      end = Date.parse(record.end_time);
    const stages = parsed.data
      .map((s) => ({
        start: Date.parse(s.start_time),
        end: Date.parse(s.end_time),
        stage: s.stage,
      }))
      .sort((a, b) => a.start - b.start);
    if (
      stages.some(
        (s, i) =>
          s.start < start ||
          s.end > end ||
          s.end <= s.start ||
          (i > 0 && s.start < stages[i - 1].end)
      )
    )
      return [];
    const complete =
      stages[0].start === start &&
      stages.at(-1)!.end === end &&
      stages.every((s, i) => s.stage !== 'unknown' && (i === 0 || s.start === stages[i - 1].end));
    const result: NativeMetricValue[] = [];
    const stageKeys = {
      deep: 'deep_sleep',
      light: 'light_sleep',
      rem: 'rem_sleep',
      awake: 'awake_time',
    } as const;
    for (const [stage, key] of Object.entries(stageKeys)) {
      const matching = stages.filter((s) => s.stage === stage);
      // Missing stages stay unknown, even when another stage was supplied.
      if (matching.length)
        result.push(build(key, matching.reduce((n, s) => n + s.end - s.start, 0) / 60000, 'min'));
    }
    if (complete) {
      const asleep = stages.filter((s) => ['sleeping', 'light', 'deep', 'rem'].includes(s.stage));
      result.push(
        build('sleep_duration', asleep.reduce((n, s) => n + s.end - s.start, 0) / 3600000, 'hours')
      );
      result.push(build('time_in_bed', (end - start) / 60000, 'min'));
    }
    return result.map((v) => ({
      ...v,
      metadata: { ...v.metadata, stage_coverage_complete: complete },
    }));
  }
  const key = NATIVE_METRIC_KEYS[record.record_type]?.[0];
  if (!key) return [];
  const parsed = scalar.safeParse(record.data);
  if (!parsed.success) return [];
  let { value, unit } = parsed.data;
  if (['body_temperature', 'basal_body_temperature'].includes(record.record_type)) {
    if (unit === '°C' || unit === 'C') {
      value = (value * 9) / 5 + 32;
      unit = '°F';
    }
  } else if (value < 0) return [];
  if (record.record_type === 'hydration') {
    if (unit === 'L') {
      value *= 33.814022701843;
      unit = 'oz';
    }
    if (unit === 'mL') {
      value /= 29.5735295625;
      unit = 'oz';
    }
  }
  if (record.record_type === 'blood_glucose' && unit === 'mmol/L') {
    value *= 18.0182;
    unit = 'mg/dL';
  }
  if (
    (record.record_type === 'oxygen_saturation' || record.record_type === 'body_fat') &&
    value > 100
  )
    return [];
  try {
    return [build(key, value, unit)];
  } catch {
    return [];
  }
}

/** Source-local day collapse. BP/glucose preserve every native UUID; other
 * metrics use their registry semantic. Sleep chooses one complete session at
 * a time, so overlapping sessions cannot double-count a night. */
export function collapseNativeDay(records: NativeRecord[]): {
  values: NativeMetricValue[];
  invalid: number;
} {
  let invalid = 0;
  const candidates = records
    .map((record) => {
      const values = recordMetricValues(record);
      if (!values.length) invalid++;
      return { record, values };
    })
    .filter((r) => r.values.length);
  if (records[0]?.record_type === 'sleep') {
    candidates.sort(
      (a, b) =>
        b.record.source_modified_at.localeCompare(a.record.source_modified_at) ||
        (b.record.end_time ?? '').localeCompare(a.record.end_time ?? '') ||
        b.record.record_id.localeCompare(a.record.record_id)
    );
    const sessions = records
      .flatMap((record) => {
        const parsed = stagesSchema.safeParse(record.data.stages);
        if (!record.end_time || !parsed.success || !parsed.data.length) return [];
        const start = Date.parse(record.start_time),
          end = Date.parse(record.end_time);
        const stages = parsed.data
          .map((s) => ({
            start: Date.parse(s.start_time),
            end: Date.parse(s.end_time),
            stage: s.stage,
          }))
          .sort((a, b) => a.start - b.start);
        if (
          stages.some(
            (s, i) =>
              s.start < start ||
              s.end > end ||
              s.end <= s.start ||
              (i > 0 && s.start < stages[i - 1].end)
          )
        )
          return [];
        return [{ record, start, end, stages }];
      })
      .sort(
        (a, b) =>
          b.record.source_modified_at.localeCompare(a.record.source_modified_at) ||
          (b.record.end_time ?? '').localeCompare(a.record.end_time ?? '') ||
          b.record.record_id.localeCompare(a.record.record_id)
      );
    if (!sessions.length) return { values: [], invalid: records.length };
    invalid = records.length - sessions.length;
    const boundaries = [
      ...new Set(
        sessions.flatMap((s) => [
          s.start,
          s.end,
          ...s.stages.flatMap((stage) => [stage.start, stage.end]),
        ])
      ),
    ].sort((a, b) => a - b);
    const durations = new Map<string, number>();
    let complete = true;
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i],
        end = boundaries[i + 1];
      // Newest source modification wins where two sessions overlap. Each
      // actual millisecond contributes at most once, including naps.
      const covering = sessions.find((s) => s.start <= start && s.end >= end);
      if (!covering) continue;
      const stage =
        covering.stages.find((s) => s.start <= start && s.end >= end)?.stage ?? 'unknown';
      if (stage === 'unknown') complete = false;
      durations.set(stage, (durations.get(stage) ?? 0) + end - start);
    }
    const first = sessions[0].record;
    const prototype: NativeMetricValue = {
      metricKey: 'sleep_duration',
      value: 0,
      unit: 'hours',
      recordedAt: `${nativeRecordDay(first)}T00:00:00Z`,
      nativeRecordId: null,
      metadata: {
        health_connect: true,
        source_package: first.source_package,
        source_record_id: first.record_id,
        observed_at: first.start_time,
        observed_end_at: first.end_time,
        source_modified_at: first.source_modified_at,
        timezone: getHealthTrackTimeZone(),
      },
    };
    const result: NativeMetricValue[] = [];
    const add = (metricKey: string, value: number, unit: string) =>
      result.push({
        ...prototype,
        metricKey,
        value,
        unit,
        metadata: {
          ...prototype.metadata,
          record_count: sessions.length,
          aggregation: 'interval_union',
          stage_coverage_complete: complete,
        },
      });
    for (const [stage, key] of Object.entries({
      deep: 'deep_sleep',
      light: 'light_sleep',
      rem: 'rem_sleep',
      awake: 'awake_time',
    })) {
      const duration = durations.get(stage);
      if (duration !== undefined) add(key, duration / 60000, 'min');
    }
    if (complete) {
      const asleep = ['sleeping', 'light', 'deep', 'rem'].reduce(
        (n, s) => n + (durations.get(s) ?? 0),
        0
      );
      const inBed = ['awake', 'sleeping', 'light', 'deep', 'rem'].reduce(
        (n, s) => n + (durations.get(s) ?? 0),
        0
      );
      add('sleep_duration', asleep / 3600000, 'hours');
      add('time_in_bed', inBed / 60000, 'min');
    }
    return { values: result, invalid };
  }
  const metrics = new Map<string, Array<{ record: NativeRecord; value: NativeMetricValue }>>();
  for (const candidate of candidates)
    for (const value of candidate.values) {
      const bucket = metrics.get(value.metricKey) ?? [];
      bucket.push({ record: candidate.record, value });
      metrics.set(value.metricKey, bucket);
    }
  const values: NativeMetricValue[] = [];
  for (const [key, bucket] of metrics) {
    if (getMetric(key)?.intraday) {
      values.push(...bucket.map((r) => r.value));
      continue;
    }
    bucket.sort(
      (a, b) =>
        b.record.start_time.localeCompare(a.record.start_time) ||
        b.record.record_id.localeCompare(a.record.record_id)
    );
    const selected = { ...bucket[0].value };
    const aggregate = getMetric(key)?.aggregate;
    if (aggregate === 'sum' || aggregate === 'mean')
      selected.value =
        bucket.reduce((n, r) => n + r.value.value, 0) / (aggregate === 'mean' ? bucket.length : 1);
    selected.metadata = {
      ...selected.metadata,
      record_count: bucket.length,
      aggregation: aggregate,
    };
    values.push(selected);
  }
  return { values, invalid };
}
