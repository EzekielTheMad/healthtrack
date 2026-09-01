/**
 * Life Dashboard webhook envelope — validation, limits, and the per-type
 * ingestion semantics table.
 *
 * Upstream contract (PINNED, never fetched at runtime — PRD §6.3):
 *   repo:   owen282000/life-dashboard-companion-app
 *   file:   docs/webhook-schema.json
 *   commit: b94f7453a2d61a69bf9866d15e37ae4fb5343e21 (2026-08-27)
 * The schema itself is checked in at ./fixtures/webhook-schema.json and the
 * RECORD_TYPES table below is pinned against it by schema.test.ts, so an
 * upstream field rename cannot drift silently past us.
 *
 * Validation is deliberately SHALLOW on record bodies: only the fields we
 * need for identity, time and normalization are parsed. Everything else —
 * including unknown top-level keys and unknown record fields — is retained
 * verbatim in the raw layer and never becomes normalized health data.
 */
import { z } from 'zod';

/** Upstream schema pin, surfaced in the docs and asserted by tests. */
export const UPSTREAM_SCHEMA_COMMIT = 'b94f7453a2d61a69bf9866d15e37ae4fb5343e21';
export const UPSTREAM_SCHEMA_URL =
  'https://github.com/owen282000/life-dashboard-companion-app/blob/main/docs/webhook-schema.json';

// ---------------------------------------------------------------------------
// Limits (PRD §6.3). Every one is a bound on client-controlled size.
// ---------------------------------------------------------------------------

/** Maximum raw request body, in bytes. Override with HEALTH_CONNECT_MAX_BODY_BYTES. */
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB
/** Maximum record arrays in one payload (upstream publishes 34 + daily_totals). */
export const MAX_ARRAYS_PER_PAYLOAD = 64;
/** Maximum records in any single array. */
export const MAX_RECORDS_PER_ARRAY = 5000;
/** Maximum records across the whole payload. */
export const MAX_RECORDS_PER_PAYLOAD = 20000;
/** Maximum characters for a source package name. */
export const MAX_SOURCE_PACKAGE_CHARS = 255;
/** Maximum characters for a source uuid. */
export const MAX_UUID_CHARS = 255;
/** Maximum characters of JSON for one retained raw record. */
export const MAX_RECORD_JSON_CHARS = 64 * 1024;
/** Maximum characters of JSON for the retained envelope shell. */
export const RAW_ENVELOPE_MAX_CHARS = 64 * 1024;
/** Supported timestamp range (matches validateVitalWrite's 1900–2100 rule). */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export function maxBodyBytes(): number {
  const raw = process.env.HEALTH_CONNECT_MAX_BODY_BYTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BODY_BYTES;
}

// ---------------------------------------------------------------------------
// Record semantics (PRD §6.8)
//
// Every supported type declares ONE semantic. Types we do not normalize stay
// raw-only rather than inheriting an unsafe default, and the reason is
// recorded here so a future normalizer starts from the decision, not a guess.
// ---------------------------------------------------------------------------

export type RecordSemantic =
  /** One canonical row per (user, Phoenix date, metric, source). A newer sync
      REPLACES the row; the incoming value is never added to the stored one. */
  | 'daily_snapshot'
  /** Recompute the whole day from retained deduplicated records, then
      overwrite the canonical daily row. */
  | 'daily_aggregate'
  /** Retain every observation; expose the latest valid one for the day. */
  | 'latest_observation'
  /** Preserve each stable source UUID separately; never collapse by date. */
  | 'discrete_event'
  /** Preserve timestamped samples; never overwrite a day with one sample. */
  | 'intraday_series';

export interface RecordTypeDef {
  /** Envelope array key. */
  type: string;
  /** Field naming the record's start instant (or its only instant). */
  startField: string;
  /** Field naming the record's end instant, when the type has a span. */
  endField?: string;
  /** Declared ingestion semantic — required even for raw-only types. */
  semantic: RecordSemantic;
  /** Whether this release writes canonical rows for the type. */
  normalized: boolean;
  /** Why a type is raw-only (source ownership, privacy, or not-yet-modelled). */
  note?: string;
}

/**
 * Every array the pinned upstream schema can emit, with its time fields and
 * declared semantic. `normalized: true` on exactly two types in this release
 * (PRD §1): daily activity totals and MacroFactor nutrition.
 */
