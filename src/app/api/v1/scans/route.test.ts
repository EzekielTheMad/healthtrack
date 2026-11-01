// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  mintApiToken,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
let ctx: RepoTestDb;
let route: typeof import('./route');
let latest: typeof import('./latest/route');
const scan = {
  external_id: 'fictional-1',
  source: 'Fictional BIA',
  method: 'bia',
  measured_at: { precision: 'day', value: '2026-10-30' },
  provenance: { basis: 'source_reported' },
  measurements: [{ metric_key: 'body_fat_mass', value: 20.234, unit: 'kg' }],
};
function request(path: string, token?: string, body?: unknown) {
  return new NextRequest('http://localhost' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-scan-api-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  route = await import('./route');
  latest = await import('./latest/route');
});
afterEach(() => ctx.restore());
it('bounds request bytes before parsing and never persists an oversized payload', async () => {
  const token = mintApiToken(ctx.sqlite, OWNER, ['write:scans']);
  const response = await route.POST(
    request('/api/v1/scans', token, { ...scan, model: 'x'.repeat(131073) })
  );
  expect(response.status).toBe(400);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM body_scans').get()).toEqual({ n: 0 });
});
it('requires explicit scan write grant, never wildcard/read/device authority', async () => {
  expect((await route.POST(request('/api/v1/scans', undefined, scan))).status).toBe(401);
  for (const scope of ['write:all', 'read:all', 'write:vitals', 'write:health_connect'])
    expect(
      (await route.POST(request('/api/v1/scans', mintApiToken(ctx.sqlite, OWNER, [scope]), scan)))
        .status
    ).toBe(403);
  const token = mintApiToken(ctx.sqlite, OWNER, ['write:scans', 'read:vitals']);
  expect((await route.POST(request('/api/v1/scans', token, scan))).status).toBe(201);
  expect((await route.POST(request('/api/v1/scans', token, scan))).status).toBe(200);
  expect(
    (await route.POST(request('/api/v1/scans', token, { ...scan, model: 'different' }))).status
  ).toBe(409);
  const response = await route.GET(request('/api/v1/scans', token));
  expect((await response.json()).scans).toHaveLength(1);
  expect(
    (await route.GET(request('/api/v1/scans', mintApiToken(ctx.sqlite, VIEWER, ['read:vitals']))))
      .status
  ).toBe(200);
  expect((await route.GET(request('/api/v1/scans?owner_id=' + OWNER, token))).status).toBe(400);
  expect(
    (await route.POST(request('/api/v1/scans', token, { ...scan, dependent_id: 'child' }))).status
  ).toBe(400);
});
it('returns coherent latest metadata and explicit history bounds', async () => {
  const token = mintApiToken(ctx.sqlite, OWNER, ['write:scans', 'read:vitals']);
  await route.POST(request('/api/v1/scans', token, scan));
  const response = await (await latest.GET(request('/api/v1/scans/latest', token))).json();
  expect(response.scan.scan.external_id).toBe('fictional-1');
  expect(response.scan.measurements[0]).toMatchObject({ source_unit: 'kg', source_value: 20.234 });
  expect(response.coverage.partial_dates_excluded_from_latest).toBe(true);
  expect((await route.GET(request('/api/v1/scans?limit=101', token))).status).toBe(400);
});
