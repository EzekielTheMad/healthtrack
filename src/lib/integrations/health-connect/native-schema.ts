/** First-party Android delivery protocol. Versions are explicit: this is not
 * the Life Dashboard webhook envelope. Bodies are signed before parsing. */
import { z } from 'zod';

export const NATIVE_PROTOCOL_VERSION = 2;
export const NATIVE_MAX_BODY_BYTES = 1024 * 1024;
export const NATIVE_MAX_RECORDS = 500;
export const NATIVE_RECORD_TYPES = [
  'nutrition',
  'weight',
  'body_fat',
  'resting_heart_rate',
  'heart_rate_variability',
  'oxygen_saturation',
  'respiratory_rate',
  'blood_pressure',
  'blood_glucose',
  'body_temperature',
  'basal_body_temperature',
  'vo2_max',
  'hydration',
  'sleep',
] as const;
export const nativeInstant = z
  .string()
  .max(40)
  .datetime({ offset: true })
  .refine((s) => {
    const y = new Date(s).getUTCFullYear();
    return y >= 1900 && y <= 2100;
  });
/** Keep Health Connect's nanosecond modification precision while obtaining a
 * lexically sortable UTC instant. Date.toISOString alone truncates revisions
 * that occurred inside the same millisecond. */
export function canonicalNativeInstant(value: string): string {
  const utc = new Date(value).toISOString();
  const fraction = (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0').slice(0, 9);
  return `${utc.slice(0, 19)}.${fraction}Z`;
}
export const nativeDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const id = z.string().min(1).max(255);
const recordType = z
  .string()
  .regex(/^[a-z][a-z_]{0,63}$/)
  .refine((type) => type !== 'daily_totals', 'daily_totals requires a daily_snapshot event');
const pkg = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.]+$/);

export const nativeRecordSchema = z
  .object({
    record_type: recordType,
    source_package: pkg,
    record_id: id,
    start_time: nativeInstant,
    end_time: nativeInstant.optional(),
    source_modified_at: nativeInstant,
    data: z.record(z.string(), z.unknown()).refine((data) => JSON.stringify(data).length <= 65536),
  })
  .strict()
  .refine(
    (r) => !r.end_time || Date.parse(r.end_time) > Date.parse(r.start_time),
    'end_time must follow start_time'
  );

export const nativeNutritionDataSchema = z
  .object({
    calories: z.number().finite().nonnegative().nullish(),
    protein_grams: z.number().finite().nonnegative().nullish(),
    carbs_grams: z.number().finite().nonnegative().nullish(),
    fat_grams: z.number().finite().nonnegative().nullish(),
  })
  .refine((data) => Object.values(data).some((v) => typeof v === 'number'));

const scanScope = z
  .object({
    scan_id: z.string().uuid(),
    record_type: recordType,
    source_packages: z.array(pkg).min(1).max(100),
    start_time: nativeInstant,
    end_time: nativeInstant,
  })
  .strict()
  .refine(
    (s) =>
      Date.parse(s.end_time) > Date.parse(s.start_time) &&
      Date.parse(s.end_time) - Date.parse(s.start_time) <= 400 * 86400000,
    'scan window must be positive and at most 400 days'
  );

export const nativeEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('upsert'), record: nativeRecordSchema }).strict(),
  // DeletionChanges carries only an ID. Type/package may be omitted: all
  // matching identities inside this owner's account are then tombstoned.
  z
    .object({
      kind: z.literal('delete'),
      record_id: id,
      record_type: recordType.optional(),
      source_package: pkg.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('daily_snapshot'),
      date: nativeDay,
      values: z
        .object({
          steps: z.number().finite().nonnegative().optional(),
          distance_meters: z.number().finite().nonnegative().optional(),
          active_calories: z.number().finite().nonnegative().optional(),
          total_calories: z.number().finite().nonnegative().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rescan_begin'),
      scope: scanScope,
      // Acquire the new Changes token BEFORE scanning. Never send the token.
      cursor_anchored: z.literal(true),
      authorized: z.literal(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rescan_page'),
      scan_id: z.string().uuid(),
      page: z.number().int().nonnegative(),
      records: z.array(nativeRecordSchema).max(NATIVE_MAX_RECORDS),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rescan_complete'),
      scan_id: z.string().uuid(),
      page_count: z.number().int().nonnegative(),
      authorized: z.literal(true),
    })
    .strict(),
]);

export const nativeBatchSchema = z
  .object({
    protocol_version: z.literal(NATIVE_PROTOCOL_VERSION),
    device_generation: z.string().uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    batch_id: z.string().uuid(),
    read_at: nativeInstant,
    app_version: z.string().min(1).max(64),
    events: z.array(nativeEventSchema).max(NATIVE_MAX_RECORDS),
  })
  .strict()
  .superRefine((batch, ctx) => {
    const count = batch.events.reduce(
      (n, e) => n + (e.kind === 'rescan_page' ? e.records.length : 1),
      0
    );
    if (count > NATIVE_MAX_RECORDS)
      ctx.addIssue({ code: 'custom', message: `At most ${NATIVE_MAX_RECORDS} records per batch` });
  });

export type NativeRecord = z.infer<typeof nativeRecordSchema>;
export type NativeEvent = z.infer<typeof nativeEventSchema>;
export type NativeBatch = z.infer<typeof nativeBatchSchema>;
export interface NativeBatchResult {
  protocol_version: 2;
  batch_id: string;
  sequence: number;
  status: 'accepted';
  received_at: string;
  records: { inserted: number; updated: number; deleted: number; unchanged: number; stale: number };
  normalization: {
    vitals_upserted: number;
    vitals_deleted: number;
    nutrition_days_upserted: number;
    nutrition_days_deleted: number;
    skipped_unapproved: number;
    invalid_records: number;
  };
}
