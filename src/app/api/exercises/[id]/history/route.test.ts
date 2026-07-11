// @vitest-environment node
/**
 * /api/exercises/{id}/history (session-authenticated, GET) — the trends
 * view's data source: newest-session-first entries with derived stats and
 * session context, ?limit=, 401/404 guards.
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
type WorkoutsRepo = typeof import('@/lib/repos/workouts');
type ExercisesRepo = typeof import('@/lib/repos/exercises');

let ctx: RepoTestDb;
let route: RouteModule;
let workoutsRepo: WorkoutsRepo;
let exercisesRepo: ExercisesRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-ex-history-');
  route = await import('./route');
  workoutsRepo = await import('@/lib/repos/workouts');
  exercisesRepo = await import('@/lib/repos/exercises');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function get(id: string, query = '') {
  const request = new NextRequest(`http://localhost/api/exercises/${id}/history${query}`);
  return route.GET(request, { params: Promise.resolve({ id }) });
}

async function seed() {
  const exercise = await exercisesRepo.createExercise(OWNER, OWNER, { name: 'Leg press' });
  for (const [startedAt, weight] of [
    ['2026-07-01T17:00:00Z', 300],
    ['2026-07-08T17:00:00Z', 330],
  ] as const) {
    await workoutsRepo.createWorkout(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      {
        type: 'strength',
        label: 'Day A',
        startedAt,
        entries: [
          { exerciseName: 'Leg press', sets: [{ weight, reps: 12 }], rawSets: `${weight}x12` },
        ],
      },
    );
  }
  return exercise;
}

describe('GET /api/exercises/{id}/history', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await get('some-id');
    expect(res.status).toBe(401);
  });

  it('404s a stranger probing another user exercise', async () => {
    const exercise = await seed();
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await get(exercise.id);
    expect(res.status).toBe(404);
  });

  it('serves newest-first entries with derived stats and session context', async () => {
    const exercise = await seed();
    const res = await get(exercise.id);
    expect(res.status).toBe(200);
    const items = (await res.json()) as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      working_weight: 330,
      top_reps: 12,
      raw_sets: '330x12',
    });
    expect(items[0].session).toMatchObject({
      started_at: '2026-07-08T17:00:00.000Z',
      type: 'strength',
      label: 'Day A',
    });
    expect((items[0].exercise as Record<string, unknown>).name).toBe('Leg press');
  });

  it('honors ?limit=', async () => {
    const exercise = await seed();
    const items = (await (await get(exercise.id, '?limit=1')).json()) as unknown[];
    expect(items).toHaveLength(1);
  });
});
