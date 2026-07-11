// @vitest-environment node
/**
 * GET /api/v1/weeks/{weekStart} — the computed weekly rollup contract.
 *
 * Covers the PAT auth matrix, the Monday-key 400, rollup math over sparse
 * body-comp data (avg of per-day means, min of raw weigh-ins, days weighed),
 * recovery averages, latest neck/waist (as-of week end, never future rows),
 * frequency-goal progress, the check-in row, prior-week deltas, the
 * Phoenix-timezone week-boundary pins for sessions, and the empty week.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  mintApiToken,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

type WeeksRoute = typeof import('./[weekStart]/route');
type WorkoutsRoute = typeof import('../workouts/route');
type CheckinItemRoute = typeof import('../checkins/[weekStart]/route');
type GoalsRoute = typeof import('../goals/route');
type VitalsBatchRoute = typeof import('../vitals/batch/route');

let ctx: RepoTestDb;
let weeks: WeeksRoute;
let workouts: WorkoutsRoute;
let checkin: CheckinItemRoute;
let goals: GoalsRoute;
let vitalsBatch: VitalsBatchRoute;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-weeks-');
  [weeks, workouts, checkin, goals, vitalsBatch] = await Promise.all([
    import('./[weekStart]/route'),
    import('../workouts/route'),
    import('../checkins/[weekStart]/route'),
    import('../goals/route'),
    import('../vitals/batch/route'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

function req(url: string, token: string | null, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const params = (weekStart: string) => ({ params: Promise.resolve({ weekStart }) });

// 2026-07-06 is a Monday; the prior week is 2026-06-29 … 2026-07-05.
const WEEK = '2026-07-06';

async function getRollup(token: string, week: string = WEEK) {
  const res = await weeks.GET(req(`/api/v1/weeks/${week}`, token), params(week));
  return { res, body: await res.json() };
}

function fullToken(): string {
  return mintApiToken(ctx.sqlite, OWNER, ['read:all', 'write:all']);
}

async function seedEverything(token: string) {
  // --- Sessions (Phoenix = UTC-7, no DST) -------------------------------
  const post = (body: unknown) => workouts.POST(req('/api/v1/workouts', token, 'POST', body));
  // In-week strength sessions.
  await post({ type: 'strength', label: 'Day A', started_at: '2026-07-06T18:00:00Z', entries: [] });
  await post({ type: 'strength', label: 'Day B', started_at: '2026-07-08T18:00:00Z', entries: [] });
  // UTC Monday Jul 13 01:00 = Sunday Jul 12 18:00 in Phoenix → CURRENT week.
  await post({ type: 'cardio', label: 'Treadmill', started_at: '2026-07-13T01:00:00Z', entries: [] });
  // UTC Monday Jul 6 02:00 = Sunday Jul 5 19:00 in Phoenix → PRIOR week.
  await post({ type: 'strength', label: 'Boundary', started_at: '2026-07-06T02:00:00Z', entries: [] });
  // Plain prior-week session.
  await post({ type: 'strength', label: 'Day A', started_at: '2026-07-01T18:00:00Z', entries: [] });

  // --- Vitals (day-normalized) ------------------------------------------
  const records = [
    // Current week weights: Jul 8 has TWO sources → per-day mean 200.6.
    { metric_key: 'weight', value: 201.4, recorded_at: '2026-07-06', source: 'renpho' },
    { metric_key: 'weight', value: 200.2, recorded_at: '2026-07-08', source: 'renpho' },
    { metric_key: 'weight', value: 201.0, recorded_at: '2026-07-08', source: 'manual' },
    { metric_key: 'weight', value: 199.8, recorded_at: '2026-07-10', source: 'renpho' },
    // Prior week weights.
    { metric_key: 'weight', value: 203.0, recorded_at: '2026-06-29', source: 'renpho' },
    { metric_key: 'weight', value: 202.0, recorded_at: '2026-07-02', source: 'renpho' },
    // Sparse body comp: one reading, current week only.
    { metric_key: 'body_fat_pct', value: 31.2, recorded_at: '2026-07-07', source: 'renpho' },
    // Recovery.
    { metric_key: 'hrv_rmssd', value: 40, recorded_at: '2026-07-06', source: 'oura' },
    { metric_key: 'hrv_rmssd', value: 44, recorded_at: '2026-07-07', source: 'oura' },
    { metric_key: 'hrv_rmssd', value: 38, recorded_at: '2026-06-30', source: 'oura' },
    { metric_key: 'readiness_score', value: 80, recorded_at: '2026-07-06', source: 'oura' },
    { metric_key: 'sleep_duration', value: 7.5, recorded_at: '2026-07-06', source: 'oura' },
    { metric_key: 'sleep_duration', value: 6.5, recorded_at: '2026-07-07', source: 'oura' },
    // Tape: waist has an older reading and a FUTURE one past the week.
    { metric_key: 'waist', value: 40.5, recorded_at: '2026-06-01', source: 'manual' },
    { metric_key: 'waist', value: 41.0, recorded_at: '2026-07-01', source: 'manual' },
    { metric_key: 'waist', value: 42.0, recorded_at: '2026-07-15', source: 'manual' },
  ];
  const batchRes = await vitalsBatch.POST(
    req('/api/v1/vitals/batch', token, 'POST', { records }),
  );
  expect((await batchRes.json()).errors).toEqual([]);

  // --- Goals ---------------------------------------------------------------
  await goals.POST(
    req('/api/v1/goals', token, 'POST', { kind: 'frequency', session_type: 'strength', per_week: 3 }),
  );
  await goals.POST(
    req('/api/v1/goals', token, 'POST', { kind: 'frequency', session_type: 'cardio', per_week: 1 }),
  );
  // Inactive goals must not appear in the rollup.
  await goals.POST(
    req('/api/v1/goals', token, 'POST', {
      kind: 'frequency',
      session_type: 'mobility',
      per_week: 2,
      active: false,
    }),
  );
  // Metric goals are not frequency progress.
  await goals.POST(
    req('/api/v1/goals', token, 'POST', { kind: 'metric', metric_key: 'weight', direction: 'decrease' }),
  );

  // --- Check-in --------------------------------------------------------
  await checkin.PUT(
    req(`/api/v1/checkins/${WEEK}`, token, 'PUT', { working: 'consistency', days_logged: 6 }),
    params(WEEK),
  );
}

describe('auth + validation', () => {
  it('401 without a token; 403 without read:fitness (vitals scope does not leak)', async () => {
    expect((await weeks.GET(req(`/api/v1/weeks/${WEEK}`, null), params(WEEK))).status).toBe(401);
    const readVitals = mintApiToken(ctx.sqlite, OWNER, ['read:vitals', 'write:vitals']);
    const res = await weeks.GET(req(`/api/v1/weeks/${WEEK}`, readVitals), params(WEEK));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('read:fitness');
  });

  it('400 for a non-Monday weekStart, naming the rule', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness']);
    const { res, body } = await getRollup(token, '2026-07-08');
    expect(res.status).toBe(400);
    expect(body.error).toContain('not a Monday');
    expect((await getRollup(token, 'garbage')).res.status).toBe(400);
  });
});

describe('rollup contract', () => {
  it('computes the full rollup with Phoenix week boundaries and prior-week deltas', async () => {
    const token = fullToken();
    await seedEverything(token);
    const { res, body } = await getRollup(token);
    expect(res.status).toBe(200);

    expect(body.week_start).toBe(WEEK);
    expect(body.week_end).toBe('2026-07-12');
    expect(body.timezone).toBe('America/Phoenix');

    // Sessions: boundary UTC-Monday session belongs to the PRIOR week; the
    // Sunday-evening (UTC Monday 01:00) cardio session belongs to THIS week.
    expect(body.sessions.total).toBe(3);
    expect(body.sessions.by_type.strength).toEqual({ count: 2, labels: ['Day A', 'Day B'] });
    expect(body.sessions.by_type.cardio).toEqual({ count: 1, labels: ['Treadmill'] });
    expect(body.sessions.by_type.mobility).toEqual({ count: 0, labels: [] });
    expect(body.sessions.by_type.other).toEqual({ count: 0, labels: [] });

    // Body: avg of per-day means (Jul 8 collapses two sources to 200.6),
    // min of raw weigh-ins, distinct days weighed.
    expect(body.body.weight_avg).toBe(200.6);
    expect(body.body.weight_min).toBe(199.8);
    expect(body.body.days_weighed).toBe(3);
    expect(body.body.body_fat_pct_avg).toBe(31.2);
    expect(body.body.fat_free_mass_avg).toBeNull(); // sparse: no data at all
    // Latest tape as of week end — the Jul 1 reading, never the Jul 15 one.
    expect(body.body.waist_latest).toMatchObject({ value: 41, source: 'manual' });
    expect(body.body.waist_latest.recorded_at).toContain('2026-07-01');
    expect(body.body.neck_latest).toBeNull();

    // Recovery averages over the days that exist.
    expect(body.recovery.hrv_rmssd_avg).toBe(42);
    expect(body.recovery.readiness_score_avg).toBe(80);
    expect(body.recovery.sleep_duration_avg).toBe(7);
    expect(body.recovery.sleep_score_avg).toBeNull();

    // Frequency goals: active only, session counts vs per_week.
    expect(body.frequency_goals).toHaveLength(2);
    const byTypeGoal = Object.fromEntries(
      body.frequency_goals.map((g: { session_type: string }) => [g.session_type, g]),
    );
    expect(byTypeGoal.strength).toMatchObject({ per_week: 3, completed: 2, met: false });
    expect(byTypeGoal.cardio).toMatchObject({ per_week: 1, completed: 1, met: true });

    // The check-in row rides along.
    expect(body.checkin).toMatchObject({ week_start: WEEK, working: 'consistency', days_logged: 6 });

    // Prior-week deltas (prior: weights 203/202, hrv 38, 2 sessions).
    expect(body.prior_week_deltas).toEqual({
      weight_avg: -1.9,
      weight_min: -2.2,
      days_weighed: 1,
      body_fat_pct_avg: null,
      fat_free_mass_avg: null,
      hrv_rmssd_avg: 4,
      readiness_score_avg: null,
      sleep_score_avg: null,
      sleep_duration_avg: null,
      sessions_total: 1,
    });
  });

  it('empty week: zero counts, null aggregates, null deltas except counts', async () => {
    const token = fullToken();
    await seedEverything(token);
    const { res, body } = await getRollup(token, '2025-01-06');
    expect(res.status).toBe(200);
    expect(body.sessions.total).toBe(0);
    expect(body.body.weight_avg).toBeNull();
    expect(body.body.weight_min).toBeNull();
    expect(body.body.days_weighed).toBe(0);
    expect(body.body.waist_latest).toBeNull(); // nothing recorded before 2025
    expect(body.recovery.hrv_rmssd_avg).toBeNull();
    expect(body.checkin).toBeNull();
    // Active goals still report progress (0 sessions logged).
    const strengthGoal = body.frequency_goals.find(
      (g: { session_type: string }) => g.session_type === 'strength',
    );
    expect(strengthGoal).toMatchObject({ completed: 0, met: false });
    expect(body.prior_week_deltas).toMatchObject({
      weight_avg: null,
      sessions_total: 0,
      days_weighed: 0,
    });
  });

  it("never mixes in another user's data", async () => {
    const ownerToken = fullToken();
    await seedEverything(ownerToken);
    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['read:fitness']);
    const { body } = await getRollup(viewerToken);
    expect(body.sessions.total).toBe(0);
    expect(body.body.weight_avg).toBeNull();
    expect(body.frequency_goals).toEqual([]);
    expect(body.checkin).toBeNull();
  });
});
