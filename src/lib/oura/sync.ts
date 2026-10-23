import { db } from '@/db';
import {
  getConnectedSource,
  listActiveConnectedSourceUserIds,
  touchLastSync,
  recordConnectedSourceSync,
  setConnectedSourceStatus,
} from '@/lib/repos/connected-sources';
import { upsertOwnVital } from '@/lib/repos/vitals';
import { OuraClient, type OuraSpO2Doc } from './client';
import { getOuraAccessToken } from './tokens';
import { addCalendarDays, calendarDayInTimeZone, getHealthTrackTimeZone } from './timezone';
import { OuraApiError, ouraErrorMessage } from './errors';

export const OURA_LOOKBACK_DAYS = 7;

export interface SyncSummary {
  synced: number;
  errors: string[];
  outcome?: 'success' | 'partial' | 'failed';
  errorCode?: string | null;
  nextRetryAt?: string | null;
  collections?: Array<{
    name: string;
    status: 'success' | 'unsupported' | 'failed';
    errorCode?: string;
  }>;
}

export interface AllUsersSyncSummary extends SyncSummary {
  usersAttempted: number;
}

const UNITS: Record<string, string> = {
  sleep_duration: 'hours',
  time_in_bed: 'min',
  awake_time: 'min',
  deep_sleep: 'min',
  rem_sleep: 'min',
  light_sleep: 'min',
  sleep_latency: 'min',
  sleep_efficiency: '%',
  stress_high: 'min',
  recovery_high: 'min',
  hrv_rmssd: 'ms',
  resting_hr: 'bpm',
  avg_sleep_hr: 'bpm',
  respiratory_rate: 'breaths/min',
  body_temp_deviation: '°F',
  spo2: '%',
  steps: 'steps',
  active_calories: 'kcal',
};

export function syncWindow(
  now = new Date(),
  lookbackDays = OURA_LOOKBACK_DAYS,
  timeZone = getHealthTrackTimeZone()
) {
  const endDate = calendarDayInTimeZone(now, timeZone);
  return {
    startDate: addCalendarDays(endDate, -(lookbackDays - 1)),
    endDate,
    sleepEndDate: addCalendarDays(endDate, 1),
  };
}

const value = (obj: Record<string, unknown>, key: string) =>
  typeof obj[key] === 'number' ? (obj[key] as number) : undefined;
const byDay = <T extends { day: string }>(rows: T[]) => new Map(rows.map((row) => [row.day, row]));

export function selectLongestSleep<T extends { day: string; total_sleep_duration: number }>(
  rows: T[]
) {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (!best.has(row.day) || row.total_sleep_duration > best.get(row.day)!.total_sleep_duration) {
      best.set(row.day, row);
    }
  }
  return [...best.values()];
}

