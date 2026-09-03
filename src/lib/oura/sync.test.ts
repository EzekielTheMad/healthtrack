import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  listActiveConnectedSourceUserIds: vi.fn(),
  touchLastSync: vi.fn(),
  upsertOwnVital: vi.fn(),
}));

vi.mock('@/lib/repos/connected-sources', () => ({
  listActiveConnectedSourceUserIds: repoMocks.listActiveConnectedSourceUserIds,
  touchLastSync: repoMocks.touchLastSync,
}));
vi.mock('@/lib/repos/vitals', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/repos/vitals')>();
  return { ...original, upsertOwnVital: repoMocks.upsertOwnVital };
});

import { validateVitalWrite, type UpsertVitalInput } from '@/lib/repos/vitals';
import { OuraClient, type OuraSleepDoc } from './client';
import { OURA_LOOKBACK_DAYS, selectLongestSleep, syncOuraData, syncWindow } from './sync';
import { DEFAULT_HEALTHTRACK_TIMEZONE, getHealthTrackTimeZone } from './timezone';

const NOW = new Date('2026-09-10T12:00:00Z');

function sleep(overrides: Partial<OuraSleepDoc> = {}): OuraSleepDoc {
  return {
    id: 'sleep-1',
    day: '2026-09-10',
    bedtime_start: '2026-09-09T22:00:00-04:00',
    bedtime_end: '2026-09-10T06:00:00-04:00',
    total_sleep_duration: 25_200,
    rem_sleep_duration: 5_400,
    deep_sleep_duration: 4_500,
    light_sleep_duration: 15_300,
    awake_time: 1_800,
    average_heart_rate: 54,
    lowest_heart_rate: 48,
    average_hrv: 42,
    efficiency: 88,
    ...overrides,
  };
}

function mockCollections() {
  vi.spyOn(OuraClient.prototype, 'getSleepData').mockResolvedValue([]);
  vi.spyOn(OuraClient.prototype, 'getDailySleep').mockResolvedValue([]);
  vi.spyOn(OuraClient.prototype, 'getDailyReadiness').mockResolvedValue([]);
  vi.spyOn(OuraClient.prototype, 'getSpO2').mockResolvedValue([]);
  vi.spyOn(OuraClient.prototype, 'getDailyStress').mockResolvedValue([]);
  vi.spyOn(OuraClient.prototype, 'getDailyActivity').mockResolvedValue([]);
  vi.spyOn(OuraClient.prototype, 'getDailyResilience').mockResolvedValue([]);
}

beforeEach(() => {
  vi.restoreAllMocks();
  repoMocks.listActiveConnectedSourceUserIds.mockReset().mockResolvedValue([]);
  repoMocks.touchLastSync.mockReset().mockResolvedValue(undefined);
  repoMocks.upsertOwnVital
    .mockReset()
    .mockImplementation((_database: unknown, _userId: string, input: UpsertVitalInput) => {
      validateVitalWrite(input);
      return 'inserted';
    });
  mockCollections();
});

