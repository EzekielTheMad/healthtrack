// @vitest-environment node
/**
 * v1 vitals read API additions (fitness-domain design §API) —
 * GET /api/v1/vitals?metric&from&to and GET /api/v1/vitals/latest?metrics=.
 *
 * Covers the explicit series window (inclusive day bounds, `from` winning
 * over `days`), the latest-per-metric contract (nulls for empty metrics,
 * closed-registry 400s, required param), and the auth matrix.
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

type SeriesRoute = typeof import('./route');
type LatestRoute = typeof import('./latest/route');

let ctx: RepoTestDb;
let series: SeriesRoute;
let latest: LatestRoute;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-vitals-read-');
  [series, latest] = await Promise.all([import('./route'), import('./latest/route')]);
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
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function seedWeights(token: string) {
  for (const [day, value] of [
    ['2026-07-06', 201.4],
    ['2026-07-07', 200.9],
    ['2026-07-08', 200.2],
  ] as const) {
    const res = await series.POST(
      req('/api/v1/vitals', token, 'POST', {
        metric_key: 'weight',
        value,
        recorded_at: day,
        source: 'renpho',
      }),
    );
    expect(res.status).toBe(201);
  }
}

describe('GET /api/v1/vitals?from&to', () => {
  it('applies inclusive day bounds against day-normalized rows', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:vitals', 'write:vitals']);
    await seedWeights(token);

    const windowed = await (
      await series.GET(req('/api/v1/vitals?metric=weight&from=2026-07-07&to=2026-07-07', token))
    ).json();
    expect(windowed).toHaveLength(1);
    expect(windowed[0].value).toBe(200.9);

    const fromOnly = await (
      await series.GET(req('/api/v1/vitals?metric=weight&from=2026-07-07', token))
    ).json();
    expect(fromOnly.map((v: { value: number }) => v.value)).toEqual([200.2, 200.9]);

    const toOnly = await (
      await series.GET(req('/api/v1/vitals?metric=weight&to=2026-07-06', token))
    ).json();
    expect(toOnly).toHaveLength(1);
    expect(toOnly[0].value).toBe(201.4);
  });

  it('`from` wins over the legacy `days` shorthand', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:vitals', 'write:vitals']);
    await seedWeights(token);
    // days=1 alone would exclude everything (rows are in the past relative
    // to "now" only if now-1d is later) — from must take precedence.
    const rows = await (
      await series.GET(req('/api/v1/vitals?metric=weight&from=2026-07-08&days=99999', token))
    ).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(200.2);
  });
});

describe('GET /api/v1/vitals/latest', () => {
  it('401 / 403 auth matrix', async () => {
    expect((await latest.GET(req('/api/v1/vitals/latest?metrics=weight', null))).status).toBe(401);
    const fitnessOnly = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    const res = await latest.GET(req('/api/v1/vitals/latest?metrics=weight', fitnessOnly));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('read:vitals');
  });

  it('returns the newest reading per metric; null for metrics with no data', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:vitals', 'write:vitals']);
    await seedWeights(token);
    const res = await latest.GET(req('/api/v1/vitals/latest?metrics=weight,neck', token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weight).toMatchObject({
      metric_key: 'weight',
      value: 200.2,
      unit: 'lbs',
      source: 'renpho',
      recorded_at: '2026-07-08T00:00:00Z',
    });
    expect(body.neck).toBeNull();
    // Duplicate keys collapse; whitespace tolerated.
    const dupes = await (
      await latest.GET(req('/api/v1/vitals/latest?metrics=weight,%20weight', token))
    ).json();
    expect(Object.keys(dupes)).toEqual(['weight']);
  });

  it('400 for a missing metrics param and registry-unknown keys', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:vitals']);
    expect((await latest.GET(req('/api/v1/vitals/latest', token))).status).toBe(400);
    expect((await latest.GET(req('/api/v1/vitals/latest?metrics=', token))).status).toBe(400);
    const res = await latest.GET(req('/api/v1/vitals/latest?metrics=weight,quantum_flux', token));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain('quantum_flux');
    expect(error).toContain('/docs/api');
  });

  it("is pinned to the token owner — never another user's rows", async () => {
    const ownerToken = mintApiToken(ctx.sqlite, OWNER, ['read:vitals', 'write:vitals']);
    await seedWeights(ownerToken);
    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['read:vitals']);
    const body = await (
      await latest.GET(req('/api/v1/vitals/latest?metrics=weight', viewerToken))
    ).json();
    expect(body.weight).toBeNull();
  });
});
