// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

const state = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/capabilities', () => ({ getCapabilities: () => ({ oura: true }) }));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {
    readonly status = 401;
  }
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!state.userId) throw new UnauthorizedError();
      return { id: state.userId };
    },
  };
});
let ctx: RepoTestDb;
let route: typeof import('./route');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-integration-status-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  route = await import('./route');
  state.userId = OWNER;
});
afterEach(() => {
  state.userId = null;
  ctx.restore();
});

describe('integration status privacy and truth', () => {
  it('requires authentication', async () => {
    state.userId = null;
    expect((await route.GET()).status).toBe(401);
  });
  it('shows partial/native and receipt-only push status without exposing values, tokens or other patients', async () => {
    const sources = await import('@/lib/repos/connected-sources');
    const vitals = await import('@/lib/repos/vitals');
    await sources.upsertConnectedSource(OWNER, 'oura', {
      accessTokenEncrypted: 'synthetic-secret-cipher',
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });
    await sources.recordConnectedSourceSync(OWNER, 'oura', {
      attemptedAt: new Date().toISOString(),
      outcome: 'partial',
      errorCode: 'provider_unavailable',
    });
    const hc = await import('@/lib/repos/health-connect');
    const phone = await hc.createIntegration(OWNER, { name: 'Fixture phone' });
    ctx.sqlite
      .prepare(
        "update health_connect_integrations set status = 'active', last_error = ? where user_id = ?"
      )
      .run('sensitive-provider-error-body', OWNER);
    vitals.upsertOwnVital((await import('@/db')).db, OWNER, {
      metricKey: 'ahi',
      value: 2,
      source: 'cpap-bridge',
      recordedAt: '2026-10-20',
    });
    const child = 'synthetic-dependent';
    insertDependent(ctx.sqlite, child, OWNER);
    await vitals.createVital(
      OWNER,
      { ownerId: OWNER, dependentId: child },
      { metricKey: 'weight', value: 120, source: 'child-only-source', recordedAt: '2026-10-20' }
    );
    vitals.upsertOwnVital((await import('@/db')).db, VIEWER, {
      metricKey: 'weight',
      value: 200,
      source: 'other-owner-source',
      recordedAt: '2026-10-20',
    });
    const result = await route.GET();
    const body = await result.json();
    expect(body.find((item: { source: string }) => item.source === 'oura')).toMatchObject({
      status: 'partial',
      lastSuccessAt: null,
      errorCode: 'provider_unavailable',
    });
    expect(body.find((item: { source: string }) => item.source === 'health_connect')).toMatchObject(
      { status: 'delivery_error', errorCode: 'delivery_error' }
    );
    expect(body.find((item: { source: string }) => item.source === 'cpap-bridge')).toMatchObject({
      status: 'upstream_unknown',
      latestMeasurementAt: '2026-10-20T00:00:00Z',
    });
    const json = JSON.stringify(body);
    expect(json).not.toMatch(
      /synthetic-secret-cipher|sensitive-provider-error-body|child-only-source|other-owner-source|"value"/
    );
    expect(json).not.toContain(phone.secret);
  });
});
