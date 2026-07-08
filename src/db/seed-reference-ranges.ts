/**
 * Seed vital_reference_ranges with published clinical reference data.
 * Translated from legacy migration 002_seed_reference_ranges.sql (51 rows).
 *
 * Idempotent: skips entirely when the table already has rows (seed data is
 * static reference data with generated ids, so a count check is the guard).
 */
import type { DB } from './index';
import { vitalReferenceRanges } from './schema';

type SeedRow = {
  metricKey: string;
  label: string;
  unit: string | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  ageMin: number | null;
  ageMax: number | null;
  sex: string | null;
  sourceCitation: string | null;
};

const row = (
  metricKey: string,
  label: string,
  unit: string | null,
  rangeLow: number | null,
  rangeHigh: number | null,
  ageMin: number | null,
  ageMax: number | null,
  sex: string | null,
  sourceCitation: string | null,
): SeedRow => ({ metricKey, label, unit, rangeLow, rangeHigh, ageMin, ageMax, sex, sourceCitation });

export const REFERENCE_RANGE_SEED: SeedRow[] = [
  // ── RESTING HEART RATE (bpm) — American Heart Association ────────────────
  row('resting_hr', 'Bradycardia', 'bpm', null, 59, 18, null, null, 'AHA – adult resting heart rate guidelines'),
  row('resting_hr', 'Normal', 'bpm', 60, 100, 18, null, null, 'AHA – adult resting heart rate guidelines'),
  row('resting_hr', 'Tachycardia', 'bpm', 101, null, 18, null, null, 'AHA – adult resting heart rate guidelines'),
  row('resting_hr', 'Athlete normal', 'bpm', 40, 60, 18, null, null, 'AHA – well-trained athletes'),
  row('resting_hr', 'Normal', 'bpm', 70, 100, 6, 15, null, 'AHA – pediatric resting heart rate'),
  row('resting_hr', 'Normal', 'bpm', 70, 190, 0, 1, null, 'AHA – newborn resting heart rate'),

  // ── HEART RATE VARIABILITY — RMSSD (ms) ───────────────────────────────────
  row('hrv_rmssd', 'Low', 'ms', null, 19, 18, 39, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'Normal', 'ms', 20, 65, 18, 39, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'High', 'ms', 66, null, 18, 39, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'Low', 'ms', null, 14, 40, 59, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'Normal', 'ms', 15, 50, 40, 59, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'High', 'ms', 51, null, 40, 59, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'Low', 'ms', null, 9, 60, null, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'Normal', 'ms', 10, 40, 60, null, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),
  row('hrv_rmssd', 'High', 'ms', 41, null, 60, null, null, 'Nunan et al. 2010; Shaffer & Ginsberg 2017 – HRV norms'),

  // ── BLOOD OXYGEN SATURATION (SpO2 %) — WHO ───────────────────────────────
  row('spo2', 'Critical', '%', null, 89, null, null, null, 'WHO – pulse oximetry clinical thresholds'),
  row('spo2', 'Low / Hypoxemia', '%', 90, 94, null, null, null, 'WHO – pulse oximetry clinical thresholds'),
  row('spo2', 'Normal', '%', 95, 100, null, null, null, 'WHO – pulse oximetry clinical thresholds'),

  // ── APNEA-HYPOPNEA INDEX (events/hr) — AASM ──────────────────────────────
  row('ahi', 'Normal', 'events/hr', null, 4.9, 18, null, null, 'AASM – Obstructive Sleep Apnea severity classification'),
  row('ahi', 'Mild OSA', 'events/hr', 5, 14.9, 18, null, null, 'AASM – Obstructive Sleep Apnea severity classification'),
  row('ahi', 'Moderate OSA', 'events/hr', 15, 29.9, 18, null, null, 'AASM – Obstructive Sleep Apnea severity classification'),
  row('ahi', 'Severe OSA', 'events/hr', 30, null, 18, null, null, 'AASM – Obstructive Sleep Apnea severity classification'),

  // ── SLEEP DURATION (hours) — National Sleep Foundation ───────────────────
  row('sleep_duration', 'Short sleep', 'hours', null, 5.9, 18, 64, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'May be appropriate', 'hours', 6, 6.9, 18, 64, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'Recommended', 'hours', 7, 9, 18, 64, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'May be appropriate', 'hours', 9.1, 10, 18, 64, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'Long sleep', 'hours', 10.1, null, 18, 64, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'Short sleep', 'hours', null, 4.9, 65, null, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'May be appropriate', 'hours', 5, 6.9, 65, null, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'Recommended', 'hours', 7, 8, 65, null, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'May be appropriate', 'hours', 8.1, 9, 65, null, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'Long sleep', 'hours', 9.1, null, 65, null, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'Recommended', 'hours', 8, 10, 14, 17, null, 'NSF – Sleep duration recommendations (2015)'),
  row('sleep_duration', 'Recommended', 'hours', 9, 11, 6, 13, null, 'NSF – Sleep duration recommendations (2015)'),

  // ── BLOOD PRESSURE, SYSTOLIC (mmHg) — AHA/ACC 2017 ───────────────────────
  row('bp_systolic', 'Normal', 'mmHg', null, 119, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),
  row('bp_systolic', 'Elevated', 'mmHg', 120, 129, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),
  row('bp_systolic', 'Hypertension Stage 1', 'mmHg', 130, 139, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),
  row('bp_systolic', 'Hypertension Stage 2', 'mmHg', 140, 179, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),
  row('bp_systolic', 'Hypertensive Crisis', 'mmHg', 180, null, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),

  // ── BLOOD PRESSURE, DIASTOLIC (mmHg) — AHA/ACC 2017 ──────────────────────
  row('bp_diastolic', 'Normal', 'mmHg', null, 79, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),
  // NB: low>high preserved verbatim from 002 — diastolic 'Elevated' is defined
  // by systolic only (< 80 diastolic); see source citation.
  row('bp_diastolic', 'Elevated', 'mmHg', 80, 79, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines – diastolic < 80 for elevated category'),
  row('bp_diastolic', 'Hypertension Stage 1', 'mmHg', 80, 89, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),
  row('bp_diastolic', 'Hypertension Stage 2', 'mmHg', 90, 119, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),
  row('bp_diastolic', 'Hypertensive Crisis', 'mmHg', 120, null, 18, null, null, 'AHA/ACC 2017 Blood Pressure Guidelines'),

  // ── BODY TEMPERATURE (°F) — clinical consensus ───────────────────────────
  row('body_temp', 'Hypothermia', '°F', null, 95.9, null, null, null, 'Clinical consensus – core body temperature'),
  row('body_temp', 'Normal', '°F', 96.0, 99.0, null, null, null, 'Clinical consensus – core body temperature'),
  row('body_temp', 'Low-grade fever', '°F', 99.1, 100.3, null, null, null, 'Clinical consensus – core body temperature'),
  row('body_temp', 'Fever', '°F', 100.4, null, null, null, null, 'Clinical consensus – core body temperature'),

  // ── RESPIRATORY RATE (breaths/min) — clinical consensus ──────────────────
  row('respiratory_rate', 'Low', 'breaths/min', null, 11, 18, null, null, 'Clinical consensus – adult respiratory rate'),
  row('respiratory_rate', 'Normal', 'breaths/min', 12, 20, 18, null, null, 'Clinical consensus – adult respiratory rate'),
  row('respiratory_rate', 'High', 'breaths/min', 21, null, 18, null, null, 'Clinical consensus – adult respiratory rate'),
];

/** Insert seed rows once. No-op when the table already contains data. */
export function seedReferenceRanges(db: DB): void {
  const existing = db.select({ id: vitalReferenceRanges.id }).from(vitalReferenceRanges).limit(1).all();
  if (existing.length > 0) return;
  db.insert(vitalReferenceRanges).values(REFERENCE_RANGE_SEED).run();
}
