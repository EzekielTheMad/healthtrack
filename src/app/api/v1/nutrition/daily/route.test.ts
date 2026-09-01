// @vitest-environment node
/**
 * GET /api/v1/nutrition/daily — the canonical read contract.
 *
 * This is the endpoint Hermes consumes, so the response SHAPE is part of the
 * contract, not an implementation detail: nullable nutrients stay nullable
 * (unknown is not zero), field names are snake_case, and the route
 * authenticates with a PAT alone — no browser session, no cookie.
 *
 * It also pins that the signed-in page and the PAT endpoint read the SAME
 * canonical repository: two aggregation paths would eventually disagree, and
 * the disagreement would look like missing food.
 */
import crypto from 'crypto';
import fs from 'fs';
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
import { EXPECTED_DAILY_TOTALS } from '@/lib/integrations/health-connect/fixtures/macrofactor';
import { MACROFACTOR_PACKAGE } from '@/lib/integrations/health-connect/fixtures/payloads';

type V1Route = typeof import('./route');
type NutritionRepo = typeof import('@/lib/repos/nutrition');

let ctx: RepoTestDb;
let route: V1Route;
let nutritionRepo: NutritionRepo;

const URL_BASE = 'http://localhost/api/v1/nutrition/daily';

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-nutrition-api-');
  [route, nutritionRepo] = await Promise.all([
    import('./route'),
    import('@/lib/repos/nutrition'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedDay(opts: {
  userId?: string;
  date: string;
  sourcePackage?: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  recordCount?: number;
}) {
  ctx.sqlite
    .prepare(
      `insert into nutrition_daily
        (id, user_id, date, source_package, calories, protein_grams, carbs_grams,
         fat_grams, fiber_grams, sugar_grams, sodium_milligrams, record_count,
         metadata_json, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, null, null, null, ?, '{}', ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      opts.userId ?? OWNER,
      opts.date,
      opts.sourcePackage ?? MACROFACTOR_PACKAGE,
      opts.calories === undefined ? 2000 : opts.calories,
      opts.protein === undefined ? 150 : opts.protein,
      opts.carbs === undefined ? 200 : opts.carbs,
      opts.fat === undefined ? 70 : opts.fat,
      opts.recordCount ?? 5,
      '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00Z',
    );
}

function get(query: Record<string, string> = {}, scopes: string[] | null = ['read:nutrition']) {
  const url = new URL(URL_BASE);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (scopes) headers.Authorization = `Bearer ${mintApiToken(ctx.sqlite, OWNER, scopes)}`;
  return route.GET(new NextRequest(url, { headers }));
}

async function rowsOf(res: Response) {
  return (await res.json()) as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('authorization', () => {
  it('401 without a token', async () => {
    expect((await get({}, null)).status).toBe(401);
  });

  it('accepts read:nutrition and read:all', async () => {
    expect((await get({}, ['read:nutrition'])).status).toBe(200);
    expect((await get({}, ['read:all'])).status).toBe(200);
  });

  it('403 without the scope, naming what is required', async () => {
    const res = await get({}, ['read:vitals']);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('read:nutrition');
  });

  it('403 for write:health_connect — ingest never implies nutrition read', async () => {
    // The least-privilege Hermes token gets read:nutrition and nothing else;
    // the phone's ingest token must not be able to read intake back out.
    const res = await get({}, ['write:health_connect']);
    expect(res.status).toBe(403);
  });

  it('needs no browser session — a PAT alone authenticates', async () => {
    seedDay({ date: '2026-09-01' });
    const url = new URL(URL_BASE);
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:nutrition']);
    // No cookie header at all, and an explicit non-browser user agent.
    const res = await route.GET(
      new NextRequest(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'hermes/1.0' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await rowsOf(res)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Response contract
// ---------------------------------------------------------------------------

describe('response contract', () => {
  it('returns canonical daily snapshots in the documented snake_case shape', async () => {
    seedDay({
      date: '2026-08-31',
      calories: EXPECTED_DAILY_TOTALS[0].calories,
      protein: EXPECTED_DAILY_TOTALS[0].proteinGrams,
      carbs: EXPECTED_DAILY_TOTALS[0].carbsGrams,
      fat: EXPECTED_DAILY_TOTALS[0].fatGrams,
      recordCount: 10,
    });

    const body = await rowsOf(await get());
    expect(body).toHaveLength(1);
    expect(Object.keys(body[0]).sort()).toEqual([
      'calories',
      'carbs_grams',
      'date',
      'fat_grams',
      'fiber_grams',
      'protein_grams',
      'record_count',
      'sodium_milligrams',
      'source_package',
      'sugar_grams',
      'updated_at',
    ]);
    expect(body[0].date).toBe('2026-08-31');
    expect(body[0].source_package).toBe(MACROFACTOR_PACKAGE);
    expect(body[0].record_count).toBe(10);
    expect(body[0].calories as number).toBeCloseTo(EXPECTED_DAILY_TOTALS[0].calories, 6);
  });

  it('keeps nullable nutrients nullable — unknown is never coerced to zero', async () => {
    seedDay({ date: '2026-09-01', protein: null, carbs: null, fat: 0 });
    const body = await rowsOf(await get());

    expect(body[0].protein_grams).toBeNull();
    expect(body[0].carbs_grams).toBeNull();
    // A reported zero stays a number, and is distinguishable from null.
    expect(body[0].fat_grams).toBe(0);
    // Reserved nutrients the relay does not publish yet are present and null.
    expect(body[0].fiber_grams).toBeNull();
    expect(body[0].sugar_grams).toBeNull();
    expect(body[0].sodium_milligrams).toBeNull();
  });

  it('never returns raw food records — only daily snapshots', async () => {
    seedDay({ date: '2026-09-01', recordCount: 6 });
    const body = await rowsOf(await get());
    expect(body).toHaveLength(1);
    // record_count summarises the source records; the records themselves are
    // not exposed here (they live behind read:health_connect).
    expect(body[0].record_count).toBe(6);
    expect(JSON.stringify(body)).not.toContain('start_time');
    expect(JSON.stringify(body)).not.toContain('uuid');
  });

  it('returns an empty array, not an error, when there is nothing', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await rowsOf(res)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe('filters', () => {
  beforeEach(() => {
    seedDay({ date: '2026-08-30' });
    seedDay({ date: '2026-08-31' });
    seedDay({ date: '2026-09-01' });
  });

  it('applies start_date and end_date inclusively', async () => {
    const body = await rowsOf(
      await get({ start_date: '2026-08-31', end_date: '2026-09-01' }),
    );
    expect(body.map((r) => r.date)).toEqual(['2026-08-31', '2026-09-01']);

    const single = await rowsOf(
      await get({ start_date: '2026-08-31', end_date: '2026-08-31' }),
    );
    expect(single.map((r) => r.date)).toEqual(['2026-08-31']);
  });

  it('orders oldest-first', async () => {
    const body = await rowsOf(await get());
    expect(body.map((r) => r.date)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('filters source_package by exact equality, never a prefix', async () => {
    seedDay({ date: '2026-09-01', sourcePackage: 'com.sbs.diet.free', calories: 999 });

    const exact = await rowsOf(await get({ source_package: MACROFACTOR_PACKAGE }));
    expect(exact).toHaveLength(3);
    expect(new Set(exact.map((r) => r.source_package))).toEqual(
      new Set([MACROFACTOR_PACKAGE]),
    );

    // A prefix of the real package matches nothing.
    expect(await rowsOf(await get({ source_package: 'com.sbs' }))).toEqual([]);
    expect(await rowsOf(await get({ source_package: 'com.sbs.diet.free' }))).toHaveLength(1);
  });

  it('honours limit', async () => {
    expect(await rowsOf(await get({ limit: '2' }))).toHaveLength(2);
  });

  it('400s on a malformed date rather than silently ignoring it', async () => {
    const res = await get({ start_date: '08/31/2026' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/YYYY-MM-DD/);
  });
});

// ---------------------------------------------------------------------------
// Isolation + shared repository
// ---------------------------------------------------------------------------

describe('user isolation', () => {
  it('never returns another user’s days', async () => {
    seedDay({ userId: VIEWER, date: '2026-09-01', calories: 4000 });
    seedDay({ date: '2026-09-01', calories: 2000 });

    const body = await rowsOf(await get());
    expect(body).toHaveLength(1);
    expect(body[0].calories).toBe(2000);
  });
});

describe('shared canonical repository', () => {
  it('the PAT endpoint and the signed-in page read the same rows', async () => {
    seedDay({ date: '2026-08-31', calories: 2147.099, protein: null });
    seedDay({ date: '2026-09-01', calories: 1030.868 });

    const viaApi = await rowsOf(await get());
    // The page's session route and the v1 route both call listNutritionDaily;
    // reading it directly here is reading exactly what the page renders.
    const viaRepo = await nutritionRepo.listNutritionDaily(OWNER, {});

    expect(viaRepo.map((r) => r.date)).toEqual(viaApi.map((r) => r.date));
    expect(viaRepo.map((r) => r.calories)).toEqual(viaApi.map((r) => r.calories));
    // Null survives identically down both paths.
    expect(viaRepo[0].proteinGrams).toBeNull();
    expect(viaApi[0].protein_grams).toBeNull();
  });
});

describe('one aggregation path', () => {
  it('both the page route and the PAT route read listNutritionDaily', () => {
    // Importing the session route here would pull in better-auth's cookie
    // machinery, so the pin is on the source: neither route may grow its own
    // aggregation, and neither may touch the raw webhook tables.
    for (const file of [
      'src/app/api/nutrition/daily/route.ts',
      'src/app/api/v1/nutrition/daily/route.ts',
    ]) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source, file).toContain('listNutritionDaily');
      expect(source, file).not.toContain('health_connect_raw_records');
      expect(source, file).not.toContain('healthConnectRawRecords');
    }
  });
});
