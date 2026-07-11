// @vitest-environment node
/**
 * GET /api/health-summary — pins the clinical-correctness fix (review I1):
 * the VITALS fetch is owner-scoped (dependent_id NULL) so per-metric
 * aggregates never blend a dependent's readings into the owner's trends.
 * Other domains (conditions, meds, ...) keep the legacy unfiltered scope.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { HealthSummary, HealthSummaryInput } from '@/lib/claude/health-summary';

const { authState, captured } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  captured: {
    input: null as HealthSummaryInput | null,
    // What the mocked model call returns — tests override per case.
    result: { summary: 'ok', highlights: [] } as HealthSummary,
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
      return captured.result;
    },
  };
});

type RouteModule = typeof import('./route');
type SummaryModule = typeof import('@/lib/claude/health-summary');

let ctx: RepoTestDb;
let route: RouteModule;
let summary: SummaryModule;
let savedApiKey: string | undefined;

beforeEach(async () => {
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  ctx = await setupRepoDb('healthtrack-health-summary-');
  route = await import('./route');
  summary = await import('@/lib/claude/health-summary');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
  captured.input = null;
  captured.result = { summary: 'ok', highlights: [] };
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

    const res = await route.GET();
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

    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(captured.input!.conditions.map((c) => c.name)).toContain('Asthma');
  });

  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.GET();
    expect(res.status).toBe(401);
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

    const res = await route.GET();
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

    // Visible before any dismissal.
    let body = (await (await route.GET()).json()) as HealthSummary;
    expect(body.highlights).toHaveLength(2);

    // Dismiss via the repo (the POST route is a thin wrapper over it).
    const repo = await import('@/lib/repos/lab-warning-dismissals');
    await repo.dismissLabWarnings(OWNER, ['LDL Cholesterol']);

    body = (await (await route.GET()).json()) as HealthSummary;
    expect(body.highlights).toHaveLength(1);
    expect(body.highlights[0].text).toBe('Book a follow-up.');

    // Newer lab data → the warning is eligible again.
    insertLabVisitWithFlag({ visitDate: '2026-07-01', testName: 'LDL Cholesterol', flag: 'high' });
    body = (await (await route.GET()).json()) as HealthSummary;
    expect(body.highlights).toHaveLength(2);
  });
});
