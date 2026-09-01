// @vitest-environment node
/**
 * GET /api/v1/nutrition/daily — PAT read surface for canonical daily intake.
 */
import crypto from 'crypto';
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

type Route = typeof import('./route');

let ctx: RepoTestDb;
let route: Route;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-nutrition-');
  route = await import('./route');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

function seed(
  userId: string,
  date: string,
  values: Partial<{ calories: number; protein: number | null }> = {},
) {
  ctx.sqlite
    .prepare(
      `insert into nutrition_daily
         (id, user_id, date, source_package, calories, protein_grams, record_count, metadata_json, created_at, updated_at)
       values (?, ?, ?, 'com.sbs.diet', ?, ?, 2, '{}', ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      userId,
      date,
      values.calories ?? 1800,
      values.protein === undefined ? 140 : values.protein,
      '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00Z',
    );
}

function get(url: string, token: string | null): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('auth', () => {
  it('401 without a token', async () => {
    const res = await route.GET(get('/api/v1/nutrition/daily', null));
    expect(res.status).toBe(401);
  });

  it('403 without read:nutrition', async () => {
    const res = await route.GET(
      get('/api/v1/nutrition/daily', mintApiToken(ctx.sqlite, OWNER, ['read:vitals'])),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('read:nutrition');
  });

  it('accepts read:nutrition and read:all', async () => {
    for (const scopes of [['read:nutrition'], ['read:all']]) {
      const res = await route.GET(
        get('/api/v1/nutrition/daily', mintApiToken(ctx.sqlite, OWNER, scopes)),
      );
      expect(res.status, scopes.join()).toBe(200);
    }
  });
});

describe('reads', () => {
  it('returns the owner’s days ascending with snake_case fields', async () => {
    seed(OWNER, '2026-09-02', { calories: 2000 });
    seed(OWNER, '2026-09-01', { calories: 1800 });
    const res = await route.GET(
      get('/api/v1/nutrition/daily', mintApiToken(ctx.sqlite, OWNER, ['read:nutrition'])),
    );
    const body = await res.json();
    expect(body.map((r: { date: string }) => r.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(body[0]).toMatchObject({
      date: '2026-09-01',
      source_package: 'com.sbs.diet',
      calories: 1800,
      protein_grams: 140,
      record_count: 2,
    });
  });

  it('preserves null nutrients as null, not zero', async () => {
    seed(OWNER, '2026-09-01', { protein: null });
    const res = await route.GET(
      get('/api/v1/nutrition/daily', mintApiToken(ctx.sqlite, OWNER, ['read:nutrition'])),
    );
    const body = await res.json();
    expect(body[0].protein_grams).toBeNull();
    expect(body[0].fiber_grams).toBeNull();
  });

  it('filters by date range', async () => {
    seed(OWNER, '2026-08-30');
    seed(OWNER, '2026-09-01');
    seed(OWNER, '2026-09-05');
    const res = await route.GET(
      get(
        '/api/v1/nutrition/daily?start_date=2026-09-01&end_date=2026-09-02',
        mintApiToken(ctx.sqlite, OWNER, ['read:nutrition']),
      ),
    );
    const body = await res.json();
    expect(body.map((r: { date: string }) => r.date)).toEqual(['2026-09-01']);
  });

  it('400s on a malformed date', async () => {
    const res = await route.GET(
      get(
        '/api/v1/nutrition/daily?start_date=09-01-2026',
        mintApiToken(ctx.sqlite, OWNER, ['read:nutrition']),
      ),
    );
    expect(res.status).toBe(400);
  });

  it('never returns another user’s rows', async () => {
    seed(VIEWER, '2026-09-01');
    const res = await route.GET(
      get('/api/v1/nutrition/daily', mintApiToken(ctx.sqlite, OWNER, ['read:all'])),
    );
    expect(await res.json()).toEqual([]);
  });
});
