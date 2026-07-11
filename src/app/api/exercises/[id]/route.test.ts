// @vitest-environment node
/**
 * /api/exercises/{id} (session-authenticated, PATCH) — the cleanup card's
 * rename/alias/confirm seam: happy path, 400 resolution collisions,
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
type ExercisesRepo = typeof import('@/lib/repos/exercises');

let ctx: RepoTestDb;
let route: RouteModule;
let exercisesRepo: ExercisesRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-exercise-id-');
  route = await import('./route');
  exercisesRepo = await import('@/lib/repos/exercises');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function patch(id: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/exercises/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return route.PATCH(request, { params: Promise.resolve({ id }) });
}

describe('PATCH /api/exercises/{id}', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await patch('some-id', { name: 'x' });
    expect(res.status).toBe(401);
  });

  it('404s a stranger probing another user exercise', async () => {
    const row = await exercisesRepo.createExercise(OWNER, OWNER, { name: 'Leg press' });
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await patch(row.id, { name: 'hijack' });
    expect(res.status).toBe(404);
  });

  it('renames, aliases and confirms an unreviewed exercise', async () => {
    const row = await exercisesRepo.createExercise(OWNER, OWNER, {
      name: 'legpress',
      reviewStatus: 'unreviewed',
    });
    const res = await patch(row.id, {
      name: 'Leg press',
      aliases: ['legpress'],
      review_status: 'confirmed',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: 'Leg press',
      aliases: ['legpress'],
      review_status: 'confirmed',
    });
  });

  it('400s a rename that collides with another exercise resolution key', async () => {
    await exercisesRepo.createExercise(OWNER, OWNER, { name: 'Leg press' });
    const row = await exercisesRepo.createExercise(OWNER, OWNER, {
      name: 'legpress machine',
      reviewStatus: 'unreviewed',
    });
    const res = await patch(row.id, { name: 'LEG PRESS' });
    expect(res.status).toBe(400);
  });
});
