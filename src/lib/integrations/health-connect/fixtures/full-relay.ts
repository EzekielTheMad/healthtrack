/**
 * A delivery that exercises EVERY array the pinned relay can emit — one valid
 * record each, generated against ./webhook-schema.json's required fields and
 * types (upstream commit b94f7453a2d61a69bf9866d15e37ae4fb5343e21).
 *
 * Purpose: prove the ingestion boundary can accept and inventory the complete
 * contract, not just the two types this release normalizes. Every record here
 * must be RETAINED and INVENTORIED; all but daily_totals and nutrition must
 * produce no canonical rows at all.
 *
 * Values are synthetic placeholders. Nothing here came from a real device.
 */
export const FULL_RELAY_PAYLOAD = {
  timestamp: '2026-09-01T16:30:00Z',
  app_version: '1.8.0',
  source: 'health_connect',
  backfill: false,
  window_start: '2026-08-25T00:00:00Z',
  window_end: '2026-09-01T00:00:00Z',
  _diagnostics: {
    steps: 'ok',
    sleep: 'permission_denied',
    read_duration_ms: 812,
  },
  // A field the relay does not publish yet: it must survive in the retained
  // envelope and never become health data.
  some_future_top_level_field: { hello: 'world' },
  active_calories: [
    { calories: 1.5, end_time: '2026-09-01T16:00:00Z', source: 'com.example.active_calories', start_time: '2026-09-01T15:00:00Z', uuid: 'active_calories-0001' }
  ],
  basal_body_temperature: [
    { celsius: 1.5, source: 'com.example.basal_body_temperature', time: '2026-09-01T15:00:00Z', uuid: 'basal_body_temperature-0001' }
  ],
  basal_metabolic_rate: [
    { kilocalories_per_day: 1.5, source: 'com.example.basal_metabolic_rate', time: '2026-09-01T15:00:00Z', uuid: 'basal_metabolic_rate-0001' }
  ],
  blood_glucose: [
    { mmol_per_liter: 1.5, source: 'com.example.blood_glucose', time: '2026-09-01T15:00:00Z', uuid: 'blood_glucose-0001' }
  ],
  blood_pressure: [
    { diastolic: 1.5, source: 'com.example.blood_pressure', systolic: 1.5, time: '2026-09-01T15:00:00Z', uuid: 'blood_pressure-0001' }
  ],
  body_fat: [
    { percentage: 1.5, source: 'com.example.body_fat', time: '2026-09-01T15:00:00Z', uuid: 'body_fat-0001' }
  ],
  body_temperature: [
    { celsius: 1.5, source: 'com.example.body_temperature', time: '2026-09-01T15:00:00Z', uuid: 'body_temperature-0001' }
  ],
  body_water_mass: [
    { kilograms: 1.5, source: 'com.example.body_water_mass', time: '2026-09-01T15:00:00Z', uuid: 'body_water_mass-0001' }
  ],
  bone_mass: [
    { kilograms: 1.5, source: 'com.example.bone_mass', time: '2026-09-01T15:00:00Z', uuid: 'bone_mass-0001' }
  ],
  cervical_mucus: [
    { appearance: 'x', sensation: 'x', source: 'com.example.cervical_mucus', time: '2026-09-01T15:00:00Z', uuid: 'cervical_mucus-0001' }
  ],
  daily_totals: [
    { active_calories: 1.5, date: '2026-09-01', distance_meters: 1.5, steps: 1, total_calories: 1.5 }
  ],
  distance: [
    { end_time: '2026-09-01T16:00:00Z', meters: 1.5, source: 'com.example.distance', start_time: '2026-09-01T15:00:00Z', uuid: 'distance-0001' }
  ],
  exercise: [
    { duration_seconds: 1, end_time: '2026-09-01T16:00:00Z', source: 'com.example.exercise', start_time: '2026-09-01T15:00:00Z', type: 'x', uuid: 'exercise-0001' }
  ],
  heart_rate: [
    { bpm: 1, source: 'com.example.heart_rate', time: '2026-09-01T15:00:00Z', uuid: 'heart_rate-0001' }
  ],
  heart_rate_variability: [
    { heart_rate_variability_millis: 1.5, source: 'com.example.heart_rate_variability', time: '2026-09-01T15:00:00Z', uuid: 'heart_rate_variability-0001' }
  ],
  height: [
    { meters: 1.5, source: 'com.example.height', time: '2026-09-01T15:00:00Z', uuid: 'height-0001' }
  ],
  hydration: [
    { end_time: '2026-09-01T16:00:00Z', liters: 1.5, source: 'com.example.hydration', start_time: '2026-09-01T15:00:00Z', uuid: 'hydration-0001' }
  ],
  intermenstrual_bleeding: [
    { source: 'com.example.intermenstrual_bleeding', time: '2026-09-01T15:00:00Z', uuid: 'intermenstrual_bleeding-0001' }
  ],
  lean_body_mass: [
    { kilograms: 1.5, source: 'com.example.lean_body_mass', time: '2026-09-01T15:00:00Z', uuid: 'lean_body_mass-0001' }
  ],
  menstruation_flow: [
    { flow: 'x', source: 'com.example.menstruation_flow', time: '2026-09-01T15:00:00Z', uuid: 'menstruation_flow-0001' }
  ],
  menstruation_period: [
    { end_time: '2026-09-01T16:00:00Z', source: 'com.example.menstruation_period', start_time: '2026-09-01T15:00:00Z', uuid: 'menstruation_period-0001' }
  ],
  mindfulness: [
    { duration_seconds: 1, end_time: '2026-09-01T16:00:00Z', source: 'com.example.mindfulness', start_time: '2026-09-01T15:00:00Z', title: 'x', uuid: 'mindfulness-0001' }
  ],
  nutrition: [
    { calories: 1.5, carbs_grams: 1.5, end_time: '2026-09-01T16:00:00Z', fat_grams: 1.5, protein_grams: 1.5, source: 'com.example.nutrition', start_time: '2026-09-01T15:00:00Z', uuid: 'nutrition-0001' }
  ],
  ovulation_test: [
    { result: 'x', source: 'com.example.ovulation_test', time: '2026-09-01T15:00:00Z', uuid: 'ovulation_test-0001' }
  ],
  oxygen_saturation: [
    { percentage: 1.5, source: 'com.example.oxygen_saturation', time: '2026-09-01T15:00:00Z', uuid: 'oxygen_saturation-0001' }
  ],
  respiratory_rate: [
    { rate: 1.5, source: 'com.example.respiratory_rate', time: '2026-09-01T15:00:00Z', uuid: 'respiratory_rate-0001' }
  ],
  resting_heart_rate: [
    { bpm: 1, source: 'com.example.resting_heart_rate', time: '2026-09-01T15:00:00Z', uuid: 'resting_heart_rate-0001' }
  ],
  screen_time: [
    { date: '2026-09-01', total_screen_time_minutes: 1 }
  ],
  sexual_activity: [
    { protection_used: 'x', source: 'com.example.sexual_activity', time: '2026-09-01T15:00:00Z', uuid: 'sexual_activity-0001' }
  ],
  skin_temperature: [
    { baseline_celsius: 1.5, delta_celsius: 1.5, source: 'com.example.skin_temperature', time: '2026-09-01T15:00:00Z', uuid: 'skin_temperature-0001' }
  ],
  sleep: [
    { duration_seconds: 1, session_end_time: '2026-09-01T16:00:00Z', source: 'com.example.sleep', stages: [{ stage: 'deep', start_time: '2026-09-01T06:00:00Z', end_time: '2026-09-01T07:30:00Z', duration_seconds: 5400 }], uuid: 'sleep-0001' }
  ],
  steps: [
    { count: 1, end_time: '2026-09-01T16:00:00Z', source: 'com.example.steps', start_time: '2026-09-01T15:00:00Z', uuid: 'steps-0001' }
  ],
  total_calories: [
    { calories: 1.5, end_time: '2026-09-01T16:00:00Z', source: 'com.example.total_calories', start_time: '2026-09-01T15:00:00Z', uuid: 'total_calories-0001' }
  ],
  vo2_max: [
    { source: 'com.example.vo2_max', time: '2026-09-01T15:00:00Z', uuid: 'vo2_max-0001', vo2_ml_per_min_per_kg: 1.5 }
  ],
  weight: [
    { kilograms: 1.5, source: 'com.example.weight', time: '2026-09-01T15:00:00Z', uuid: 'weight-0001' }
  ],
} as const;

/** Arrays in FULL_RELAY_PAYLOAD, for coverage assertions. */
export const FULL_RELAY_ARRAY_KEYS: string[] = Object.entries(FULL_RELAY_PAYLOAD)
  .filter(([, v]) => Array.isArray(v))
  .map(([k]) => k)
  .sort();
