// @vitest-environment node
/**
 * /api/exercises (session-authenticated, GET) — the trends picker and
 * cleanup card's catalog source: snake_cased rows with aliases,
 * ?review_status= filter, 401/404 guards.
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
type ExercisesRepo = typeof import('@/lib/repos/exercises');

let ctx: RepoTestDb;
let route: RouteModule;
let exercisesRepo: ExercisesRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-exercises-');
  route = await import('./route');
  exercisesRepo = await import('@/lib/repos/exercises');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function get(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/exercises${query}`);
}

describe('GET /api/exercises', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.GET(get());
    expect(res.status).toBe(401);
  });

  it('lists the catalog snake_cased with aliases, filtered by ?review_status=', async () => {
    await exercisesRepo.createExercise(OWNER, OWNER, {
      name: 'Leg press',
      aliases: ['Leg Press Machine'],
    });
    await exercisesRepo.createExercise(OWNER, OWNER, {
      name: 'Dead hang',
      mode: 'time',
      reviewStatus: 'unreviewed',
    });

    const all = (await (await route.GET(get())).json()) as Array<Record<string, unknown>>;
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.name === 'Leg press')).toMatchObject({
      review_status: 'confirmed',
      aliases: ['Leg Press Machine'],
      mode: 'weight',
    });

    const unreviewed = (await (
      await route.GET(get('?review_status=unreviewed'))
    ).json()) as Array<Record<string, unknown>>;
    expect(unreviewed).toHaveLength(1);
    expect(unreviewed[0].name).toBe('Dead hang');
  });

  it('404s a stranger probing another owner via ?owner_id=', async () => {
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await route.GET(get(`?owner_id=${OWNER}`));
    expect(res.status).toBe(404);
  });
});
