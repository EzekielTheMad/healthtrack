// @vitest-environment node
import { vi, beforeEach, afterEach, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
vi.mock('@/lib/auth/session', () => ({
  requireUser: async () => ({ id: OWNER }),
  getUser: async () => ({ id: OWNER }),
  UnauthorizedError: class extends Error {},
}));
let ctx: RepoTestDb;
let route: typeof import('./route');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-browser-scans-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  route = await import('./route');
});
afterEach(() => ctx.restore());
const fixture = {
  external_id: 'old',
  source: 'Fictional BIA',
  method: 'bia',
  measured_at: { precision: 'day', value: '2020-01-01' },
  provenance: { basis: 'source_reported' },
  measurements: [{ metric_key: 'weight', value: 80, unit: 'kg' }],
};
it('resolves an authorized exact scan outside the displayed history without masking coverage', async () => {
  const { createBodyScan } = await import('@/lib/fidelity/scans');
  const older = await createBodyScan(OWNER, { ownerId: OWNER, dependentId: null }, fixture);
  await createBodyScan(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    { ...fixture, external_id: 'recent', measured_at: { precision: 'day', value: '2026-10-30' } }
  );
  const response = await route.GET(
    new NextRequest('http://localhost/api/scans?limit=1&scan_id=' + older.scan.id)
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.scans).toHaveLength(2);
  expect(body.focused_scan_id).toBe(older.scan.id);
  expect(body.coverage.history_may_be_truncated).toBe(true);
});
it('never resolves another patient or owner through focused scan IDs', async () => {
  const { createBodyScan } = await import('@/lib/fidelity/scans');
  insertDependent(ctx.sqlite, 'child', OWNER);
  const child = await createBodyScan(OWNER, { ownerId: OWNER, dependentId: 'child' }, fixture);
  const other = await createBodyScan(VIEWER, { ownerId: VIEWER, dependentId: null }, fixture);
  for (const id of [child.scan.id, other.scan.id])
    expect(
      (await route.GET(new NextRequest('http://localhost/api/scans?scan_id=' + id))).status
    ).toBe(404);
  expect(
    (
      await route.GET(
        new NextRequest('http://localhost/api/scans?dependent_id=child&scan_id=' + child.scan.id)
      )
    ).status
  ).toBe(200);
});
