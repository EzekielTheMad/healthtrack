// @vitest-environment node
/**
 * GET /api/health-summary — cache-first read path + the clinical-correctness
 * pin (review I1: the VITALS fetch is owner-scoped so per-metric aggregates
 * never blend a dependent's readings into the owner's trends).
 *
 * The overview is now precomputed and cached daily (daily_summaries). This
 * suite covers the read-path decision flow: cache hit (no model call),
 * stale-serve + background regeneration, first-ever synchronous generate, and
 * generation-failure-keeps-last-good.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { HealthSummary, HealthSummaryInput } from '@/lib/claude/health-summary';
import { shiftDayKey } from '@/lib/dates';

const { authState, captured } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  captured: {
    input: null as HealthSummaryInput | null,
    // What the mocked model call returns — tests override per case.
    result: { summary: 'ok', highlights: [] } as HealthSummary,
    // Number of times the model was invoked — pins "no model call on cache hit".
    calls: 0,
    // When true the mocked model throws (generation-failure cases).
    shouldThrow: false,
  },
}));

vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {
    readonly status = 401;
  }
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!authState.userId) throw new UnauthorizedError();
      return { id: authState.userId, email: `${authState.userId}@example.com` };
    },
    getUser: async () => (authState.userId ? { id: authState.userId } : null),
  };
});

// Keep buildHealthSnapshot real; capture the input the route hands the model.
vi.mock('@/lib/claude/health-summary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/claude/health-summary')>();
  return {
    ...actual,
    generateHealthSummary: async (input: HealthSummaryInput) => {
      captured.input = input;
      captured.calls += 1;
      if (captured.shouldThrow) throw new Error('model boom');
      return captured.result;
    },
  };
});

type RouteModule = typeof import('./route');
type SummaryModule = typeof import('@/lib/claude/health-summary');
type CacheModule = typeof import('@/lib/claude/summary-cache');
type DailyRepo = typeof import('@/lib/repos/daily-summaries');

let ctx: RepoTestDb;
let route: RouteModule;
let summary: SummaryModule;
let cacheMod: CacheModule;
let dailyRepo: DailyRepo;
let savedApiKey: string | undefined;

/** A GET request; the route reads `?refresh=1` off the URL. */
function req(url = 'http://localhost/api/health-summary'): NextRequest {
  return new NextRequest(url);
}

beforeEach(async () => {
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  ctx = await setupRepoDb('healthtrack-health-summary-');
  route = await import('./route');
  summary = await import('@/lib/claude/health-summary');
  cacheMod = await import('@/lib/claude/summary-cache');
  dailyRepo = await import('@/lib/repos/daily-summaries');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
  captured.input = null;
  captured.result = { summary: 'ok', highlights: [] };
  captured.calls = 0;
  captured.shouldThrow = false;
});

afterEach(() => {
  if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedApiKey;
  authState.userId = null;
  ctx.restore();
});

function insertVital(opts: {
  userId: string;
  dependentId: string | null;
  metricKey: string;
  value: number;
  unit: string | null;
  recordedAt: string;
}) {
  ctx.sqlite
    .prepare(
      `insert into vitals (id, user_id, metric_key, value, unit, source, recorded_at, metadata, dependent_id, created_at)
       values (?, ?, ?, ?, ?, 'manual', ?, '{}', ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      opts.userId,
      opts.metricKey,
      opts.value,
      opts.unit,
      opts.recordedAt,
      opts.dependentId,
      new Date().toISOString(),
    );
}

function dayISO(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return `${d.toISOString().slice(0, 10)}T00:00:00Z`;
}

/** Seed one condition so the snapshot has data (else the model is skipped). */
function seedData() {
  const now = new Date().toISOString();
  ctx.sqlite
    .prepare(
      `insert into conditions (id, user_id, name, status, created_at, updated_at)
       values (?, ?, 'Hypertension', 'active', ?, ?)`,
    )
    .run(crypto.randomUUID(), OWNER, now, now);
}

/** Insert a daily_summaries cache row directly. */
function insertCacheRow(date: string, s: HealthSummary, generatedAt = new Date().toISOString()) {
  ctx.sqlite
    .prepare(
      `insert into daily_summaries (id, user_id, summary_date, summary_json, generated_at, model)
       values (?, ?, ?, ?, ?, 'test-model')`,
    )
    .run(crypto.randomUUID(), OWNER, date, JSON.stringify(s), generatedAt);
}

describe('GET /api/health-summary — vitals scope (I1)', () => {
  it("aggregates only the owner's vitals; a dependent's same-metric rows never blend in", async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);

    // Owner weighs 180 lbs; the dependent (a child) weighs 62 lbs the same day.
    insertVital({
      userId: OWNER,
      dependentId: null,
      metricKey: 'weight',
      value: 180,
      unit: 'lbs',
      recordedAt: dayISO(2),
    });
    insertVital({
      userId: OWNER,
      dependentId: depId,
      metricKey: 'weight',
      value: 62,
      unit: 'lbs',
      recordedAt: dayISO(2),
    });

    const res = await route.GET(req());
    expect(res.status).toBe(200);
    expect(captured.input).not.toBeNull();

    // Only the owner's row reaches the prompt input...
    expect(captured.input!.vitals).toHaveLength(1);
    expect(captured.input!.vitals[0].value).toBe(180);

    // ...and the built prompt reflects the owner's value, not the blended
    // (180 + 62) / 2 = 121 average or the dependent's 62.
    const snapshot = summary.buildHealthSnapshot(captured.input!);
    expect(snapshot).toContain('180');
    expect(snapshot).not.toContain('121');
    expect(snapshot).not.toContain('62');
  });

  it('other domains keep the unfiltered scope (dependent conditions still included)', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    ctx.sqlite
      .prepare(
        `insert into conditions (id, user_id, name, status, dependent_id, created_at, updated_at)
         values (?, ?, 'Asthma', 'active', ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), OWNER, depId, new Date().toISOString(), new Date().toISOString());

    const res = await route.GET(req());
    expect(res.status).toBe(200);
    expect(captured.input!.conditions.map((c) => c.name)).toContain('Asthma');
  });

  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.GET(req());
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Cache-first read path (daily_summaries)
// ---------------------------------------------------------------------------

