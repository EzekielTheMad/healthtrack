// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertUser, OWNER, setupRepoDb, type RepoTestDb } from '@/lib/repos/repo-test-harness';

let context: RepoTestDb;

beforeEach(async () => {
  context = await setupRepoDb('healthtrack-oura-persistence-');
  insertUser(context.sqlite, OWNER);
});

afterEach(() => {
  vi.restoreAllMocks();
  context.restore();
});

describe('Oura sync persistence', () => {
  it('persists canonical mappings, explicit zeroes, ordinal labels, and idempotent reruns', async () => {
    const [{ OuraClient }, { syncOuraData }, connectedSourcesRepo] = await Promise.all([
      import('./client'),
      import('./sync'),
      import('@/lib/repos/connected-sources'),
    ]);
    await connectedSourcesRepo.upsertConnectedSource(OWNER, 'oura', {
      accessTokenEncrypted: 'encrypted-access',
      refreshTokenEncrypted: 'encrypted-refresh',
      tokenExpiresAt: '2030-01-01T00:00:00.000Z',
    });

    vi.spyOn(OuraClient.prototype, 'getSleepData').mockResolvedValue([
      {
        id: 'sleep-1',
        day: '2026-09-10',
        bedtime_start: '2026-09-09T22:00:00Z',
        bedtime_end: '2026-09-10T06:00:00Z',
        total_sleep_duration: 25_200,
        time_in_bed: 0,
        rem_sleep_duration: 5_400,
        deep_sleep_duration: 4_500,
        light_sleep_duration: 15_300,
        awake_time: 1_800,
        latency: 0,
        average_heart_rate: 54,
        lowest_heart_rate: 48,
        average_hrv: 42,
        efficiency: 88,
      },
    ]);
    vi.spyOn(OuraClient.prototype, 'getDailySleep').mockResolvedValue([]);
    vi.spyOn(OuraClient.prototype, 'getDailyReadiness').mockResolvedValue([]);
    vi.spyOn(OuraClient.prototype, 'getSpO2').mockResolvedValue([]);
    vi.spyOn(OuraClient.prototype, 'getDailyStress').mockResolvedValue([
      {
        id: 'stress-1',
        day: '2026-09-10',
        stress_high: 3600,
        recovery_high: 1800,
      },
    ]);
    vi.spyOn(OuraClient.prototype, 'getDailyActivity').mockResolvedValue([]);
    vi.spyOn(OuraClient.prototype, 'getDailyResilience').mockResolvedValue([
      { id: 'resilience-1', day: '2026-09-10', level: 'solid' },
    ]);

    const now = new Date('2026-09-10T12:00:00Z');
    await expect(syncOuraData(OWNER, 'access', false, now)).resolves.toMatchObject({
      errors: [],
    });
    await expect(syncOuraData(OWNER, 'access', false, now)).resolves.toMatchObject({
      errors: [],
    });

    const rows = context.sqlite
      .prepare(
        `select metric_key, value, unit, metadata
         from vitals
         where user_id = ? and source = 'oura'
         order by metric_key`
      )
      .all(OWNER) as Array<{
      metric_key: string;
      value: number;
      unit: string | null;
      metadata: string;
    }>;
    const byMetric = new Map(rows.map((row) => [row.metric_key, row]));

    expect(byMetric.get('time_in_bed')).toMatchObject({ value: 0, unit: 'min' });
    expect(byMetric.get('sleep_latency')).toMatchObject({ value: 0, unit: 'min' });
    expect(byMetric.get('stress_high')).toMatchObject({ value: 60, unit: 'min' });
    expect(byMetric.get('recovery_high')).toMatchObject({ value: 30, unit: 'min' });
    expect(byMetric.get('resilience')).toMatchObject({ value: 3, unit: null });
    expect(JSON.parse(byMetric.get('resilience')!.metadata)).toMatchObject({
      label: 'solid',
      oura_id: 'resilience-1',
    });
    expect(
      context.sqlite
        .prepare(
          `select count(*) as count
           from vitals
           where user_id = ? and source = 'oura' and recorded_at = ?`
        )
        .get(OWNER, '2026-09-10T00:00:00Z')
    ).toMatchObject({ count: rows.length });
    expect(
      context.sqlite
        .prepare(
          `select last_sync_at from connected_sources
           where user_id = ? and source_name = 'oura'`
        )
        .get(OWNER)
    ).toMatchObject({ last_sync_at: expect.any(String) });
  });
});
