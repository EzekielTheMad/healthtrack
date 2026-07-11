// @vitest-environment node
/**
 * v1 check-in endpoints — GET /api/v1/checkins and
 * GET/PUT /api/v1/checkins/{weekStart}.
 *
 * Covers the PAT auth matrix, the Monday-key contract (non-Monday and
 * malformed keys → 400), PUT full-replacement semantics, and the
 * neck_in/waist_in write-through to vitals (never stored on the row).
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
type ItemRoute = typeof import('./[weekStart]/route');

let ctx: RepoTestDb;
let collection: CollectionRoute;
let item: ItemRoute;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-checkins-');
  [collection, item] = await Promise.all([import('./route'), import('./[weekStart]/route')]);
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

const params = (weekStart: string) => ({ params: Promise.resolve({ weekStart }) });

// 2026-07-06 is a Monday.
const WEEK = '2026-07-06';

const CHECKIN = {
  working: 'Progressive overload on presses',
  not_working: 'Late-night snacking',
  days_logged: 5,
  avg_calories: 2150,
  avg_protein_g: 165,
};

describe('auth matrix', () => {
  it('401 / 403 across list, get and put', async () => {
    expect((await collection.GET(req('/api/v1/checkins', null))).status).toBe(401);
    expect((await item.GET(req(`/api/v1/checkins/${WEEK}`, null), params(WEEK))).status).toBe(401);

    const readVitals = mintApiToken(ctx.sqlite, OWNER, ['read:vitals', 'write:vitals']);
    expect((await collection.GET(req('/api/v1/checkins', readVitals))).status).toBe(403);
    expect(
      (await item.PUT(req(`/api/v1/checkins/${WEEK}`, readVitals, 'PUT', CHECKIN), params(WEEK))).status,
    ).toBe(403);

    const readFitness = mintApiToken(ctx.sqlite, OWNER, ['read:fitness']);
    expect(
      (await item.PUT(req(`/api/v1/checkins/${WEEK}`, readFitness, 'PUT', CHECKIN), params(WEEK))).status,
    ).toBe(403);
  });
});

describe('weekStart validation', () => {
  it('400 for a non-Monday, a malformed key, and an impossible date', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    for (const bad of ['2026-07-07', '2026-7-6', '2026-02-30']) {
      const getRes = await item.GET(req(`/api/v1/checkins/${bad}`, token), params(bad));
      expect(getRes.status).toBe(400);
      const putRes = await item.PUT(
        req(`/api/v1/checkins/${bad}`, token, 'PUT', CHECKIN),
        params(bad),
      );
      expect(putRes.status).toBe(400);
    }
    const res = await item.GET(req('/api/v1/checkins/2026-07-07', token), params('2026-07-07'));
    expect((await res.json()).error).toContain('not a Monday');
  });
});

describe('PUT + GET /api/v1/checkins/{weekStart}', () => {
  it('upserts, returns snake_case row, and 404s for missing weeks', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    expect((await item.GET(req(`/api/v1/checkins/${WEEK}`, token), params(WEEK))).status).toBe(404);

    const put = await item.PUT(req(`/api/v1/checkins/${WEEK}`, token, 'PUT', CHECKIN), params(WEEK));
    expect(put.status).toBe(200);
    const row = await put.json();
    expect(row).toMatchObject({
      week_start: WEEK,
      working: CHECKIN.working,
      not_working: CHECKIN.not_working,
      days_logged: 5,
      avg_calories: 2150,
      avg_protein_g: 165,
      avg_carbs_g: null,
    });

    const got = await (await item.GET(req(`/api/v1/checkins/${WEEK}`, token), params(WEEK))).json();
    expect(got.id).toBe(row.id);
  });

  it('PUT is a full replacement — omitted fields clear to null', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    await item.PUT(req(`/api/v1/checkins/${WEEK}`, token, 'PUT', CHECKIN), params(WEEK));
    const second = await (
      await item.PUT(req(`/api/v1/checkins/${WEEK}`, token, 'PUT', { working: 'Only this' }), params(WEEK))
    ).json();
    expect(second.working).toBe('Only this');
    expect(second.not_working).toBeNull();
    expect(second.avg_calories).toBeNull();

    const count = ctx.sqlite
      .prepare('select count(*) as n from weekly_checkins')
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('neck_in/waist_in write through to vitals and are never stored on the row', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const res = await item.PUT(
      req(`/api/v1/checkins/${WEEK}`, token, 'PUT', { ...CHECKIN, neck_in: 15.5, waist_in: 40.25 }),
      params(WEEK),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.neck_in).toBeUndefined();
    expect(row.waist_in).toBeUndefined();

    const vitals = ctx.sqlite
      .prepare(
        "select metric_key, value, source from vitals where metric_key in ('neck','waist') order by metric_key",
      )
      .all() as { metric_key: string; value: number; source: string }[];
    expect(vitals).toEqual([
      { metric_key: 'neck', value: 15.5, source: 'manual' },
      { metric_key: 'waist', value: 40.25, source: 'manual' },
    ]);
  });

  it('400 for out-of-bounds manual fields', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const res = await item.PUT(
      req(`/api/v1/checkins/${WEEK}`, token, 'PUT', { days_logged: 9 }),
      params(WEEK),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('days_logged');
  });
});

describe('GET /api/v1/checkins', () => {
  it('lists newest first with from/to bounds; strictly per-user', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    for (const week of ['2026-06-22', '2026-06-29', '2026-07-06']) {
      await item.PUT(req(`/api/v1/checkins/${week}`, token, 'PUT', { working: week }), params(week));
    }
    const all = await (await collection.GET(req('/api/v1/checkins', token))).json();
    expect(all.map((c: { week_start: string }) => c.week_start)).toEqual([
      '2026-07-06',
      '2026-06-29',
      '2026-06-22',
    ]);

    const windowed = await (
      await collection.GET(req('/api/v1/checkins?from=2026-06-29&to=2026-06-29', token))
    ).json();
    expect(windowed).toHaveLength(1);
    expect(windowed[0].week_start).toBe('2026-06-29');

    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['read:fitness']);
    expect(await (await collection.GET(req('/api/v1/checkins', viewerToken))).json()).toEqual([]);
  });
});
