/**
 * GENERATED — do not edit by hand.
 *
 * Derived from the pinned Life Dashboard webhook schema
 * (src/lib/integrations/health-connect/fixtures/webhook-schema.json,
 * upstream commit b94f7453a2d61a69bf9866d15e37ae4fb5343e21) by
 * `npm run generate:relay-schema`. A drift test re-derives this file and
 * fails if it does not match, so the wire contract has exactly one source.
 *
 * Semantics and canonical-write policy are NOT here: those are product
 * decisions and live in ../schema.ts (RECORD_TYPES).
 */
import type { RelayContract } from '../derive-relay-schema';

export const RELAY_SCHEMA_COMMIT = 'b94f7453a2d61a69bf9866d15e37ae4fb5343e21';

export const RELAY_CONTRACT: RelayContract = {
  envelopeFields: [
    { name: '_diagnostics', kind: 'object', required: false },
    { name: 'app_version', kind: 'string', required: true },
    { name: 'backfill', kind: 'boolean', required: false },
    { name: 'source', kind: 'string', required: true },
    { name: 'timestamp', kind: 'string', format: 'date-time', required: true },
    { name: 'window_end', kind: 'string', format: 'date-time', required: false },
    { name: 'window_start', kind: 'string', format: 'date-time', required: false },
  ],
  recordArrays: [
    {
      type: 'active_calories',
      fields: [
        { name: 'calories', kind: 'number', required: true },
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['calories', 'end_time', 'start_time'],
    },
    {
      type: 'basal_body_temperature',
      fields: [
        { name: 'celsius', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['celsius', 'time'],
    },
    {
      type: 'basal_metabolic_rate',
      fields: [
        { name: 'kilocalories_per_day', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['kilocalories_per_day', 'time'],
    },
    {
      type: 'blood_glucose',
      fields: [
        { name: 'mmol_per_liter', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['mmol_per_liter', 'time'],
    },
    {
      type: 'blood_pressure',
      fields: [
        { name: 'diastolic', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'systolic', kind: 'number', required: true },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['diastolic', 'systolic', 'time'],
    },
    {
      type: 'body_fat',
      fields: [
        { name: 'percentage', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['percentage', 'time'],
    },
    {
      type: 'body_temperature',
      fields: [
        { name: 'celsius', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['celsius', 'time'],
    },
    {
      type: 'body_water_mass',
      fields: [
        { name: 'kilograms', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['kilograms', 'time'],
    },
    {
      type: 'bone_mass',
      fields: [
        { name: 'kilograms', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['kilograms', 'time'],
    },
    {
      type: 'cervical_mucus',
      fields: [
        { name: 'appearance', kind: 'string', required: true },
        { name: 'sensation', kind: 'string', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['appearance', 'sensation', 'time'],
    },
    {
      type: 'daily_totals',
      fields: [
        { name: 'active_calories', kind: 'number', required: false },
        { name: 'date', kind: 'string', format: 'date', required: true },
        { name: 'distance_meters', kind: 'number', required: false },
        { name: 'steps', kind: 'integer', required: false },
        { name: 'total_calories', kind: 'number', required: false },
      ],
      required: ['date'],
    },
    {
      type: 'distance',
      fields: [
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'meters', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['end_time', 'meters', 'start_time'],
    },
    {
      type: 'exercise',
      fields: [
        { name: 'duration_seconds', kind: 'integer', required: false },
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'type', kind: 'string', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['end_time', 'start_time', 'type'],
    },
    {
      type: 'heart_rate',
      fields: [
        { name: 'bpm', kind: 'integer', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['bpm', 'time'],
    },
    {
      type: 'heart_rate_variability',
      fields: [
        { name: 'heart_rate_variability_millis', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['heart_rate_variability_millis', 'time'],
    },
    {
      type: 'height',
      fields: [
        { name: 'meters', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['meters', 'time'],
    },
    {
      type: 'hydration',
      fields: [
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'liters', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['end_time', 'liters', 'start_time'],
    },
    {
      type: 'intermenstrual_bleeding',
      fields: [
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['time'],
    },
    {
      type: 'lean_body_mass',
      fields: [
        { name: 'kilograms', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['kilograms', 'time'],
    },
    {
      type: 'menstruation_flow',
      fields: [
        { name: 'flow', kind: 'string', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['flow', 'time'],
    },
    {
      type: 'menstruation_period',
      fields: [
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['end_time', 'start_time'],
    },
    {
      type: 'mindfulness',
      fields: [
        { name: 'duration_seconds', kind: 'integer', required: false },
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'title', kind: 'string', required: false },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['end_time', 'start_time'],
    },
    {
      type: 'nutrition',
      fields: [
        { name: 'calories', kind: 'number', required: false },
        { name: 'carbs_grams', kind: 'number', required: false },
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'fat_grams', kind: 'number', required: false },
        { name: 'protein_grams', kind: 'number', required: false },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['end_time', 'start_time'],
    },
    {
      type: 'ovulation_test',
      fields: [
        { name: 'result', kind: 'string', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['result', 'time'],
    },
    {
      type: 'oxygen_saturation',
      fields: [
        { name: 'percentage', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['percentage', 'time'],
    },
    {
      type: 'respiratory_rate',
      fields: [
        { name: 'rate', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['rate', 'time'],
    },
    {
      type: 'resting_heart_rate',
      fields: [
        { name: 'bpm', kind: 'integer', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['bpm', 'time'],
    },
    {
      type: 'screen_time',
      fields: [
        { name: 'date', kind: 'string', format: 'date', required: true },
        { name: 'total_screen_time_minutes', kind: 'integer', required: false },
      ],
      required: ['date'],
    },
    {
      type: 'sexual_activity',
      fields: [
        { name: 'protection_used', kind: 'string', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['protection_used', 'time'],
    },
    {
      type: 'skin_temperature',
      fields: [
        { name: 'baseline_celsius', kind: 'number', required: false },
        { name: 'delta_celsius', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['delta_celsius', 'time'],
    },
    {
      type: 'sleep',
      fields: [
        { name: 'duration_seconds', kind: 'integer', required: true },
        { name: 'session_end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'stages', kind: 'array', required: false },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['duration_seconds', 'session_end_time'],
    },
    {
      type: 'steps',
      fields: [
        { name: 'count', kind: 'integer', required: true },
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['count', 'end_time', 'start_time'],
    },
    {
      type: 'total_calories',
      fields: [
        { name: 'calories', kind: 'number', required: true },
        { name: 'end_time', kind: 'string', format: 'date-time', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'start_time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['calories', 'end_time', 'start_time'],
    },
    {
      type: 'vo2_max',
      fields: [
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
        { name: 'vo2_ml_per_min_per_kg', kind: 'number', required: true },
      ],
      required: ['time', 'vo2_ml_per_min_per_kg'],
    },
    {
      type: 'weight',
      fields: [
        { name: 'kilograms', kind: 'number', required: true },
        { name: 'source', kind: 'string', required: false },
        { name: 'time', kind: 'string', format: 'date-time', required: true },
        { name: 'uuid', kind: 'string', required: false },
      ],
      required: ['kilograms', 'time'],
    },
  ],
};

/** Every record array key the pinned relay can emit. */
export const RELAY_RECORD_ARRAY_KEYS: readonly string[] =
  RELAY_CONTRACT.recordArrays.map((a) => a.type);
