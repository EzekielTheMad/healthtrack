/**
 * Life Dashboard payload fixtures.
 *
 * PROVENANCE — these are constructed to match the upstream contract exactly,
 * not invented shapes:
 *  - field names and required-ness come from the checked-in
 *    ./webhook-schema.json (pinned commit b94f7453a2d6…);
 *  - envelope assembly (timestamp / app_version / source, the backfill extra
 *    fields, and which keys appear only when non-empty) mirrors
 *    HealthSyncManager.buildJsonPayload at that commit;
 *  - TEST_PING is the literal payload HealthConnectScreen.kt sends from
 *    "Send Test Ping" — note it carries NO app_version, which is exactly why
 *    the receiver recognises it separately from a health envelope.
 *
 * Values are synthetic. Nothing here was captured from a real phone or a real
 * person's health data; the one thing a real device must still confirm is the
 * MacroFactor package name the inventory reports (see docs/health-connect.md).
 */

/** "Send Test Ping" — no app_version, no record arrays. */
export const TEST_PING = {
  test: true,
  message: 'Test ping from Life Dashboard Companion',
  timestamp: '2026-09-01T16:00:00Z',
  source: 'health_connect',
} as const;

/**
 * A representative "Preview Data" / normal sync payload: daily totals, a
 * MacroFactor food log, and records from sources that must stay raw-only
 * (Oura sleep, a Renpho weigh-in, a generic exercise session).
 */
export const PREVIEW_PAYLOAD = {
  timestamp: '2026-09-01T16:00:00Z',
  app_version: '1.8.0',
  source: 'health_connect',
  daily_totals: [
    {
      date: '2026-08-31',
      steps: 11240,
      distance_meters: 8046.72, // exactly 5.00 mi
      active_calories: 612.5,
      total_calories: 2430.0,
    },
    {
      date: '2026-09-01',
      steps: 4180,
      distance_meters: 3218.688, // exactly 2.00 mi
      active_calories: 240.0,
    },
  ],
  nutrition: [
    {
      calories: 520,
      protein_grams: 42.5,
      carbs_grams: 38,
      fat_grams: 18.5,
      start_time: '2026-09-01T14:05:00Z', // 07:05 Phoenix
      end_time: '2026-09-01T14:05:00Z',
      source: 'com.sbs.diet',
      uuid: 'mf-record-0001',
    },
    {
      calories: 740,
      protein_grams: 55,
      carbs_grams: 61,
      fat_grams: 24,
      start_time: '2026-09-01T19:30:00Z', // 12:30 Phoenix
      end_time: '2026-09-01T19:30:00Z',
      source: 'com.sbs.diet',
      uuid: 'mf-record-0002',
    },
  ],
  sleep: [
    {
      session_end_time: '2026-09-01T13:10:00Z',
      duration_seconds: 26400,
      stages: [
        { stage: 'deep', start_time: '2026-09-01T06:00:00Z', end_time: '2026-09-01T07:30:00Z' },
      ],
      source: 'com.ouraring.oura',
      uuid: 'oura-sleep-0001',
    },
  ],
  weight: [
    {
      kilograms: 88.9,
      time: '2026-09-01T13:40:00Z',
      source: 'com.renpho.healthcare',
      uuid: 'renpho-weight-0001',
    },
  ],
  exercise: [
    {
      type: 'strength_training',
      start_time: '2026-09-01T15:00:00Z',
      end_time: '2026-09-01T16:05:00Z',
      duration_seconds: 3900,
      source: 'com.google.android.apps.fitness',
      uuid: 'exercise-0001',
    },
  ],
} as const;

/** A backfill delivery: same shape plus the three backfill extra fields. */
export const BACKFILL_PAYLOAD = {
  timestamp: '2026-09-01T17:00:00Z',
  app_version: '1.8.0',
  source: 'health_connect',
  backfill: true,
  window_start: '2026-08-25T00:00:00Z',
  window_end: '2026-09-01T00:00:00Z',
  nutrition: [
    // Overlaps PREVIEW_PAYLOAD's first record verbatim — must not duplicate.
    {
      calories: 520,
      protein_grams: 42.5,
      carbs_grams: 38,
      fat_grams: 18.5,
      start_time: '2026-09-01T14:05:00Z',
      end_time: '2026-09-01T14:05:00Z',
      source: 'com.sbs.diet',
      uuid: 'mf-record-0001',
    },
  ],
} as const;

/** MacroFactor package name observed in the Play Store listing for
    "MacroFactor — Macro Tracker". The integration still requires the user to
    approve whatever the inventory actually reports; this is a fixture value,
    never a built-in allowlist. */
export const MACROFACTOR_PACKAGE = 'com.sbs.diet';