/** Sync all Oura daily collections into HealthTrack's canonical vitals store. */
async function performOuraSync(
  userId: string,
  accessToken?: string,
  backfill = false,
  now = new Date()
): Promise<SyncSummary> {
  const token = accessToken ?? (await getOuraAccessToken(userId));
  const lookbackDays = backfill ? 30 : OURA_LOOKBACK_DAYS;
  const client = new OuraClient(token, (rejected) => getOuraAccessToken(userId, true, rejected));
  const window = syncWindow(now, lookbackDays);
  const errors: string[] = [];
  let successfulFetches = 0;
  let synced = 0;
  let errorCode: string | null = null;
  let nextRetryAt: string | null = null;
  const collections: NonNullable<SyncSummary['collections']> = [];

  const get = async <T>(name: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      const rows = await fn();
      successfulFetches += 1;
      collections.push({ name, status: 'success' });
      return rows;
    } catch (error) {
      if (
        error instanceof OuraApiError &&
        error.status === 404 &&
        ['SpO2', 'Resilience', 'Stress'].includes(name)
      ) {
        collections.push({ name, status: 'unsupported' });
        return [];
      }
      const code = error instanceof OuraApiError ? error.code : 'provider_error';
      if (!errorCode || ['auth_required', 'invalid_grant', 'rate_limited'].includes(code))
        errorCode = code;
      if (
        error instanceof OuraApiError &&
        error.retryAt &&
        (!nextRetryAt || error.retryAt > nextRetryAt)
      )
        nextRetryAt = error.retryAt;
      if (code === 'auth_required' || code === 'invalid_grant')
        await setConnectedSourceStatus(userId, 'oura', 'expired');
      collections.push({ name, status: 'failed', errorCode: code });
      errors.push(`${name}: ${ouraErrorMessage(code)}`);
      return [];
    }
  };

  const [sleep, dailySleep, readiness, spo2, stress, activity, resilience] = await Promise.all([
    get('Sleep', () => client.getSleepData(window.startDate, window.sleepEndDate)),
    get('Daily sleep', () => client.getDailySleep(window.startDate, window.endDate)),
    get('Readiness', () => client.getDailyReadiness(window.startDate, window.endDate)),
    get('SpO2', () => client.getSpO2(window.startDate, window.endDate)),
    get('Stress', () => client.getDailyStress(window.startDate, window.endDate)),
    get('Activity', () => client.getDailyActivity(window.startDate, window.sleepEndDate)),
    get('Resilience', () => client.getDailyResilience(window.startDate, window.endDate)),
  ]);

  const sleepMap = byDay(selectLongestSleep(sleep));
  const maps = {
    dailySleep: byDay(dailySleep),
    readiness: byDay(readiness),
    spo2: byDay(spo2),
    stress: byDay(stress),
    activity: byDay(activity),
    resilience: byDay(resilience),
  };

  for (let index = 0; index < lookbackDays; index += 1) {
    const target = addCalendarDays(window.endDate, -index);
    const sleepRecord = sleepMap.get(target);
    const records: Array<{
      metricKey: string;
      value?: number;
      valueLabel?: string;
      unit?: string;
      source: string;
      recordedAt: string;
      metadata: Record<string, unknown>;
    }> = [];
    const add = (
      metricKey: string,
      metricValue: number | undefined,
      metadata: Record<string, unknown> = {},
      valueLabel?: string
    ) => {
      if (metricValue == null && valueLabel == null) return;
      records.push({
        metricKey,
        value: metricValue,
        valueLabel,
        unit: UNITS[metricKey],
        source: 'oura',
        recordedAt: `${target}T00:00:00Z`,
        metadata,
      });
    };

    const sleepId = sleepRecord?.id;
    const sleepMetadata = sleepId ? { oura_id: sleepId } : {};
    const dailySleepRecord = maps.dailySleep.get(target);
    add('sleep_score', value(dailySleepRecord ?? {}, 'score'), {
      ...sleepMetadata,
      oura_daily_id: dailySleepRecord?.id,
    });
    const readinessRecord = maps.readiness.get(target);
    add('readiness_score', value(readinessRecord ?? {}, 'score'), {
      ...sleepMetadata,
      oura_id: readinessRecord?.id,
    });
    const temperature = value(readinessRecord ?? {}, 'temperature_deviation');
    if (temperature != null) {
      add('body_temp_deviation', Math.round(((temperature * 9) / 5) * 100) / 100, {
        ...sleepMetadata,
        source_unit: 'C',
      });
    }
    if (sleepRecord) {
      add(
        'sleep_duration',
        Math.round((sleepRecord.total_sleep_duration / 3600) * 100) / 100,
        sleepMetadata
      );
      if (sleepRecord.time_in_bed != null) {
        add('time_in_bed', Math.round(sleepRecord.time_in_bed / 60), sleepMetadata);
      }
      add('awake_time', Math.round(sleepRecord.awake_time / 60), sleepMetadata);
      add('deep_sleep', Math.round(sleepRecord.deep_sleep_duration / 60), sleepMetadata);
      add('rem_sleep', Math.round(sleepRecord.rem_sleep_duration / 60), sleepMetadata);
      add('light_sleep', Math.round(sleepRecord.light_sleep_duration / 60), sleepMetadata);
      if (sleepRecord.latency != null) {
        add('sleep_latency', Math.round(sleepRecord.latency / 60), sleepMetadata);
      }
      add('sleep_efficiency', sleepRecord.efficiency ?? undefined, sleepMetadata);
      add('hrv_rmssd', sleepRecord.average_hrv ?? undefined, sleepMetadata);
      add('resting_hr', sleepRecord.lowest_heart_rate ?? undefined, sleepMetadata);
      add('avg_sleep_hr', sleepRecord.average_heart_rate ?? undefined, sleepMetadata);
      add('respiratory_rate', sleepRecord.average_breath ?? undefined, sleepMetadata);
      add('restless_periods', sleepRecord.restless_periods ?? undefined, sleepMetadata);
    }

    const oxygenRecord = maps.spo2.get(target) as OuraSpO2Doc | undefined;
    add('spo2', oxygenRecord?.spo2_percentage?.average, { oura_id: oxygenRecord?.id });
    add(
      'bdi',
      value((oxygenRecord ?? {}) as Record<string, unknown>, 'breathing_disturbance_index'),
      { oura_id: oxygenRecord?.id }
    );
    const stressRecord = maps.stress.get(target);
    const stressHigh = value(stressRecord ?? {}, 'stress_high');
    const recoveryHigh = value(stressRecord ?? {}, 'recovery_high');
    add('stress_high', stressHigh == null ? undefined : Math.round(stressHigh / 60), {
      oura_id: stressRecord?.id,
    });
    add('recovery_high', recoveryHigh == null ? undefined : Math.round(recoveryHigh / 60), {
      oura_id: stressRecord?.id,
    });
    const activityRecord = maps.activity.get(target);
    add('activity_score', value(activityRecord ?? {}, 'score'), {
      oura_id: activityRecord?.id,
    });
    add('steps', value(activityRecord ?? {}, 'steps'), { oura_id: activityRecord?.id });
    add('active_calories', value(activityRecord ?? {}, 'active_calories'), {
      oura_id: activityRecord?.id,
    });
    const resilienceRecord = maps.resilience.get(target);
    const resilienceLevel =
      typeof resilienceRecord?.level === 'string' ? resilienceRecord.level : undefined;
    add('resilience', undefined, { oura_id: resilienceRecord?.id }, resilienceLevel);

    for (const record of records) {
      try {
        upsertOwnVital(db, userId, record);
        synced += 1;
      } catch (error) {
        void error;
        errorCode = 'persistence_error';
        errors.push(`${target} ${record.metricKey}: could not save this measurement.`);
      }
    }
  }

  if (successfulFetches > 0 && errors.length === 0) {
    try {
      await touchLastSync(userId, 'oura');
    } catch (error) {
      void error;
      errorCode = 'persistence_error';
      errors.push('Could not save the sync completion time.');
    }
  }
  return {
    synced,
    errors,
    collections,
    errorCode,
    nextRetryAt,
    outcome: errors.length === 0 ? 'success' : successfulFetches > 0 ? 'partial' : 'failed',
  };
}

