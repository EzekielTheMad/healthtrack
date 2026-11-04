// @vitest-environment node
import { beforeEach, afterEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  mintApiToken,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
let ctx: RepoTestDb;
let series: typeof import('./route');
let latest: typeof import('./latest/route');
let token: string;
function req(url: string, body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-typed-vitals-');
  insertUser(ctx.sqlite, OWNER);
  token = mintApiToken(ctx.sqlite, OWNER, ['read:vitals', 'write:vitals', 'write:scans']);
  series = await import('./route');
  latest = await import('./latest/route');
  await series.POST(
    req('/api/v1/vitals', {
      metric_key: 'weight',
      value: 175,
      unit: 'lbs',
      source: 'legacy-scale',
      recorded_at: '2026-10-01',
      metadata: { original_unit: 'kg', notes: 'source' },
    })
  );
  const { createBodyScan } = await import('@/lib/fidelity/scans');
  await createBodyScan(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    {
      external_id: 'report',
      source: 'Fictional BIA',
      method: 'bia',
      measured_at: { precision: 'day', value: '2026-10-30' },
      provenance: { basis: 'source_reported' },
      measurements: [
        { metric_key: 'weight', value: 80, unit: 'kg' },
        { metric_key: 'skeletal_muscle_mass', value: 30.123, unit: 'kg' },
      ],
    }
  );
});
afterEach(() => ctx.restore());
it('rejects requested alternate subjects only in the new typed contract', async () => {
  expect((await series.GET(req('/api/v1/vitals?format=typed&dependent_id=other'))).status).toBe(
    400
  );
  expect(
    (await latest.GET(req('/api/v1/vitals/latest?format=typed&metrics=weight&owner_id=other')))
      .status
  ).toBe(400);
  expect((await series.GET(req('/api/v1/vitals?dependent_id=other'))).status).toBe(200);
});
it('uses instance calendar days for instants and does not drop exact timestamp bounds', async () => {
  const saved = process.env.TZ;
  process.env.TZ = 'America/Phoenix';
  try {
    const { createBodyScan } = await import('@/lib/fidelity/scans');
    await createBodyScan(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      {
        external_id: 'utc-next-day',
        source: 'Fictional BIA',
        method: 'bia',
        measured_at: { precision: 'instant', value: '2026-10-31T03:00:00Z' },
        provenance: { basis: 'source_reported' },
        measurements: [{ metric_key: 'weight', value: 80, unit: 'kg' }],
      }
    );
    const day = await (
      await series.GET(req('/api/v1/vitals?format=typed&from=2026-10-30&to=2026-10-30'))
    ).json();
    expect(
      day.scans.some(
        (row: { scan: { external_id: string } }) => row.scan.external_id === 'utc-next-day'
      )
    ).toBe(true);
    const exact = await (
      await series.GET(req('/api/v1/vitals?format=typed&from=2026-10-31T04:00:00Z'))
    ).json();
    expect(exact.scans).toEqual([]);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
it('preserves default shape while typed history returns bounded metadata and coherent source evidence', async () => {
  const legacy = await (await series.GET(req('/api/v1/vitals'))).json();
  expect(Array.isArray(legacy)).toBe(true);
  expect(legacy[0]).not.toHaveProperty('metadata');
  expect(legacy).toHaveLength(1);
  const typed = await (await series.GET(req('/api/v1/vitals?format=typed'))).json();
  expect(typed.legacy[0].metadata).toEqual({ original_unit: 'kg', notes: 'source' });
  expect(typed.scans).toHaveLength(1);
  expect(typed.scans[0].measurements).toHaveLength(2);
  expect(typed.coverage.default_format_excludes_scan_facts).toBe(true);
});
it('typed latest does not fill one coherent scan from unrelated latest metrics', async () => {
  const result = await (
    await latest.GET(
      req(
        '/api/v1/vitals/latest?format=typed&metrics=weight,skeletal_muscle_mass,ecw_ratio&source=Fictional%20BIA'
      )
    )
  ).json();
  expect(result.legacy_latest.weight.value).toBe(175);
  expect(result.scan_latest.scan.scan.external_id).toBe('report');
  expect(result.coverage.missing_scan_metrics).toEqual(['ecw_ratio']);
  const legacy = await (
    await latest.GET(req('/api/v1/vitals/latest?metrics=weight,skeletal_muscle_mass'))
  ).json();
  expect(legacy.weight.value).toBe(175);
  expect(legacy.skeletal_muscle_mass).toBeNull();
  expect(legacy).not.toHaveProperty('format');
});
