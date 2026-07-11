/**
 * Pure trend builders for the exercise-trends UI: PR flags, e1RM
 * secondaries, and Monday-anchored weekly tonnage buckets.
 */
import { describe, it, expect } from 'vitest';
import { buildTrendPoints, weeklyTonnage } from './trends';

describe('buildTrendPoints', () => {
  it('orders points chronologically and flags strict new maxes as PRs', () => {
    const points = buildTrendPoints(
      [
        // Newest-first, as the history API serves them.
        { date: '2026-07-08T17:00:00Z', workingWeight: 210, topSeconds: null, sets: [] },
        { date: '2026-07-01T17:00:00Z', workingWeight: 200, topSeconds: null, sets: [] },
        { date: '2026-06-24T17:00:00Z', workingWeight: 205, topSeconds: null, sets: [] },
      ],
      'weight',
    );
    expect(points.map((p) => p.value)).toEqual([205, 200, 210]);
    // First point is a baseline; 200 is below the 205 max; 210 is a PR.
    expect(points.map((p) => p.isPr)).toEqual([false, false, true]);
  });

  it('does not flag a tie with the running max as a PR', () => {
    const points = buildTrendPoints(
      [
        { date: '2026-07-01T17:00:00Z', workingWeight: 200, topSeconds: null, sets: [] },
        { date: '2026-07-08T17:00:00Z', workingWeight: 200, topSeconds: null, sets: [] },
      ],
      'weight',
    );
    expect(points.map((p) => p.isPr)).toEqual([false, false]);
  });

  it('computes best Epley e1RM from the sets and skips null-value entries', () => {
    const points = buildTrendPoints(
      [
        {
          date: '2026-07-01T17:00:00Z',
          workingWeight: 300,
          topSeconds: null,
          sets: [
            { weight: 200, reps: 12, warmup: true },
            { weight: 300, reps: 10 },
          ],
        },
        // Sets logged raw-only (parse gap): no derived value, no point.
        { date: '2026-07-08T17:00:00Z', workingWeight: null, topSeconds: null, sets: [] },
      ],
      'weight',
    );
    expect(points).toHaveLength(1);
    expect(points[0].e1rm).toBeCloseTo(300 * (1 + 10 / 30), 5);
  });

  it('charts top seconds for time-mode exercises with no e1RM', () => {
    const points = buildTrendPoints(
      [
        {
          date: '2026-07-01T17:00:00Z',
          workingWeight: null,
          topSeconds: 75,
          sets: [{ seconds: 75 }],
        },
        {
          date: '2026-07-08T17:00:00Z',
          workingWeight: null,
          topSeconds: 90,
          sets: [{ seconds: 90 }],
        },
      ],
      'time',
    );
    expect(points.map((p) => p.value)).toEqual([75, 90]);
    expect(points.map((p) => p.isPr)).toEqual([false, true]);
    expect(points.every((p) => p.e1rm === null)).toBe(true);
  });
});

describe('weeklyTonnage', () => {
  it('buckets working volume by Monday week in the given timezone', () => {
    const buckets = weeklyTonnage(
      [
        // Mon Jul 6 week: 300x10x2 = 6000
        {
          date: '2026-07-07T17:00:00Z',
          sets: [
            { weight: 300, reps: 10 },
            { weight: 300, reps: 10 },
          ],
        },
        // Same week, second session: 200x10 = 2000 (+ ignored warmup)
        {
          date: '2026-07-09T17:00:00Z',
          sets: [
            { weight: 100, reps: 10, warmup: true },
            { weight: 200, reps: 10 },
          ],
        },
        // Prior week; per-side doubles: 2 * 50 * 12 = 1200
        { date: '2026-07-01T17:00:00Z', sets: [{ weight: 50, reps: 12, perSide: true }] },
      ],
      'America/Phoenix',
    );
    expect(buckets).toEqual([
      { weekStart: '2026-06-29', tonnage: 1200 },
      { weekStart: '2026-07-06', tonnage: 8000 },
    ]);
  });

  it('resolves week membership in local time, not UTC', () => {
    // 2026-07-06T02:00Z is still Sunday Jul 5 in Phoenix (UTC-7) — prior week.
    const buckets = weeklyTonnage(
      [{ date: '2026-07-06T02:00:00Z', sets: [{ weight: 100, reps: 10 }] }],
      'America/Phoenix',
    );
    expect(buckets).toEqual([{ weekStart: '2026-06-29', tonnage: 1000 }]);
  });

  it('omits entries with no working volume', () => {
    expect(
      weeklyTonnage(
        [{ date: '2026-07-07T17:00:00Z', sets: [{ seconds: 75 }] }],
        'America/Phoenix',
      ),
    ).toEqual([]);
  });
});
