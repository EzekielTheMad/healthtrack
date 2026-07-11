// @vitest-environment node
/**
 * /api/weeks/{weekStart} (session-authenticated, GET) — the Weekly tab's
 * rollup source (shared src/lib/fitness/rollup.ts): session counts,
 * frequency-goal progress, embedded check-in, Monday validation,
 * 401/404 guards.
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

const MONDAY = '2026-07-06';

let ctx: RepoTestDb;
let route: RouteModule;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-weeks-');
  route = await import('./route');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function get(weekStart: string, query = '') {
  const request = new NextRequest(`http://localhost/api/weeks/${weekStart}${query}`);
  return route.GET(request, { params: Promise.resolve({ weekStart }) });
}

describe('GET /api/weeks/{weekStart}', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await get(MONDAY);
    expect(res.status).toBe(401);
  });

  it('400s a non-Monday week key', async () => {
    const res = await get('2026-07-07');
    expect(res.status).toBe(400);
  });

  it('404s a stranger probing another owner via ?owner_id=', async () => {
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await get(MONDAY, `?owner_id=${OWNER}`);
    expect(res.status).toBe(404);
  });

  it('serves the deep-snake_cased rollup with sessions and goal progress', async () => {
    const workoutsRepo = await import('@/lib/repos/workouts');
    const goalsRepo = await import('@/lib/repos/goals');
    const checkinsRepo = await import('@/lib/repos/checkins');

    // Tuesday 10:00 Phoenix time — inside the MONDAY week.
    await workoutsRepo.createWorkout(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      { type: 'strength', label: 'Day A', startedAt: '2026-07-07T17:00:00Z', entries: [] },
    );
    await goalsRepo.createGoal(OWNER, OWNER, {
      kind: 'frequency',
      sessionType: 'strength',
      perWeek: 3,
    });
    await checkinsRepo.upsertCheckin(OWNER, OWNER, MONDAY, { working: 'consistency' });

    const res = await get(MONDAY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ week_start: MONDAY, week_end: '2026-07-12' });

    const sessions = body.sessions as {
      total: number;
      by_type: Record<string, { count: number; labels: string[] }>;
    };
    expect(sessions.total).toBe(1);
    expect(sessions.by_type.strength).toEqual({ count: 1, labels: ['Day A'] });

    const goals = body.frequency_goals as Array<Record<string, unknown>>;
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      session_type: 'strength',
      per_week: 3,
      completed: 1,
      met: false,
    });

    expect(body.checkin).toMatchObject({ working: 'consistency' });
    expect(body.prior_week_deltas).toMatchObject({ sessions_total: 1 });
  });
});
