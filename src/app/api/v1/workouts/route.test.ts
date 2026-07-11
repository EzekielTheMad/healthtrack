// @vitest-environment node
/**
 * v1 workouts endpoints — GET/POST /api/v1/workouts and
 * GET/PATCH/DELETE /api/v1/workouts/{id}.
 *
 * Covers the PAT auth matrix (401 / wrong-scope 403), snake_case wire shapes
 * with nested entries + derived stats, exercise auto-create on unknown names,
 * the 409 dedupe contract (existing workout in the body), PATCH entry
 * replacement and started_at-collision 409, list filters, and cross-user 404s.
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

let ctx: RepoTestDb;
let collection: CollectionRoute;
let item: ItemRoute;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-workouts-');
  [collection, item] = await Promise.all([import('./route'), import('./[id]/route')]);
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

const WORKOUT = {
  type: 'strength',
  label: 'Day A',
  started_at: '2026-07-09T17:30:00-07:00',
  duration_min: 55,
  energy: 4,
  entries: [
    {
      exercise_name: 'Chest press',
      raw_sets: '130x10 x3',
      sets: [
        { weight: 130, reps: 10 },
        { weight: 130, reps: 10 },
        { weight: 120, reps: 12, warmup: true },
      ],
    },
    { exercise_name: 'Plank', sets: [{ seconds: 75 }] },
  ],
};

async function createWorkout(token: string, body: unknown = WORKOUT) {
  return collection.POST(req('/api/v1/workouts', token, 'POST', body));
}

describe('auth matrix', () => {
  it('401 without a token (GET and POST)', async () => {
    expect((await collection.GET(req('/api/v1/workouts', null))).status).toBe(401);
    expect(
      (await collection.POST(req('/api/v1/workouts', null, 'POST', WORKOUT))).status,
    ).toBe(401);
  });

  it('403 for tokens without read:fitness on GET (vitals scopes do not leak)', async () => {
    for (const scopes of [['read:vitals'], ['write:fitness'], ['write:all']]) {
      const res = await collection.GET(req('/api/v1/workouts', mintApiToken(ctx.sqlite, OWNER, scopes)));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('read:fitness');
    }
  });

  it('403 for tokens without write:fitness on POST', async () => {
    for (const scopes of [['read:fitness'], ['read:all'], ['write:vitals']]) {
      const res = await createWorkout(mintApiToken(ctx.sqlite, OWNER, scopes));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('write:fitness');
    }
  });

  it('read:all / write:all satisfy the fitness scopes', async () => {
    const writeAll = mintApiToken(ctx.sqlite, OWNER, ['write:all']);
    expect((await createWorkout(writeAll)).status).toBe(201);
    const readAll = mintApiToken(ctx.sqlite, OWNER, ['read:all']);
    expect((await collection.GET(req('/api/v1/workouts', readAll))).status).toBe(200);
  });
});

describe('POST /api/v1/workouts', () => {
  it('201: nested entries, resolved exercises, derived stats, snake_case wire', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const res = await createWorkout(token);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      type: 'strength',
      label: 'Day A',
      started_at: '2026-07-10T00:30:00.000Z', // normalized to UTC
      duration_min: 55,
      energy: 4,
    });
    expect(body.entries).toHaveLength(2);
    const [press, plank] = body.entries;
    // Derived from the heaviest NON-WARMUP set.
    expect(press).toMatchObject({
      position: 0,
      raw_sets: '130x10 x3',
      working_weight: 130,
      top_reps: 10,
      top_seconds: null,
    });
    expect(press.sets[2]).toEqual({ weight: 120, reps: 12, warmup: true });
    expect(press.exercise).toMatchObject({ name: 'Chest press', mode: 'weight' });
    // Auto-created catalog entries arrive unreviewed.
    expect(press.exercise.review_status).toBe('unreviewed');
    expect(plank).toMatchObject({ position: 1, working_weight: null });
    // camelCase leak check: no startedAt/workingWeight keys on the wire.
    expect(body.startedAt).toBeUndefined();
    expect(press.workingWeight).toBeUndefined();
  });

  it('409 on (user, started_at) collision, carrying the EXISTING workout', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const first = await createWorkout(token);
    const firstBody = await first.json();

    const res = await createWorkout(token, { ...WORKOUT, label: 'Day A duplicate' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already exists');
    expect(body.workout.id).toBe(firstBody.id);
    expect(body.workout.label).toBe('Day A'); // the existing one, not the dupe

    const count = ctx.sqlite
      .prepare('select count(*) as n from workout_sessions')
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('400 for validation failures (enum, bounds, set shape) and malformed JSON', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    expect((await createWorkout(token, { ...WORKOUT, type: 'swimming' })).status).toBe(400);
    expect((await createWorkout(token, { ...WORKOUT, energy: 9 })).status).toBe(400);
    const badSet = {
      ...WORKOUT,
      entries: [{ exercise_name: 'Chest press', sets: [{ per_side: true }] }],
    };
    const res = await createWorkout(token, badSet);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('at least one of weight, reps or seconds');
    expect((await createWorkout(token, '{nope')).status).toBe(400);
  });

  it('reuses catalog entries via case-insensitive name match', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    await createWorkout(token);
    await createWorkout(token, {
      ...WORKOUT,
      started_at: '2026-07-11T17:30:00-07:00',
      entries: [{ exercise_name: 'CHEST PRESS', sets: [{ weight: 135, reps: 8 }] }],
    });
    const count = ctx.sqlite
      .prepare("select count(*) as n from exercises where lower(name) = 'chest press'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('GET /api/v1/workouts', () => {
  it('lists newest first with from/to/type/label filters', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    await createWorkout(token, { type: 'strength', label: 'Day A', started_at: '2026-07-06T18:00:00Z', entries: [] });
    await createWorkout(token, { type: 'cardio', label: 'Treadmill', started_at: '2026-07-08T18:00:00Z', entries: [] });
    await createWorkout(token, { type: 'strength', label: 'Day B', started_at: '2026-07-10T18:00:00Z', entries: [] });

    const all = await (await collection.GET(req('/api/v1/workouts', token))).json();
    expect(all.map((w: { label: string }) => w.label)).toEqual(['Day B', 'Treadmill', 'Day A']);

    const strength = await (
      await collection.GET(req('/api/v1/workouts?type=strength', token))
    ).json();
    expect(strength).toHaveLength(2);

    const windowed = await (
      await collection.GET(req('/api/v1/workouts?from=2026-07-07&to=2026-07-08', token))
    ).json();
    // `to` is an inclusive day — the Jul 8 18:00Z session must be included.
    expect(windowed.map((w: { label: string }) => w.label)).toEqual(['Treadmill']);

    const labeled = await (
      await collection.GET(req('/api/v1/workouts?label=Day%20A', token))
    ).json();
    expect(labeled).toHaveLength(1);
  });

  it('400 for an unknown type filter', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness']);
    expect((await collection.GET(req('/api/v1/workouts?type=yoga', token))).status).toBe(400);
  });

  it("never returns another user's sessions", async () => {
    const ownerToken = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['read:fitness']);
    await createWorkout(ownerToken);
    const viewerList = await (await collection.GET(req('/api/v1/workouts', viewerToken))).json();
    expect(viewerList).toEqual([]);
  });
});

describe('GET/PATCH/DELETE /api/v1/workouts/{id}', () => {
  async function seedWorkout(token: string): Promise<string> {
    const body = await (await createWorkout(token)).json();
    return body.id;
  }

  it('GET returns the workout; cross-user probes see 404', async () => {
    const ownerToken = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    const id = await seedWorkout(ownerToken);

    const res = await item.GET(req(`/api/v1/workouts/${id}`, ownerToken), params(id));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(id);

    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['read:fitness', 'write:fitness']);
    expect((await item.GET(req(`/api/v1/workouts/${id}`, viewerToken), params(id))).status).toBe(404);
    expect(
      (await item.PATCH(req(`/api/v1/workouts/${id}`, viewerToken, 'PATCH', { label: 'x' }), params(id))).status,
    ).toBe(404);
    expect(
      (await item.DELETE(req(`/api/v1/workouts/${id}`, viewerToken, 'DELETE'), params(id))).status,
    ).toBe(404);
    expect(
      (await item.GET(req('/api/v1/workouts/nope', ownerToken), params('nope'))).status,
    ).toBe(404);
  });

  it('PATCH updates partial fields; entries present = full replacement', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const id = await seedWorkout(token);

    const fieldsOnly = await item.PATCH(
      req(`/api/v1/workouts/${id}`, token, 'PATCH', { label: 'Day A (fixed)', energy: 5 }),
      params(id),
    );
    expect(fieldsOnly.status).toBe(200);
    const afterFields = await fieldsOnly.json();
    expect(afterFields.label).toBe('Day A (fixed)');
    expect(afterFields.entries).toHaveLength(2); // untouched without `entries`

    const replaced = await item.PATCH(
      req(`/api/v1/workouts/${id}`, token, 'PATCH', {
        entries: [{ exercise_name: 'Chest press', sets: [{ weight: 140, reps: 8 }] }],
      }),
      params(id),
    );
    const afterReplace = await replaced.json();
    expect(afterReplace.entries).toHaveLength(1);
    expect(afterReplace.entries[0].working_weight).toBe(140);
  });

  it('PATCH moving started_at onto another session → 409 with existing_id', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const id = await seedWorkout(token);
    const otherRes = await createWorkout(token, {
      ...WORKOUT,
      started_at: '2026-07-11T17:30:00Z',
      entries: [],
    });
    const other = await otherRes.json();

    const res = await item.PATCH(
      req(`/api/v1/workouts/${id}`, token, 'PATCH', { started_at: '2026-07-11T17:30:00Z' }),
      params(id),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existing_id).toBe(other.id);
  });

  it('DELETE returns 204 and cascades entries', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const id = await seedWorkout(token);
    const res = await item.DELETE(req(`/api/v1/workouts/${id}`, token, 'DELETE'), params(id));
    expect(res.status).toBe(204);
    const entries = ctx.sqlite
      .prepare('select count(*) as n from exercise_entries')
      .get() as { n: number };
    expect(entries.n).toBe(0);
  });
});

describe('CORS', () => {
  it('collection allows GET, POST, OPTIONS; item allows GET, PATCH, DELETE, OPTIONS', async () => {
    expect((await collection.OPTIONS()).headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, POST, OPTIONS',
    );
    expect((await item.OPTIONS()).headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, PATCH, DELETE, OPTIONS',
    );
  });
});