describe('Oura sync window', () => {
  it('uses an inclusive seven-day self-heal window and next-day sleep end', () => {
    expect(syncWindow(NOW, OURA_LOOKBACK_DAYS, 'Etc/UTC')).toEqual({
      startDate: '2026-09-04',
      endDate: '2026-09-10',
      sleepEndDate: '2026-09-11',
    });
    expect(OURA_LOOKBACK_DAYS).toBe(7);
  });

  it('uses the configured IANA timezone across a UTC and DST boundary', () => {
    expect(syncWindow(new Date('2026-03-08T04:30:00Z'), 7, 'America/New_York')).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-03-07',
      sleepEndDate: '2026-03-08',
    });
  });

  it('reads the HealthTrack TZ configuration by default', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Pacific/Auckland';
    try {
      expect(syncWindow(new Date('2026-01-01T11:30:00Z'), 1).endDate).toBe('2026-01-02');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('has a portable default and rejects invalid configured timezones', () => {
    expect(DEFAULT_HEALTHTRACK_TIMEZONE).toBe('Etc/UTC');
    expect(getHealthTrackTimeZone(' Europe/London ')).toBe('Europe/London');
    expect(() => getHealthTrackTimeZone('Mars/Olympus_Mons')).toThrow(
      /TZ must be a valid IANA timezone/
    );
  });

  it('supports the 30-day initial OAuth backfill', () => {
    expect(syncWindow(NOW, 30, 'Etc/UTC').startDate).toBe('2026-08-12');
  });

  it('selects only the longest sleep session for each day', () => {
    const rows = [
      { day: '2026-09-09', id: 'nap', total_sleep_duration: 1200 },
      { day: '2026-09-09', id: 'main', total_sleep_duration: 28_800 },
      { day: '2026-09-08', id: 'other', total_sleep_duration: 24_000 },
    ];
    expect(selectLongestSleep(rows).map((row) => row.id)).toEqual(['main', 'other']);
  });
});

describe('Oura canonical mapping and persistence', () => {
  it('persists minute metrics with canonical units and ordinal resilience', async () => {
    vi.mocked(OuraClient.prototype.getSleepData).mockResolvedValue([
      sleep({ time_in_bed: 28_800, latency: 900 }),
    ]);
    vi.mocked(OuraClient.prototype.getDailyStress).mockResolvedValue([
      { id: 'stress-1', day: '2026-09-10', stress_high: 3600, recovery_high: 1800 },
    ]);
    vi.mocked(OuraClient.prototype.getDailyResilience).mockResolvedValue([
      { id: 'resilience-1', day: '2026-09-10', level: 'strong' },
    ]);

    const summary = await syncOuraData('user-1', 'access-token', false, NOW);

    expect(summary.errors).toEqual([]);
    const inputs = repoMocks.upsertOwnVital.mock.calls.map((call) => call[2]);
    const byMetric = new Map(inputs.map((input) => [input.metricKey, input]));
    for (const key of [
      'time_in_bed',
      'sleep_latency',
      'awake_time',
      'deep_sleep',
      'rem_sleep',
      'light_sleep',
      'stress_high',
      'recovery_high',
    ]) {
      expect(byMetric.get(key)?.unit).toBe('min');
    }
    expect(byMetric.get('resilience')).toMatchObject({
      valueLabel: 'strong',
      unit: undefined,
    });
    expect(validateVitalWrite(byMetric.get('resilience'))).toMatchObject({
      value: 4,
      unit: null,
      metadata: { label: 'strong', oura_id: 'resilience-1' },
    });
    expect(repoMocks.touchLastSync).toHaveBeenCalledWith('user-1', 'oura');
  });

  it('does not synthesize zero when time_in_bed or latency is missing', async () => {
    vi.mocked(OuraClient.prototype.getSleepData).mockResolvedValue([sleep()]);

    await syncOuraData('user-1', 'access-token', false, NOW);

    const metricKeys = repoMocks.upsertOwnVital.mock.calls.map((call) => call[2].metricKey);
    expect(metricKeys).not.toContain('time_in_bed');
    expect(metricKeys).not.toContain('sleep_latency');
  });

  it('does not stamp last_sync_at when every provider collection fails', async () => {
    for (const method of [
      'getSleepData',
      'getDailySleep',
      'getDailyReadiness',
      'getSpO2',
      'getDailyStress',
      'getDailyActivity',
      'getDailyResilience',
    ] as const) {
      vi.mocked(OuraClient.prototype[method]).mockRejectedValue(new Error(`${method} down`));
    }

    const summary = await syncOuraData('user-1', 'access-token', false, NOW);

    expect(summary.synced).toBe(0);
    expect(summary.errors).toHaveLength(7);
    expect(repoMocks.touchLastSync).not.toHaveBeenCalled();
  });
});
