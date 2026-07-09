// Oura Ring data sync
// Backfill 30 days on connect, then daily sync via manual "Sync Now"
//
// Trusted internal path: callers always pass the session user's own id (the
// OAuth callback / sync route), so this writes with drizzle directly instead
// of going through the authz'd vitals repo — actor and owner are the same by
// construction.

import { OuraClient } from './client';
import { db } from '@/db';
import { upsertOwnVital } from '@/lib/repos/vitals';
import { touchLastSync } from '@/lib/repos/connected-sources';

interface SyncSummary {
  synced: number;
  errors: string[];
}

interface VitalUpsert {
  userId: string;
  metricKey: string;
  value: number;
  unit: string;
  source: string;
  recordedAt: string;
  metadata: Record<string, unknown>;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Small delay between sequential API calls to avoid hammering Oura. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upsert daily metrics keyed on (user_id, metric_key, recorded_at, source)
 * for the user's own (dependent_id IS NULL) rows — delegated to the shared
 * registry-validated repo upsert (promoted from this module).
 * Returns the number of rows written.
 */
async function upsertVitals(rows: VitalUpsert[]): Promise<number> {
  for (const row of rows) {
    upsertOwnVital(db, row.userId, row);
  }
  return rows.length;
}

/**
 * Sync Oura data for a user. If backfill=true, fetches last 30 days;
 * otherwise fetches the last 1 day.
 */
export async function syncOuraData(
  userId: string,
  accessToken: string,
  backfill = false,
): Promise<SyncSummary> {
  const client = new OuraClient(accessToken);

  const now = new Date();
  const endDate = formatDate(now);
  const startDate = formatDate(
    new Date(now.getTime() - (backfill ? 30 : 1) * 24 * 60 * 60 * 1000),
  );

  let synced = 0;
  const errors: string[] = [];

  // --- Sleep data ---
  // Oura may return multiple sleep sessions per day (naps + main sleep).
  // Keep only the longest session per day to avoid duplicate-key conflicts.
  try {
    const sleepData = await client.getSleepData(startDate, endDate);

    // Deduplicate: keep the longest sleep session per day
    const bestByDay = new Map<string, (typeof sleepData)[number]>();
    for (const sleep of sleepData) {
      const existing = bestByDay.get(sleep.day);
      if (!existing || sleep.total_sleep_duration > existing.total_sleep_duration) {
        bestByDay.set(sleep.day, sleep);
      }
    }

    const vitalsToUpsert: VitalUpsert[] = [];

    for (const sleep of bestByDay.values()) {
      // Sleep duration in hours
      vitalsToUpsert.push({
        userId,
        metricKey: 'sleep_duration',
        value: Math.round((sleep.total_sleep_duration / 3600) * 100) / 100,
        unit: 'hours',
        source: 'oura',
        recordedAt: `${sleep.day}T00:00:00Z`,
        metadata: {
          oura_id: sleep.id,
          rem: sleep.rem_sleep_duration,
          deep: sleep.deep_sleep_duration,
          light: sleep.light_sleep_duration,
          awake: sleep.awake_time,
          efficiency: sleep.efficiency,
        },
      });

      // HRV from sleep
      if (sleep.average_hrv != null) {
        vitalsToUpsert.push({
          userId,
          metricKey: 'hrv_rmssd',
          value: sleep.average_hrv,
          unit: 'ms',
          source: 'oura',
          recordedAt: `${sleep.day}T00:00:00Z`,
          metadata: { oura_id: sleep.id, derived_from: 'sleep' },
        });
      }

      // Resting HR from sleep
      if (sleep.lowest_heart_rate != null) {
        vitalsToUpsert.push({
          userId,
          metricKey: 'resting_hr',
          value: sleep.lowest_heart_rate,
          unit: 'bpm',
          source: 'oura',
          recordedAt: `${sleep.day}T00:00:00Z`,
          metadata: { oura_id: sleep.id, type: 'lowest_during_sleep' },
        });
      }
    }

    if (vitalsToUpsert.length > 0) {
      try {
        synced += await upsertVitals(vitalsToUpsert);
      } catch (err) {
        errors.push(
          `Sleep upsert error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    errors.push(`Sleep fetch error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- SpO2 data (Gen 3+ rings only — 404 means unsupported, skip gracefully) ---
  await delay(500);
  try {
    const spo2Data = await client.getSpO2(startDate, endDate);

    const spo2Vitals: VitalUpsert[] = spo2Data
      .filter((d) => d.spo2_percentage?.average != null)
      .map((d) => ({
        userId,
        metricKey: 'spo2',
        value: d.spo2_percentage!.average,
        unit: '%',
        source: 'oura',
        recordedAt: `${d.day}T00:00:00Z`,
        metadata: { oura_id: d.id },
      }));

    if (spo2Vitals.length > 0) {
      try {
        synced += await upsertVitals(spo2Vitals);
      } catch (err) {
        errors.push(
          `SpO2 upsert error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    // 404 means the user's ring doesn't support SpO2 — not an error
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('404')) {
      errors.push(`SpO2 fetch error: ${msg}`);
    }
  }

  // --- Update last_sync_at ---
  try {
    await touchLastSync(userId, 'oura');
  } catch (err) {
    errors.push(`last_sync_at update error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { synced, errors };
}