export const RECORD_TYPES: readonly RecordTypeDef[] = [
  // ── Normalized in this release ────────────────────────────────────────────
  {
    type: 'daily_totals',
    startField: 'date',
    semantic: 'daily_snapshot',
    normalized: true,
    note: "Health Connect's aggregate API already deduplicates phone + watch; replace the day rather than summing raw interval records.",
  },
  {
    type: 'nutrition',
    startField: 'start_time',
    endField: 'end_time',
    semantic: 'daily_aggregate',
    normalized: true,
    note: 'Recomputed per Phoenix date from retained deduplicated records; one canonical row per (user, date, package).',
  },

  // ── Raw-only: owned by a direct bridge (PRD §6.9) ─────────────────────────
  { type: 'sleep', startField: 'session_end_time', semantic: 'discrete_event', normalized: false, note: 'Direct Oura bridge remains authoritative; naps must not overwrite one another.' },
  { type: 'heart_rate_variability', startField: 'time', semantic: 'intraday_series', normalized: false, note: 'Oura owns HRV.' },
  { type: 'resting_heart_rate', startField: 'time', semantic: 'latest_observation', normalized: false, note: 'Oura owns resting heart rate.' },
  { type: 'weight', startField: 'time', semantic: 'latest_observation', normalized: false, note: 'Renpho owns weight; enable only after a shadow comparison.' },
  { type: 'body_fat', startField: 'time', semantic: 'latest_observation', normalized: false, note: 'Renpho owns body composition.' },
  { type: 'lean_body_mass', startField: 'time', semantic: 'latest_observation', normalized: false, note: 'Renpho owns body composition.' },
  { type: 'bone_mass', startField: 'time', semantic: 'latest_observation', normalized: false, note: 'Renpho owns body composition.' },
  { type: 'body_water_mass', startField: 'time', semantic: 'latest_observation', normalized: false, note: 'Renpho owns body composition.' },
  { type: 'basal_metabolic_rate', startField: 'time', semantic: 'latest_observation', normalized: false, note: 'Renpho owns BMR.' },
  { type: 'oxygen_saturation', startField: 'time', semantic: 'intraday_series', normalized: false, note: 'myAir/Oura own respiratory metrics.' },
  { type: 'respiratory_rate', startField: 'time', semantic: 'intraday_series', normalized: false, note: 'myAir/Oura own respiratory metrics.' },

  // ── Raw-only: context or not yet modelled ─────────────────────────────────
  { type: 'steps', startField: 'start_time', endField: 'end_time', semantic: 'intraday_series', normalized: false, note: 'Superseded by daily_totals, which deduplicates overlapping sources.' },
  { type: 'distance', startField: 'start_time', endField: 'end_time', semantic: 'intraday_series', normalized: false, note: 'Superseded by daily_totals.' },
  { type: 'active_calories', startField: 'start_time', endField: 'end_time', semantic: 'intraday_series', normalized: false, note: 'Superseded by daily_totals.' },
  { type: 'total_calories', startField: 'start_time', endField: 'end_time', semantic: 'intraday_series', normalized: false, note: 'Superseded by daily_totals.' },
  { type: 'exercise', startField: 'start_time', endField: 'end_time', semantic: 'discrete_event', normalized: false, note: 'Context only — a generic Health Connect session is NEVER a completed named strength workout.' },
  { type: 'mindfulness', startField: 'start_time', endField: 'end_time', semantic: 'discrete_event', normalized: false },
  { type: 'hydration', startField: 'start_time', endField: 'end_time', semantic: 'daily_aggregate', normalized: false, note: 'If enabled later: sum current deduplicated records for the day and overwrite; never add a subtotal to stored state.' },
  { type: 'heart_rate', startField: 'time', semantic: 'intraday_series', normalized: false },
  { type: 'blood_pressure', startField: 'time', semantic: 'discrete_event', normalized: false, note: 'Systolic and diastolic share one observation identity and timestamp.' },
  { type: 'blood_glucose', startField: 'time', semantic: 'intraday_series', normalized: false },
  { type: 'body_temperature', startField: 'time', semantic: 'intraday_series', normalized: false },
  { type: 'basal_body_temperature', startField: 'time', semantic: 'latest_observation', normalized: false },
  { type: 'skin_temperature', startField: 'time', semantic: 'intraday_series', normalized: false },
  { type: 'height', startField: 'time', semantic: 'latest_observation', normalized: false },
  { type: 'vo2_max', startField: 'time', semantic: 'latest_observation', normalized: false },
  { type: 'screen_time', startField: 'date', semantic: 'daily_snapshot', normalized: false, note: 'Out of scope this release (PRD §4).' },

  // ── Raw-only: reproductive health, out of scope pending privacy review ────
  { type: 'menstruation_period', startField: 'start_time', endField: 'end_time', semantic: 'discrete_event', normalized: false, note: 'Out of scope pending a defined product use and privacy review.' },
  { type: 'menstruation_flow', startField: 'time', semantic: 'discrete_event', normalized: false, note: 'Out of scope pending privacy review.' },
  { type: 'intermenstrual_bleeding', startField: 'time', semantic: 'discrete_event', normalized: false, note: 'Out of scope pending privacy review.' },
  { type: 'ovulation_test', startField: 'time', semantic: 'discrete_event', normalized: false, note: 'Out of scope pending privacy review.' },
  { type: 'cervical_mucus', startField: 'time', semantic: 'discrete_event', normalized: false, note: 'Out of scope pending privacy review.' },
  { type: 'sexual_activity', startField: 'time', semantic: 'discrete_event', normalized: false, note: 'Out of scope pending privacy review.' },
];

