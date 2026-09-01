// @vitest-environment node
/**
 * Pure normalization rules: metre→mile conversion, Phoenix day boundaries,
 * and the null-vs-zero / never-additive contract for nutrition totals.
 *
 * The DB-backed behaviour (recompute the day from retained records, overwrite
 * the canonical row) is covered end to end in the webhook route test.
 */
import { describe, it, expect } from 'vitest';
import { METERS_PER_MILE, metersToMiles } from './normalize-activity';
import { computeDayTotals, phoenixDate, phoenixDayWindow } from './normalize-nutrition';
import type { HealthConnectRawRecordRow } from '@/lib/repos/health-connect';

function rawRecord(
  payload: Record<string, unknown>,
  startAt = String(payload.start_time),
): HealthConnectRawRecordRow {
  return {
    id: `row-${Math.random()}`,
    integrationId: 'integration-1',
    userId: 'user-1',
    recordType: 'nutrition',
    sourcePackage: 'com.sbs.diet',
    sourceUuid: String(payload.uuid ?? 'u'),
    identityKind: 'uuid',
    recordedStartAt: startAt,
    recordedEndAt: null,
    sourceLastModifiedAt: null,
    payload,
    firstSeenAt: '2026-09-01T00:00:00Z',
    lastSeenAt: '2026-09-01T00:00:00Z',
    lastIngestId: 'ingest-1',
    deletedAt: null,
  };
}

describe('distance conversion', () => {
  it('divides metres by exactly 1609.344', () => {
    expect(METERS_PER_MILE).toBe(1609.344);
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(8046.72)).toBeCloseTo(5, 10);
    expect(metersToMiles(0)).toBe(0);
    expect(metersToMiles(5000)).toBeCloseTo(3.10686, 5);
  });
});

describe('Phoenix date boundaries', () => {
  it('maps instants to the owner-local calendar day (UTC-7, no DST)', () => {
    // 06:59 UTC on Sep 2 is still 23:59 on Sep 1 in Phoenix.
    expect(phoenixDate('2026-09-02T06:59:00Z')).toBe('2026-09-01');
    // 07:00 UTC crosses into Sep 2 locally.
    expect(phoenixDate('2026-09-02T07:00:00Z')).toBe('2026-09-02');
    // Phoenix never observes DST, so a summer instant uses the same offset.
    expect(phoenixDate('2026-07-02T06:59:00Z')).toBe('2026-07-01');
    expect(phoenixDate('2026-07-02T07:00:00Z')).toBe('2026-07-02');
  });

  it('returns null for an unparseable instant', () => {
    expect(phoenixDate('nonsense')).toBeNull();
  });

  it('produces a window whose ends land on the same Phoenix day', () => {
    const { startAt, endAt } = phoenixDayWindow('2026-09-01');
    expect(startAt).toBe('2026-09-01T07:00:00.000Z');
    expect(phoenixDate(startAt)).toBe('2026-09-01');
    expect(phoenixDate(endAt)).toBe('2026-09-01');
    // One millisecond past the window is the next day.
    expect(phoenixDate(new Date(new Date(endAt).getTime() + 1).toISOString())).toBe('2026-09-02');
  });
});

describe('computeDayTotals — sum_items', () => {
  it('sums every record for the day', () => {
    const totals = computeDayTotals(
      [
        rawRecord({ calories: 520, protein_grams: 42.5, carbs_grams: 38, fat_grams: 18.5, start_time: '2026-09-01T14:05:00Z' }),
        rawRecord({ calories: 740, protein_grams: 55, carbs_grams: 61, fat_grams: 24, start_time: '2026-09-01T19:30:00Z' }),
      ],
      'sum_items',
    );
    expect(totals).toEqual({
      calories: 1260,
      proteinGrams: 97.5,
      carbsGrams: 99,
      fatGrams: 42.5,
      recordCount: 2,
    });
  });

  it('keeps an unreported nutrient NULL rather than zero', () => {
    const totals = computeDayTotals(
      [rawRecord({ calories: 300, start_time: '2026-09-01T14:05:00Z' })],
      'sum_items',
    );
    expect(totals.calories).toBe(300);
    expect(totals.proteinGrams).toBeNull();
    expect(totals.carbsGrams).toBeNull();
    expect(totals.fatGrams).toBeNull();
  });

  it('distinguishes a reported zero from an absent nutrient', () => {
    const totals = computeDayTotals(
      [rawRecord({ calories: 0, protein_grams: null, start_time: '2026-09-01T14:05:00Z' })],
      'sum_items',
    );
    expect(totals.calories).toBe(0);
    expect(totals.proteinGrams).toBeNull();
  });

  it('is a pure function of the day’s records — never additive against a prior total', () => {
    const first = rawRecord({ calories: 520, start_time: '2026-09-01T14:05:00Z' });
    const second = rawRecord({ calories: 740, start_time: '2026-09-01T19:30:00Z' });
    // Recomputing the same set twice yields the same answer, and recomputing
    // a SHRUNKEN set yields the smaller answer (an additive path could not).
    expect(computeDayTotals([first, second], 'sum_items').calories).toBe(1260);
    expect(computeDayTotals([first, second], 'sum_items').calories).toBe(1260);
    expect(computeDayTotals([first], 'sum_items').calories).toBe(520);
  });

  it('erases float noise without rounding away real precision', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754.
    expect(
      computeDayTotals(
        [
          rawRecord({ protein_grams: 0.1, start_time: '2026-09-01T14:00:00Z' }),
          rawRecord({ protein_grams: 0.2, start_time: '2026-09-01T15:00:00Z' }),
        ],
        'sum_items',
      ).proteinGrams,
    ).toBe(0.3);

    // …but three-decimal source values survive the sum intact: storage keeps
    // what the source said, and rounding is left to the display layer.
    expect(
      computeDayTotals(
        [
          rawRecord({ calories: 135.731, start_time: '2026-09-01T14:00:00Z' }),
          rawRecord({ calories: 402.368, start_time: '2026-09-01T15:00:00Z' }),
        ],
        'sum_items',
      ).calories,
    ).toBe(538.099);
  });

  it('reports zero records for an empty day', () => {
    expect(computeDayTotals([], 'sum_items').recordCount).toBe(0);
  });

  it('ignores records whose payload does not match the nutrition shape', () => {
    const totals = computeDayTotals(
      [rawRecord({ calories: 500 } as Record<string, unknown>, '2026-09-01T14:00:00Z')],
      'sum_items',
    );
    // No start_time → not a valid nutrition record → contributes nothing.
    expect(totals.recordCount).toBe(0);
    expect(totals.calories).toBeNull();
  });
});

describe('computeDayTotals — latest_summary', () => {
  it('uses only the newest record, so a summary + items cannot double count', () => {
    const totals = computeDayTotals(
      [
        rawRecord({ calories: 520, start_time: '2026-09-01T14:05:00Z' }),
        rawRecord({ calories: 1260, start_time: '2026-09-01T23:59:00Z' }),
      ],
      'latest_summary',
    );
    expect(totals.calories).toBe(1260);
    expect(totals.recordCount).toBe(1);
  });
});
