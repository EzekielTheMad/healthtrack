/**
 * MacroFactor nutrition regression fixture — 16 `com.sbs.diet` item records
 * spanning two America/Phoenix calendar dates.
 *
 * PROVENANCE. The SHAPE is the pinned relay contract: field names, types and
 * required-ness come from ./webhook-schema.json at upstream commit
 * b94f7453a2d61a69bf9866d15e37ae4fb5343e21, and MacroFactor's real behaviour
 * confirmed on device — individual food records, each with a stable Health
 * Connect UUID, and NO mutable daily-summary record. The per-day TOTALS are
 * the ones a real 1.8.0 delivery produced on this account (see
 * EXPECTED_DAILY_TOTALS); the per-item split that adds up to them is
 * reconstructed, not captured, so no real food log is checked in here.
 *
 * The item values carry three decimals on purpose: Health Connect hands the
 * relay IEEE-754 doubles, so summing them is exactly where float noise shows
 * up. Tests compare with a small tolerance and the store keeps full precision
 * — rounding is a DISPLAY concern (PRD §6.7).
 */

/** The 16 retained item records, in delivery order. */
export const MACROFACTOR_ITEMS = [
  {
    calories: 135.731,
    protein_grams: 39.923,
    carbs_grams: 3.015,
    fat_grams: 3.684,
    start_time: '2026-08-31T13:42:00Z',
    end_time: '2026-08-31T13:42:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-01',
  },
  {
    calories: 441.457,
    protein_grams: 28.755,
    carbs_grams: 13.371,
    fat_grams: 13.261,
    start_time: '2026-08-31T14:15:00Z',
    end_time: '2026-08-31T14:15:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-02',
  },
  {
    calories: 114.472,
    protein_grams: 9.605,
    carbs_grams: 32.754,
    fat_grams: 5.289,
    start_time: '2026-08-31T16:58:00Z',
    end_time: '2026-08-31T16:58:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-03',
  },
  {
    calories: 76.802,
    protein_grams: 1.869,
    carbs_grams: 26.54,
    fat_grams: 10.829,
    start_time: '2026-08-31T19:05:00Z',
    end_time: '2026-08-31T19:05:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-04',
  },
  {
    calories: 184.847,
    protein_grams: 2.601,
    carbs_grams: 15.512,
    fat_grams: 5.66,
    start_time: '2026-08-31T19:31:00Z',
    end_time: '2026-08-31T19:31:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-05',
  },
  {
    calories: 205.936,
    protein_grams: 39.666,
    carbs_grams: 4.796,
    fat_grams: 6.612,
    start_time: '2026-08-31T22:20:00Z',
    end_time: '2026-08-31T22:20:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-06',
  },
  {
    calories: 219.993,
    protein_grams: 5.351,
    carbs_grams: 26.503,
    fat_grams: 7.629,
    start_time: '2026-09-01T00:44:00Z',
    end_time: '2026-09-01T00:44:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-07',
  },
  {
    calories: 272.302,
    protein_grams: 38.018,
    carbs_grams: 48.225,
    fat_grams: 4.535,
    start_time: '2026-09-01T01:02:00Z',
    end_time: '2026-09-01T01:02:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-08',
  },
  {
    calories: 326.019,
    protein_grams: 5.484,
    carbs_grams: 5.48,
    fat_grams: 10.025,
    start_time: '2026-09-01T02:35:00Z',
    end_time: '2026-09-01T02:35:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-09',
  },
  {
    calories: 169.54,
    protein_grams: 19.641,
    carbs_grams: 23.695,
    fat_grams: 3.403,
    start_time: '2026-09-01T04:10:00Z',
    end_time: '2026-09-01T04:10:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260831-10',
  },
  {
    calories: 141.018,
    protein_grams: 20.593,
    carbs_grams: 10.879,
    fat_grams: 3.039,
    start_time: '2026-09-01T13:38:00Z',
    end_time: '2026-09-01T13:38:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260901-01',
  },
  {
    calories: 19.84,
    protein_grams: 6.172,
    carbs_grams: 9.374,
    fat_grams: 4.35,
    start_time: '2026-09-01T14:04:00Z',
    end_time: '2026-09-01T14:04:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260901-02',
  },
  {
    calories: 52.691,
    protein_grams: 59.678,
    carbs_grams: 1.049,
    fat_grams: 1.844,
    start_time: '2026-09-01T17:22:00Z',
    end_time: '2026-09-01T17:22:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260901-03',
  },
  {
    calories: 65.813,
    protein_grams: 28.974,
    carbs_grams: 8.752,
    fat_grams: 9.123,
    start_time: '2026-09-01T19:14:00Z',
    end_time: '2026-09-01T19:14:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260901-04',
  },
  {
    calories: 377.119,
    protein_grams: 10.468,
    carbs_grams: 5.878,
    fat_grams: 3.97,
    start_time: '2026-09-01T20:47:00Z',
    end_time: '2026-09-01T20:47:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260901-05',
  },
  {
    calories: 374.387,
    protein_grams: 3.43,
    carbs_grams: 43.083,
    fat_grams: 1.26,
    start_time: '2026-09-01T23:05:00Z',
    end_time: '2026-09-01T23:05:00Z',
    source: 'com.sbs.diet',
    uuid: 'mf-20260901-06',
  },
] as const;

/**
 * The canonical rows `sum_items` must produce from MACROFACTOR_ITEMS. Both
 * days are complete: every item reported all four nutrients.
 */
export const EXPECTED_DAILY_TOTALS = [
  {
    date: '2026-08-31',
    calories: 2147.099,
    proteinGrams: 190.913,
    carbsGrams: 199.891,
    fatGrams: 70.927,
    recordCount: 10,
  },
  {
    date: '2026-09-01',
    calories: 1030.868,
    proteinGrams: 129.315,
    carbsGrams: 79.015,
    fatGrams: 23.586,
    recordCount: 6,
  },
] as const;

/** A full envelope carrying all 16 records, as the relay would deliver them. */
export const MACROFACTOR_PAYLOAD = {
  timestamp: '2026-09-01T23:30:00Z',
  app_version: '1.8.0',
  source: 'health_connect',
  nutrition: MACROFACTOR_ITEMS,
} as const;
