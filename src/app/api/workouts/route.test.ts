// @vitest-environment node
/**
 * /api/workouts (session-authenticated, GET only) — the Focus view's source
 * for frequency-goal week counting: from/to/type filters, snake_cased nested
 * shape, 401 without a session.
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
type WorkoutsRepo = typeof import('@/lib/repos/workouts');

let ctx: RepoTestDb;
let route: RouteModule;
let workoutsRepo: WorkoutsRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-workouts-');
  route = await import('./route');
  workoutsRepo = await import('@/lib/repos/workouts');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function get(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/workouts${query}`);
}

async function seedSession(startedAt: string, type = 'strength') {
  await workoutsRepo.createWorkout(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    { type, startedAt, entries: [{ exerciseName: 'Bench press', sets: [] }] },
  );
}

describe('GET /api/workouts', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.GET(get());
    expect(res.status).toBe(401);
  });

  it('lists sessions snake_cased with nested entries', async () => {
    await seedSession('2026-07-07T17:00:00Z');
    const res = await route.GET(get());
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'strength',
      started_at: '2026-07-07T17:00:00.000Z',
      user_id: OWNER,
    });
    const entries = rows[0].entries as Array<Record<string, unknown>>;
    expect(entries[0].raw_sets).toBeNull(); // deep snake conversion
  });

  it('filters by from/to bounds and type', async () => {
    await seedSession('2026-07-01T17:00:00Z');
    await seedSession('2026-07-08T17:00:00Z');
    await seedSession('2026-07-09T17:00:00Z', 'cardio');

    const windowed = (await (
      await route.GET(get('?from=2026-07-06T00:00:00Z'))
    ).json()) as Array<Record<string, unknown>>;
    expect(windowed).toHaveLength(2);

    const typed = (await (
      await route.GET(get('?from=2026-07-06T00:00:00Z&type=cardio'))
    ).json()) as Array<Record<string, unknown>>;
    expect(typed).toHaveLength(1);
    expect(typed[0].type).toBe('cardio');
  });

  it('404s a stranger probing another owner via ?owner_id=', async () => {
    insertUser(ctx.sqlite, 'stranger-user-000000000000000000');
    authState.userId = 'stranger-user-000000000000000000';
    const res = await route.GET(get(`?owner_id=${OWNER}`));
    expect(res.status).toBe(404);
  });
});
