// @vitest-environment node
/**
 * v1 exercises endpoints — GET/POST /api/v1/exercises,
 * PATCH /api/v1/exercises/{id}, GET /api/v1/exercises/{id}/history.
 *
 * Covers the PAT auth matrix, catalog CRUD with alias/resolution-collision
 * 400s, the unreviewed filter, and the history contract (entries + session
 * context + derived stats, newest first, limit clamped, cross-user 404).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  mintApiToken,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

type CollectionRoute = typeof import('./route');
type ItemRoute = typeof import('./[id]/route');
type HistoryRoute = typeof import('./[id]/history/route');
type WorkoutsRoute = typeof import('../workouts/route');

let ctx: RepoTestDb;
let collection: CollectionRoute;
let item: ItemRoute;
let history: HistoryRoute;
let workouts: WorkoutsRoute;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-exercises-');
  [collection, item, history, workouts] = await Promise.all([
    import('./route'),
    import('./[id]/route'),
    import('./[id]/history/route'),
    import('../workouts/route'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

function req(url: string, token: string | null, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('auth matrix', () => {
  it('401 without a token; 403 without the fitness scopes', async () => {
    expect((await collection.GET(req('/api/v1/exercises', null))).status).toBe(401);
    const readVitals = mintApiToken(ctx.sqlite, OWNER, ['read:vitals']);
    expect((await collection.GET(req('/api/v1/exercises', readVitals))).status).toBe(403);
    const readFitness = mintApiToken(ctx.sqlite, OWNER, ['read:fitness']);
    expect(
      (await collection.POST(req('/api/v1/exercises', readFitness, 'POST', { name: 'Row' }))).status,
    ).toBe(403);
    expect(
      (await item.PATCH(req('/api/v1/exercises/x', readFitness, 'PATCH', {}), params('x'))).status,
    ).toBe(403);
    expect((await history.GET(req('/api/v1/exercises/x/history', null), params('x'))).status).toBe(401);
  });
});

describe('POST + GET /api/v1/exercises', () => {
  it('creates, lists (name ascending), and round-trips snake_case', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    const created = await collection.POST(
      req('/api/v1/exercises', token, 'POST', {
        name: 'Lat pulldown',
        variant: 'Hammer high',
        aliases: ['High pulldown'],
        review_status: 'confirmed',
      }),
    );
    expect(created.status).toBe(201);
    const row = await created.json();
    expect(row).toMatchObject({
      name: 'Lat pulldown',
      variant: 'Hammer high',
      mode: 'weight',
      aliases: ['High pulldown'],
      review_status: 'confirmed',
    });

    await collection.POST(req('/api/v1/exercises', token, 'POST', { name: 'Ab crunch' }));
    const list = await (await collection.GET(req('/api/v1/exercises', token))).json();
    expect(list.map((e: { name: string }) => e.name)).toEqual(['Ab crunch', 'Lat pulldown']);
  });

  it('400 on resolution collisions (name or alias, case-insensitive)', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    await collection.POST(
      req('/api/v1/exercises', token, 'POST', { name: 'Chest press', aliases: ['Machine press'] }),
    );
    const byName = await collection.POST(
      req('/api/v1/exercises', token, 'POST', { name: 'CHEST PRESS' }),
    );
    expect(byName.status).toBe(400);
    expect((await byName.json()).error).toContain('collides');
    const byAlias = await collection.POST(
      req('/api/v1/exercises', token, 'POST', { name: 'Incline press', aliases: ['machine PRESS'] }),
    );
    expect(byAlias.status).toBe(400);
  });

  it('filters ?review_status=unreviewed (auto-created drift) and 400s unknown values', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    await collection.POST(req('/api/v1/exercises', token, 'POST', { name: 'Confirmed one' }));
    // Auto-create through a workout write.
    await workouts.POST(
      req('/api/v1/workouts', token, 'POST', {
        type: 'strength',
        started_at: '2026-07-09T18:00:00Z',
        entries: [{ exercise_name: 'Mystery machine', sets: [{ weight: 50, reps: 10 }] }],
      }),
    );
    const unreviewed = await (
      await collection.GET(req('/api/v1/exercises?review_status=unreviewed', token))
    ).json();
    expect(unreviewed).toHaveLength(1);
    expect(unreviewed[0].name).toBe('Mystery machine');

    expect(
      (await collection.GET(req('/api/v1/exercises?review_status=meh', token))).status,
    ).toBe(400);
  });
});

describe('PATCH /api/v1/exercises/{id}', () => {
  it('renames/aliases/confirms; cross-user probes see 404', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const created = await (
      await collection.POST(req('/api/v1/exercises', token, 'POST', { name: 'Mystry machine' }))
    ).json();

    const res = await item.PATCH(
      req(`/api/v1/exercises/${created.id}`, token, 'PATCH', {
        name: 'Mystery machine',
        aliases: ['Mystry machine'],
        review_status: 'confirmed',
      }),
      params(created.id),
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe('Mystery machine');
    expect(updated.aliases).toEqual(['Mystry machine']);
    expect(updated.review_status).toBe('confirmed');

    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['write:fitness']);
    expect(
      (
        await item.PATCH(
          req(`/api/v1/exercises/${created.id}`, viewerToken, 'PATCH', { name: 'steal' }),
          params(created.id),
        )
      ).status,
    ).toBe(404);
  });
});

describe('GET /api/v1/exercises/{id}/history', () => {
  it('returns recent entries with session context, newest session first, honoring ?limit', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    for (const [day, weight] of [
      ['2026-07-01', 120],
      ['2026-07-05', 125],
      ['2026-07-09', 130],
    ] as const) {
      await workouts.POST(
        req('/api/v1/workouts', token, 'POST', {
          type: 'strength',
          label: 'Day A',
          started_at: `${day}T18:00:00Z`,
          entries: [{ exercise_name: 'Chest press', sets: [{ weight, reps: 10 }] }],
        }),
      );
    }
    const exercise = ctx.sqlite
      .prepare("select id from exercises where name = 'Chest press'")
      .get() as { id: string };

    const res = await history.GET(
      req(`/api/v1/exercises/${exercise.id}/history`, token),
      params(exercise.id),
    );
    expect(res.status).toBe(200);
    const items = await res.json();
    expect(items).toHaveLength(3);
    expect(items[0].working_weight).toBe(130);
    expect(items[0].session).toMatchObject({
      type: 'strength',
      label: 'Day A',
      started_at: '2026-07-09T18:00:00.000Z',
    });

    const limited = await (
      await history.GET(
        req(`/api/v1/exercises/${exercise.id}/history?limit=2`, token),
        params(exercise.id),
      )
    ).json();
    expect(limited).toHaveLength(2);
    expect(limited.map((i: { working_weight: number }) => i.working_weight)).toEqual([130, 125]);
  });

  it("404 for another user's exercise id and for unknown ids", async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    const created = await (
      await collection.POST(req('/api/v1/exercises', token, 'POST', { name: 'Row' }))
    ).json();
    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['read:fitness']);
    expect(
      (
        await history.GET(
          req(`/api/v1/exercises/${created.id}/history`, viewerToken),
          params(created.id),
        )
      ).status,
    ).toBe(404);
    expect(
      (await history.GET(req('/api/v1/exercises/nope/history', token), params('nope'))).status,
    ).toBe(404);
  });
});
