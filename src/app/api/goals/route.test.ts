// @vitest-environment node
/**
 * /api/goals (session-authenticated, GET only) — the UI seam for goal-aware
 * coloring: active/kind filters, snake_cased rows, 401 without a session.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
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

type RouteModule = typeof import('./route');
type GoalsRepo = typeof import('@/lib/repos/goals');

let ctx: RepoTestDb;
let route: RouteModule;
let goalsRepo: GoalsRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-goals-');
  route = await import('./route');
  goalsRepo = await import('@/lib/repos/goals');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function get(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/goals${query}`);
}

describe('GET /api/goals', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.GET(get());
    expect(res.status).toBe(401);
  });

  it('lists the caller goals snake_cased, honoring ?active=true', async () => {
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'metric',
      metricKey: 'weight',
      direction: 'decrease',
      targetValue: 200,
    });
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'frequency',
      sessionType: 'strength',
      perWeek: 3,
    });
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'metric',
      metricKey: 'hrv_rmssd',
      direction: 'increase',
      active: false,
    });

    const all = (await (await route.GET(get())).json()) as Array<Record<string, unknown>>;
    expect(all).toHaveLength(3);

    const res = await route.GET(get('?active=true'));
    expect(res.status).toBe(200);
    const active = (await res.json()) as Array<Record<string, unknown>>;
    expect(active).toHaveLength(2);
    const metric = active.find((g) => g.kind === 'metric')!;
    expect(metric).toMatchObject({
      metric_key: 'weight',
      direction: 'decrease',
      target_value: 200,
      active: true,
    });
    expect(active.find((g) => g.kind === 'frequency')).toMatchObject({
      session_type: 'strength',
      per_week: 3,
    });
  });

  it('filters by ?kind=', async () => {
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'metric',
      metricKey: 'weight',
      direction: 'maintain',
    });
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'frequency',
      sessionType: 'cardio',
      perWeek: 2,
    });
    const rows = (await (
      await route.GET(get('?kind=frequency'))
    ).json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('frequency');
  });

  it('404s a stranger probing another owner via ?owner_id=', async () => {
    insertUser(ctx.sqlite, 'stranger-user-000000000000000000');
    authState.userId = 'stranger-user-000000000000000000';
    const res = await route.GET(get(`?owner_id=${OWNER}`));
    expect(res.status).toBe(404);
  });
});

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/goals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/goals', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.POST(post({ kind: 'frequency', session_type: 'strength', per_week: 3 }));
    expect(res.status).toBe(401);
  });

  it('creates a goal from a snake_cased body (201)', async () => {
    const res = await route.POST(
      post({ kind: 'metric', metric_key: 'weight', direction: 'decrease', target_value: 210 }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      kind: 'metric',
      metric_key: 'weight',
      direction: 'decrease',
      target_value: 210,
      active: true,
    });
  });

  it('409s a second active goal for the same slot', async () => {
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'frequency',
      sessionType: 'strength',
      perWeek: 3,
    });
    const res = await route.POST(
      post({ kind: 'frequency', session_type: 'strength', per_week: 2 }),
    );
    expect(res.status).toBe(409);
  });

  it('400s an unknown metric key', async () => {
    const res = await route.POST(
      post({ kind: 'metric', metric_key: 'not_a_metric', direction: 'increase' }),
    );
    expect(res.status).toBe(400);
  });
});