const RECORD_TYPE_BY_KEY = new Map(RECORD_TYPES.map((r) => [r.type, r]));

export function getRecordType(type: string): RecordTypeDef | undefined {
  return RECORD_TYPE_BY_KEY.get(type);
}

/** Types this release can write canonical rows for. */
export const NORMALIZABLE_TYPES: readonly string[] = RECORD_TYPES.filter(
  (r) => r.normalized,
).map((r) => r.type);

/**
 * Source package recorded for `daily_totals`. Those entries come from Health
 * Connect's aggregate API, not from an app, so they carry no `source` — the
 * relay is the only possible writer and there is nothing to allowlist.
 */
export const AGGREGATE_SOURCE_PACKAGE = 'health_connect_aggregate';

/** Placeholder package for records delivered without a `source` field. */
export const UNKNOWN_SOURCE_PACKAGE = 'unknown';

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

/** ISO 8601 instant or date, within the supported year range. */
const isoTimestamp = z
  .string()
  .min(1)
  .max(64)
  .refine((v) => isSupportedTimestamp(v), {
    message: 'must be an ISO 8601 timestamp between 1900 and 2100',
  });

export function isSupportedTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return false;
  const year = t.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

/**
 * Top-level envelope. `.passthrough()` on purpose: unknown top-level fields
 * MUST survive into the retained raw envelope (PRD §6.3) — they simply never
 * become normalized health data, because normalization only ever reads the
 * known arrays in RECORD_TYPES.
 */
export const envelopeSchema = z
  .object({
    timestamp: isoTimestamp,
    // Required upstream (the pinned schema's `required` array, and
    // HealthSyncManager.buildJsonPayload always sets it). Requiring it here
    // also cleanly separates a health envelope from the "Send Test Ping"
    // payload, which carries no app_version.
    app_version: z.string().min(1).max(64),
    source: z.literal('health_connect', {
      message: "source must be 'health_connect' for this endpoint",
    }),
    backfill: z.boolean().optional(),
    window_start: isoTimestamp.optional(),
    window_end: isoTimestamp.optional(),
  })
  .loose();

export type Envelope = z.infer<typeof envelopeSchema>;

/**
 * The companion app's "Send Test Ping" payload, which is NOT a health
 * envelope — it carries no app_version and no record arrays:
 *   {"test":true,"message":"…","timestamp":"…","source":"health_connect"}
 * (verified against HealthConnectScreen.kt at the pinned upstream commit).
 * Recognised explicitly so a test ping returns 2xx instead of a schema 400.
 */
export const testPingSchema = z
  .object({
    test: z.literal(true),
    message: z.string().max(512).optional(),
    timestamp: z.string().max(64).optional(),
    source: z.string().max(64).optional(),
  })
  .loose();

export function isTestPing(body: unknown): boolean {
  return testPingSchema.safeParse(body).success;
}

/** A record body, shallow-parsed for identity, time and source. */
export const rawRecordFieldsSchema = z
  .object({
    uuid: z.string().max(MAX_UUID_CHARS).optional(),
    source: z.string().max(MAX_SOURCE_PACKAGE_CHARS).optional(),
  })
  .loose();

/** One `daily_totals` entry. Every metric is optional — a missing metric is
    unknown, not zero, and simply produces no vitals row. */
export const dailyTotalsSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    steps: z.number().finite().nonnegative().optional(),
    distance_meters: z.number().finite().nonnegative().optional(),
    active_calories: z.number().finite().nonnegative().optional(),
    total_calories: z.number().finite().nonnegative().optional(),
  })
  .loose();

export type DailyTotalsEntry = z.infer<typeof dailyTotalsSchema>;

/** One `nutrition` entry. Nutrient fields are nullable/optional: absent means
    UNKNOWN and must never be coerced to zero (PRD §6.7). */
export const nutritionRecordSchema = z
  .object({
    calories: z.number().finite().nullish(),
    protein_grams: z.number().finite().nullish(),
    carbs_grams: z.number().finite().nullish(),
    fat_grams: z.number().finite().nullish(),
    start_time: isoTimestamp,
    end_time: isoTimestamp.optional(),
    source: z.string().max(MAX_SOURCE_PACKAGE_CHARS).optional(),
    uuid: z.string().max(MAX_UUID_CHARS).optional(),
  })
  .loose();

export type NutritionRecord = z.infer<typeof nutritionRecordSchema>;
