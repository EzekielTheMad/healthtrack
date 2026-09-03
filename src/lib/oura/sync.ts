import { db } from '@/db';
import { connectedSources } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { upsertOwnVital } from '@/lib/repos/vitals';
import { touchLastSync } from '@/lib/repos/connected-sources';
import { OuraClient, type OuraSpO2Doc } from './client';
import { getOuraAccessToken } from './tokens';

export const OURA_LOOKBACK_DAYS = 7;
export interface SyncSummary { synced: number; errors: string[]; }
const UNITS: Record<string, string> = { sleep_duration: 'hours', time_in_bed: 'minutes', awake_time: 'minutes', deep_sleep: 'minutes', rem_sleep: 'minutes', light_sleep: 'minutes', sleep_latency: 'minutes', sleep_efficiency: '%', stress_high: 'minutes', recovery_high: 'minutes', hrv_rmssd: 'ms', resting_hr: 'bpm', avg_sleep_hr: 'bpm', respiratory_rate: 'breaths/min', body_temp_deviation: '°F', spo2: '%', steps: 'steps', active_calories: 'kcal' };
const day = (d: Date) => d.toISOString().slice(0, 10);
export function syncWindow(now = new Date(), lookbackDays = OURA_LOOKBACK_DAYS) {
  const end = day(now); const start = day(new Date(now.getTime() - (lookbackDays - 1) * 86400000));
  return { startDate: start, endDate: end, sleepEndDate: day(new Date(now.getTime() + 86400000)) };
}
const value = (obj: Record<string, unknown>, key: string) => typeof obj[key] === 'number' ? obj[key] as number : undefined;
const byDay = <T extends { day: string }>(rows: T[]) => new Map(rows.map((r) => [r.day, r]));
export function selectLongestSleep<T extends { day: string; total_sleep_duration: number }>(rows: T[]) {
  const best = new Map<string, T>();
  for (const row of rows) if (!best.has(row.day) || row.total_sleep_duration > best.get(row.day)!.total_sleep_duration) best.set(row.day, row);
  return [...best.values()];
}