describe('GET /api/health-summary — cache-first read path', () => {
  it('cache hit: today\'s row is served instantly with no model call', async () => {
    seedData();
    const today = cacheMod.ownerLocalDayKey();
    insertCacheRow(today, {
      summary: 'Cached overview from earlier today.',
      highlights: [{ type: 'positive', text: 'All good.' }],
    });

    const res = await route.GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe('Cached overview from earlier today.');
    expect(body.cached).toBe(true);
    expect(body.stale).toBe(false);
    // The whole point: a cache hit never calls the reasoning model.
    expect(captured.calls).toBe(0);
  });

  it('first-ever: no cache → generate synchronously, cache it, return fresh', async () => {
    seedData();
    captured.result = { summary: 'Freshly generated.', highlights: [] };

    const res = await route.GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe('Freshly generated.');
    expect(body.cached).toBe(false);
    expect(body.stale).toBe(false);
    expect(captured.calls).toBe(1);

    // Today's row now exists for the next reader.
    const today = cacheMod.ownerLocalDayKey();
    const row = await dailyRepo.getCachedSummary(OWNER, today);
    expect(row).not.toBeNull();
    expect(dailyRepo.parseCachedSummary(row!).summary).toBe('Freshly generated.');
  });

  it('stale-serve: older row returned instantly, today warmed in the background', async () => {
    seedData();
    const yesterday = shiftDayKey(cacheMod.ownerLocalDayKey(), -1);
    insertCacheRow(yesterday, { summary: 'Yesterday overview.', highlights: [] });
    captured.result = { summary: 'Freshly regenerated today.', highlights: [] };

    const res = await route.GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Last good summary served immediately, flagged stale.
    expect(body.summary).toBe('Yesterday overview.');
    expect(body.stale).toBe(true);
    expect(body.cached).toBe(true);

    // Background regeneration warms today's cache (fire-and-forget).
    const today = cacheMod.ownerLocalDayKey();
    await vi.waitFor(async () => {
      const row = await dailyRepo.getCachedSummary(OWNER, today);
      expect(row).not.toBeNull();
      expect(dailyRepo.parseCachedSummary(row!).summary).toBe('Freshly regenerated today.');
    });
    expect(captured.calls).toBe(1);
  });

  it('generation failure keeps the last good row (never overwrites)', async () => {
    seedData();
    const yesterday = shiftDayKey(cacheMod.ownerLocalDayKey(), -1);
    insertCacheRow(yesterday, { summary: 'Last good overview.', highlights: [] });
    captured.shouldThrow = true;

    const res = await route.GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Still serves the last good summary, not an error.
    expect(body.summary).toBe('Last good overview.');
    expect(body.stale).toBe(true);

    // Background regen was attempted and threw — nothing written for today, and
    // the good row is untouched.
    await vi.waitFor(() => expect(captured.calls).toBe(1));
    const today = cacheMod.ownerLocalDayKey();
    expect(await dailyRepo.getCachedSummary(OWNER, today)).toBeNull();
    const good = await dailyRepo.getCachedSummary(OWNER, yesterday);
    expect(dailyRepo.parseCachedSummary(good!).summary).toBe('Last good overview.');
  });

  it('first-ever generation failure with no cache at all → 500', async () => {
    seedData();
    captured.shouldThrow = true;
    const res = await route.GET(req());
    expect(res.status).toBe(500);
  });

  it('manual refresh (?refresh=1) regenerates even when today is cached', async () => {
    seedData();
    const today = cacheMod.ownerLocalDayKey();
    insertCacheRow(today, { summary: 'Stale-but-today.', highlights: [] });
    captured.result = { summary: 'Force-refreshed.', highlights: [] };

    const res = await route.GET(req('http://localhost/api/health-summary?refresh=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe('Force-refreshed.');
    expect(captured.calls).toBe(1);

    const row = await dailyRepo.getCachedSummary(OWNER, today);
    expect(dailyRepo.parseCachedSummary(row!).summary).toBe('Force-refreshed.');
  });
});

// ---------------------------------------------------------------------------
// Fitness context + lab staleness/dismissals (fitness-domain spec §AI)
// ---------------------------------------------------------------------------

function insertLabVisitWithFlag(opts: {
  visitDate: string;
  testName: string;
  flag: 'high' | 'low' | 'critical';
}): void {
  const now = new Date().toISOString();
  const visitId = crypto.randomUUID();
  ctx.sqlite
    .prepare(
      `insert into lab_visits (id, user_id, visit_date, created_at) values (?, ?, ?, ?)`,
    )
    .run(visitId, OWNER, opts.visitDate, now);
  ctx.sqlite
    .prepare(
      `insert into lab_results (id, user_id, lab_visit_id, test_name, value, flag, created_at)
       values (?, ?, ?, ?, 160, ?, ?)`,
    )
    .run(crypto.randomUUID(), OWNER, visitId, opts.testName, opts.flag, now);
}

describe('GET /api/health-summary — fitness + lab-warning context', () => {
  it('passes active goals, 14-day workouts, and lab draw dates to the prompt input', async () => {
    const now = new Date().toISOString();
    ctx.sqlite
      .prepare(
        `insert into goals (id, user_id, kind, active, session_type, per_week, created_at, updated_at)
         values (?, ?, 'frequency', 1, 'strength', 3, ?, ?)`,
      )
      .run(crypto.randomUUID(), OWNER, now, now);
    // An INACTIVE goal must not reach the prompt.
    ctx.sqlite
      .prepare(
        `insert into goals (id, user_id, kind, active, metric_key, direction, created_at, updated_at)
         values (?, ?, 'metric', 0, 'weight', 'decrease', ?, ?)`,
      )
      .run(crypto.randomUUID(), OWNER, now, now);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const insertSession = ctx.sqlite.prepare(
      `insert into workout_sessions (id, user_id, type, label, started_at, created_at, updated_at)
       values (?, ?, 'strength', ?, ?, ?, ?)`,
    );
    insertSession.run(crypto.randomUUID(), OWNER, 'Upper A', recent, now, now);
    insertSession.run(crypto.randomUUID(), OWNER, 'Old session', old, now, now);
    insertLabVisitWithFlag({ visitDate: '2026-05-26', testName: 'LDL Cholesterol', flag: 'high' });

    const res = await route.GET(req());
    expect(res.status).toBe(200);

    expect(captured.input!.goals).toEqual([
      expect.objectContaining({ kind: 'frequency', sessionType: 'strength', perWeek: 3 }),
    ]);
    expect(captured.input!.recentWorkouts).toEqual([
      expect.objectContaining({ type: 'strength', label: 'Upper A' }),
    ]);
    expect(captured.input!.recentLabFlags).toEqual([
      expect.objectContaining({ test_name: 'LDL Cholesterol', visit_date: '2026-05-26' }),
    ]);
  });

  it('dismissed lab warning is hidden, then resurfaces after a newer lab visit', async () => {
    insertLabVisitWithFlag({ visitDate: '2026-05-26', testName: 'LDL Cholesterol', flag: 'high' });
    captured.result = {
      summary: 'ok',
      highlights: [
        {
          type: 'attention',
          text: 'LDL was high as of your May 26 draw.',
          labTests: ['LDL Cholesterol'],
          labAsOf: '2026-05-26',
        },
        { type: 'action', text: 'Book a follow-up.' },
      ],
    };

    // Visible before any dismissal (first read generates + caches).
    let body = (await (await route.GET(req())).json()) as HealthSummary;
    expect(body.highlights).toHaveLength(2);

    // Dismiss via the repo (the POST route is a thin wrapper over it).
    const repo = await import('@/lib/repos/lab-warning-dismissals');
    await repo.dismissLabWarnings(OWNER, ['LDL Cholesterol']);

    // Read-time filtering applies to the cached row — no regeneration needed.
    body = (await (await route.GET(req())).json()) as HealthSummary;
    expect(body.highlights).toHaveLength(1);
    expect(body.highlights[0].text).toBe('Book a follow-up.');

    // Newer lab data → the warning is eligible again (still against the cache).
    insertLabVisitWithFlag({ visitDate: '2026-07-01', testName: 'LDL Cholesterol', flag: 'high' });
    body = (await (await route.GET(req())).json()) as HealthSummary;
    expect(body.highlights).toHaveLength(2);
  });
});
