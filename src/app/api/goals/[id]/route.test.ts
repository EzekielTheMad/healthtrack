// @vitest-environment node
/**
 * /api/goals/{id} (session-authenticated, PATCH) — the Goals tab's edit
 * seam: active toggles, 409 one-active-per-key conflicts, 401/404 guards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
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
  ctx = await setupRepoDb('healthtrack-api-goal-id-');
  route = await import('./route');
  goalsRepo = await import('@/lib/repos/goals');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function patch(id: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/goals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return route.PATCH(request, { params: Promise.resolve({ id }) });
}

describe('PATCH /api/goals/{id}', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await patch('some-id', { active: false });
    expect(res.status).toBe(401);
  });

  it('404s a stranger probing another user goal', async () => {
    const goal = await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'metric',
      metricKey: 'weight',
      direction: 'decrease',
    });
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await patch(goal.id, { active: false });
    expect(res.status).toBe(404);
  });

  it('toggles active and retargets, snake_cased', async () => {
    const goal = await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'metric',
      metricKey: 'weight',
      direction: 'decrease',
      targetValue: 210,
    });
    const res = await patch(goal.id, { active: false, target_value: 205 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active: false, target_value: 205 });
  });

  it('409s re-activating into an occupied active slot', async () => {
    const inactive = await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'frequency',
      sessionType: 'strength',
      perWeek: 2,
      active: false,
    });
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'frequency',
      sessionType: 'strength',
      perWeek: 3,
    });
    const res = await patch(inactive.id, { active: true });
    expect(res.status).toBe(409);
  });
});