/** Sync all Oura daily collections into HealthTrack's canonical vitals store. */
export async function syncOuraData(userId: string, accessToken?: string, _backfill = false, now = new Date()): Promise<SyncSummary> {
  const token = accessToken ?? await getOuraAccessToken(userId);
  const lookbackDays = _backfill ? 30 : OURA_LOOKBACK_DAYS;
  const client = new OuraClient(token); const w = syncWindow(now, lookbackDays);
  const errors: string[] = []; let synced = 0;
  const get = async <T>(name: string, fn: () => Promise<T[]>): Promise<T[]> => { try { return await fn(); } catch (e) { errors.push(`${name} fetch error: ${e instanceof Error ? e.message : String(e)}`); return []; } };
  const [sleep, dailySleep, readiness, spo2, stress, activity, resilience] = await Promise.all([
    get('Sleep', () => client.getSleepData(w.startDate, w.sleepEndDate)),
    get('Daily sleep', () => client.getDailySleep(w.startDate, w.endDate)),
    get('Readiness', () => client.getDailyReadiness(w.startDate, w.endDate)),
    get('SpO2', () => client.getSpO2(w.startDate, w.endDate)),
    get('Stress', () => client.getDailyStress(w.startDate, w.endDate)),
    get('Activity', () => client.getDailyActivity(w.startDate, w.sleepEndDate)),
    get('Resilience', () => client.getDailyResilience(w.startDate, w.endDate)),
  ]);
  const sleepMap = byDay(selectLongestSleep(sleep)); const maps = { dailySleep: byDay(dailySleep), readiness: byDay(readiness), spo2: byDay(spo2), stress: byDay(stress), activity: byDay(activity), resilience: byDay(resilience) };
  for (let i = 0; i < lookbackDays; i++) {
    const target = day(new Date(now.getTime() - i * 86400000)); const s = sleepMap.get(target); const records: Array<{ metricKey: string; value?: number; valueLabel?: string; unit?: string; source: string; recordedAt: string; metadata: Record<string, unknown> }> = [];
    const add = (metricKey: string, v: number | undefined, metadata: Record<string, unknown> = {}, valueLabel?: string) => { if (v != null) records.push({ metricKey, value: v, valueLabel, unit: UNITS[metricKey], source: 'oura', recordedAt: `${target}T00:00:00Z`, metadata }); };
    const sid = s?.id;
    const meta = sid ? { oura_id: sid } : {};
    const ds = maps.dailySleep.get(target); add('sleep_score', value(ds ?? {}, 'score'), { ...meta, oura_daily_id: ds?.id });
    const rd = maps.readiness.get(target); add('readiness_score', value(rd ?? {}, 'score'), { ...meta, oura_id: rd?.id });
    const temp = value(rd ?? {}, 'temperature_deviation'); if (temp != null) add('body_temp_deviation', Math.round(temp * 9 / 5 * 100) / 100, { ...meta, source_unit: 'C' });
    if (s) { add('sleep_duration', Math.round(s.total_sleep_duration / 3600 * 100) / 100, meta); add('time_in_bed', Math.round((s.time_in_bed ?? 0) / 60), meta); add('awake_time', Math.round(s.awake_time / 60), meta); add('deep_sleep', Math.round(s.deep_sleep_duration / 60), meta); add('rem_sleep', Math.round(s.rem_sleep_duration / 60), meta); add('light_sleep', Math.round(s.light_sleep_duration / 60), meta); add('sleep_latency', Math.round((s.latency ?? 0) / 60), meta); add('sleep_efficiency', s.efficiency ?? undefined, meta); add('hrv_rmssd', s.average_hrv ?? undefined, meta); add('resting_hr', s.lowest_heart_rate ?? undefined, meta); add('avg_sleep_hr', s.average_heart_rate ?? undefined, meta); add('respiratory_rate', s.average_breath ?? undefined, meta); add('restless_periods', s.restless_periods ?? undefined, meta); }
    const so = maps.spo2.get(target) as OuraSpO2Doc | undefined; add('spo2', so?.spo2_percentage?.average, { oura_id: so?.id }); add('bdi', value((so ?? {}) as Record<string, unknown>, 'breathing_disturbance_index'), { oura_id: so?.id });
    const st = maps.stress.get(target); add('stress_high', value(st ?? {}, 'stress_high') == null ? undefined : Math.round(value(st!, 'stress_high')! / 60), { oura_id: st?.id }); add('recovery_high', value(st ?? {}, 'recovery_high') == null ? undefined : Math.round(value(st!, 'recovery_high')! / 60), { oura_id: st?.id });
    const ac = maps.activity.get(target); add('activity_score', value(ac ?? {}, 'score'), { oura_id: ac?.id }); add('steps', value(ac ?? {}, 'steps'), { oura_id: ac?.id }); add('active_calories', value(ac ?? {}, 'active_calories'), { oura_id: ac?.id });
    const re = maps.resilience.get(target); const level = typeof re?.level === 'string' ? re.level : undefined; if (level) add('resilience', undefined, { oura_id: re?.id }, level);
    for (const record of records) { try { upsertOwnVital(db, userId, record); synced++; } catch (e) { errors.push(`${target} ${record.metricKey} upsert error: ${e instanceof Error ? e.message : String(e)}`); } }
  }
  try { await touchLastSync(userId, 'oura'); } catch (e) { errors.push(`last_sync_at update error: ${e instanceof Error ? e.message : String(e)}`); }
  return { synced, errors };
}

/** Sync every active user's own OAuth connection; failures are isolated. */
export async function syncAllOuraUsers(): Promise<void> {
  const rows = await db.select({ userId: connectedSources.userId }).from(connectedSources).where(eq(connectedSources.sourceName, 'oura'));
  for (const { userId } of [...new Map(rows.map((r) => [r.userId, r])).values()]) {
    try { await syncOuraData(userId); } catch (e) { console.error(`[oura] sync failed for user ${userId}:`, e instanceof Error ? e.message : e); }
  }
}