const userSyncs = new Map<string, Promise<SyncSummary>>();

/** Manual and scheduled syncs share one lock and one persisted outcome per account. */
export function syncOuraData(
  userId: string,
  accessToken?: string,
  backfill = false,
  now = new Date()
): Promise<SyncSummary> {
  const existing = userSyncs.get(userId);
  if (existing) return existing;
  const work = (async (): Promise<SyncSummary> => {
    const attemptedAt = now.toISOString();
    await recordConnectedSourceSync(userId, 'oura', { attemptedAt, outcome: 'running' });
    let summary: SyncSummary;
    try {
      summary = await performOuraSync(userId, accessToken, backfill, now);
    } catch (error) {
      const code = error instanceof OuraApiError ? error.code : 'provider_error';
      summary = {
        synced: 0,
        errors: [ouraErrorMessage(code)],
        outcome: 'failed',
        errorCode: code,
        nextRetryAt: error instanceof OuraApiError ? error.retryAt : null,
      };
    }
    await recordConnectedSourceSync(userId, 'oura', {
      attemptedAt,
      outcome: summary.outcome ?? 'failed',
      errorCode: summary.errorCode,
      nextRetryAt: summary.nextRetryAt,
    });
    return summary;
  })();
  userSyncs.set(userId, work);
  void work
    .finally(() => {
      if (userSyncs.get(userId) === work) userSyncs.delete(userId);
    })
    .catch(() => undefined);
  return work;
}

/** Sync every active user's own OAuth connection; failures are isolated and returned. */
export async function syncAllOuraUsers(): Promise<AllUsersSyncSummary> {
  const userIds = await listActiveConnectedSourceUserIds('oura');
  const summary: AllUsersSyncSummary = {
    usersAttempted: 0,
    synced: 0,
    errors: [],
  };
  for (const userId of userIds) {
    try {
      const source = await getConnectedSource(userId, 'oura');
      if (source?.nextRetryAt && Date.parse(source.nextRetryAt) > Date.now()) continue;
      summary.usersAttempted += 1;
      const userSummary = await syncOuraData(userId);
      summary.synced += userSummary.synced;
      summary.errors.push(...userSummary.errors.map((error) => `${userId}: ${error}`));
    } catch (error) {
      summary.errors.push(`${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
