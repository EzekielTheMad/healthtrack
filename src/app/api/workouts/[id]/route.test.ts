// @vitest-environment node
/**
 * /api/workouts/{id} (session-authenticated) — the History tab's edit/delete
 * seam: PATCH partial fields + full entry replacement, 409 dedupe collisions,
 * DELETE with cascade, 401/404 guards.
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

let ctx: RepoTestDb;
let route: RouteModule;
let workoutsRepo: WorkoutsRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-workout-id-');
  route = await import('./route');
  workoutsRepo = await import('@/lib/repos/workouts');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

async function seedSession(startedAt: string) {
  const { workout } = await workoutsRepo.createWorkout(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    {
      type: 'strength',
      label: 'Day A',
      startedAt,
      entries: [{ exerciseName: 'Bench press', sets: [{ weight: 200, reps: 10 }] }],
    },
  );
  return workout;
}

function patch(id: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/workouts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return route.PATCH(request, { params: Promise.resolve({ id }) });
}

function del(id: string) {
  const request = new NextRequest(`http://localhost/api/workouts/${id}`, {
    method: 'DELETE',
  });
  return route.DELETE(request, { params: Promise.resolve({ id }) });
}

describe('PATCH /api/workouts/{id}', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await patch('some-id', { label: 'x' });
    expect(res.status).toBe(401);
  });

  it('404s a stranger probing another user session', async () => {
    const workout = await seedSession('2026-07-07T17:00:00Z');
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await patch(workout.id, { label: 'hijack' });
    expect(res.status).toBe(404);
  });

  it('patches session fields and replaces entries, snake_cased', async () => {
    const workout = await seedSession('2026-07-07T17:00:00Z');
    const res = await patch(workout.id, {
      label: 'Day B',
      energy: 4,
      entries: [
        {
          exercise_name: 'Leg press',
          sets: [{ weight: 330, reps: 12, per_side: false }],
          raw_sets: '330x12',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ label: 'Day B', energy: 4 });
    const entries = body.entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      raw_sets: '330x12',
      working_weight: 330,
      top_reps: 12,
    });
    expect((entries[0].exercise as Record<string, unknown>).name).toBe('Leg press');
  });

  it('409s when moving started_at onto another session', async () => {
    await seedSession('2026-07-07T17:00:00Z');
    const second = await seedSession('2026-07-08T17:00:00Z');
    const res = await patch(second.id, { started_at: '2026-07-07T17:00:00Z' });
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/workouts/{id}', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await del('some-id');
    expect(res.status).toBe(401);
  });

  it('404s a stranger', async () => {
    const workout = await seedSession('2026-07-07T17:00:00Z');
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await del(workout.id);
    expect(res.status).toBe(404);
  });

  it('deletes the session (204) and the row is gone', async () => {
    const workout = await seedSession('2026-07-07T17:00:00Z');
    const res = await del(workout.id);
    expect(res.status).toBe(204);
    const rows = await workoutsRepo.listWorkouts(OWNER, { ownerId: OWNER, dependentId: null });
    expect(rows).toHaveLength(0);
  });
});
