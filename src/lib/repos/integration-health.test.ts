// @vitest-environment node
import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupRepoDb,
  insertDependent,
  insertUser,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from './repo-test-harness';

const state = vi.hoisted(() => ({ configured: true }));
vi.mock('@/lib/capabilities', () => ({ getCapabilities: () => ({ oura: state.configured }) }));
vi.mock('@/lib/oura/scheduler', () => ({
  getOuraSchedulerStatus: () => ({ scheduled: true, nextRunAt: '2026-10-24T20:00:00Z' }),
  ouraSyncIntervalMs: () => 4 * 60 * 60_000,
}));

let ctx: RepoTestDb;
let list: (typeof import('./integration-health'))['listIntegrationHealth'];
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-health-projection-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  vi.stubEnv('TZ', 'America/Phoenix');
  state.configured = true;
  list = (await import('./integration-health')).listIntegrationHealth;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  ctx.restore();
});

function run(
  integrationId: string | null,
  userId: string,
  receivedAt: string,
  receivedCount: number,
  status = 'accepted'
) {
  const id = randomUUID();
  ctx.sqlite
    .prepare(
      `insert into health_connect_ingest_runs
    (id, integration_id, user_id, body_sha256, status, received_count, received_at)
    values (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, integrationId, userId, id, status, receivedCount, receivedAt);
}

describe('integration health projection', () => {
  it('always lists native setup options and keeps unknown historical receipt times unknown', async () => {
    state.configured = false;
    const rows = await list(OWNER);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source: 'oura',
      status: 'not_configured',
      connectionStatus: null,
      lastReceivedAt: null,
      canSyncNow: false,
    });
    expect(rows[1]).toMatchObject({
      source: 'health_connect',
      status: 'not_connected',
      lastReceivedAt: null,
      lastRecordedImportAt: null,
      latestNutritionDate: null,
    });
    expect(rows.every((row) => row.timeZone === 'America/Phoenix')).toBe(true);
    state.configured = true;
    expect((await list(OWNER))[0]).toMatchObject({
      status: 'not_connected',
      connectionStatus: null,
    });
  });

  it('keeps authorization separate from health and prioritizes missing instance configuration', async () => {
    const sources = await import('./connected-sources');
    await sources.upsertConnectedSource(OWNER, 'oura', {
      accessTokenEncrypted: 'synthetic-ciphertext',
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });
    await sources.setConnectedSourceStatus(OWNER, 'oura', 'expired');
    state.configured = false;
    expect((await list(OWNER))[0]).toMatchObject({
      status: 'not_configured',
      connectionStatus: 'expired',
      canSyncNow: false,
    });
    state.configured = true;
    expect((await list(OWNER))[0]).toMatchObject({
      status: 'reconnect_required',
      connectionStatus: 'expired',
      canSyncNow: false,
    });
    await sources.setConnectedSourceStatus(OWNER, 'oura', 'active');
    await sources.recordConnectedSourceSync(OWNER, 'oura', {
      attemptedAt: '2026-10-24T12:00:00Z',
      outcome: 'partial',
      errorCode: 'provider_unavailable',
    });
    expect((await list(OWNER))[0]).toMatchObject({
      status: 'partial',
      connectionStatus: 'active',
      canSyncNow: true,
    });
    await sources.setConnectedSourceStatus(OWNER, 'oura', 'disconnected');
    expect((await list(OWNER))[0]).toMatchObject({
      status: 'disconnected',
      connectionStatus: 'disconnected',
      canSyncNow: false,
    });
  });

  it('persists a real partial sync without expiring authorization when one collection lacks permission', async () => {
    const sources = await import('./connected-sources');
    await sources.upsertConnectedSource(OWNER, 'oura', {
      accessTokenEncrypted: 'synthetic-ciphertext',
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const endpoint = new URL(String(input)).pathname;
      if (endpoint === '/v2/usercollection/daily_resilience')
        return Response.json(
          { detail: 'Token is not authorized access daily scope' },
          { status: 401 }
        );
      if (endpoint === '/v2/usercollection/daily_activity')
        return Response.json({
          data: [{ id: 'synthetic-activity', day: '2026-10-24', steps: 7000 }],
          next_token: null,
        });
      if (endpoint.startsWith('/v2/usercollection/'))
        return Response.json({ data: [], next_token: null });
      throw new Error('Unexpected provider request');
    });
    const { syncOuraData } = await import('@/lib/oura/sync');
    const summary = await syncOuraData(
      OWNER,
      'synthetic-valid-token',
      false,
      new Date('2026-10-24T19:00:00Z')
    );

    expect(summary).toMatchObject({
      synced: 1,
      outcome: 'partial',
      errorCode: 'insufficient_scope',
    });
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(await sources.getConnectedSource(OWNER, 'oura')).toMatchObject({
      status: 'active',
      lastOutcome: 'partial',
      lastErrorCode: 'insufficient_scope',
      lastSyncAt: null,
      lastSuccessAt: null,
    });
    expect(
      ctx.sqlite
        .prepare('select user_id, metric_key, value, source from vitals where user_id=?')
        .all(OWNER)
    ).toEqual([{ user_id: OWNER, metric_key: 'steps', value: 7000, source: 'oura' }]);

    expect((await list(OWNER))[0]).toMatchObject({
      status: 'partial',
      connectionStatus: 'active',
      errorCode: 'insufficient_scope',
      canSyncNow: true,
      lastSuccessAt: null,
      nextRetryAt: null,
    });
    expect((await list(VIEWER))[0]).toMatchObject({
      status: 'not_connected',
      connectionStatus: null,
      errorCode: null,
      canSyncNow: false,
    });
  });

  it('finds the latest nonempty import beyond recent pings without mixing owners or old integrations', async () => {
    const hc = await import('./health-connect');
    const { integration } = await hc.createIntegration(OWNER, { name: 'Synthetic phone' });
    const other = await hc.createIntegration(VIEWER, { name: 'Other synthetic phone' });
    run(integration.id, OWNER, '2026-10-01T10:00:00Z', 2);
    run(integration.id, OWNER, '2026-10-02T10:00:00Z', 1);
    // More pings than the Settings run-history window, plus no-data and rejected runs.
    for (let day = 3; day <= 19; day++)
      run(
        integration.id,
        OWNER,
        `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`,
        0,
        'test_ping'
      );
    run(integration.id, OWNER, '2026-10-20T10:00:00Z', 0);
    run(integration.id, OWNER, '2026-10-21T10:00:00Z', 7, 'rejected');
    run(null, OWNER, '2026-10-23T10:00:00Z', 4);
    run(other.integration.id, VIEWER, '2026-10-24T10:00:00Z', 4);
    ctx.sqlite
      .prepare(
        "update health_connect_integrations set status='active', last_received_at=?, last_normalized_at=? where id=?"
      )
      .run('2026-10-24T11:00:00Z', '2026-10-24T12:00:00Z', integration.id);
    const phone = (await list(OWNER)).find((row) => row.source === 'health_connect');
    expect(phone).toMatchObject({
      status: 'receiving',
      lastRecordedImportAt: '2026-10-02T10:00:00Z',
      lastReceivedAt: '2026-10-24T11:00:00Z',
      lastNormalizedAt: '2026-10-24T12:00:00Z',
    });
  });

  it('exposes owner nutrition days separately from owner vitals, excluding dependent and other-owner records', async () => {
    const db = (await import('@/db')).db;
    const vitals = await import('./vitals');
    const child = 'synthetic-dependent';
    insertDependent(ctx.sqlite, child, OWNER);
    for (const [userId, date] of [
      [OWNER, '2026-10-20'],
      [VIEWER, '2026-10-24'],
    ]) {
      ctx.sqlite
        .prepare(
          'insert into nutrition_daily (id, user_id, date, source_package, created_at, updated_at) values (?, ?, ?, ?, ?, ?)'
        )
        .run(
          randomUUID(),
          userId,
          date,
          'synthetic.package',
          '2026-10-24T12:00:00Z',
          '2026-10-24T12:00:00Z'
        );
    }
    vitals.upsertOwnVital(db, OWNER, {
      metricKey: 'steps',
      value: 100,
      source: 'health_connect_daily',
      recordedAt: '2026-10-19',
    });
    vitals.upsertOwnVital(db, VIEWER, {
      metricKey: 'steps',
      value: 200,
      source: 'health_connect_daily',
      recordedAt: '2026-10-23',
    });
    await vitals.createVital(
      OWNER,
      { ownerId: OWNER, dependentId: child },
      { metricKey: 'steps', value: 300, source: 'health_connect_daily', recordedAt: '2026-10-24' }
    );
    ctx.sqlite.prepare('update vitals set last_received_at=null where user_id=?').run(OWNER);
    expect((await list(OWNER)).find((row) => row.source === 'health_connect')).toMatchObject({
      latestNutritionDate: '2026-10-20',
      latestMeasurementAt: '2026-10-19T00:00:00Z',
      lastReceivedAt: null,
      lastRecordedImportAt: null,
    });
  });

  it('labels known bridges without changing their source identities or claiming upstream health', async () => {
    const vitals = await import('./vitals');
    const db = (await import('@/db')).db;
    for (const source of ['renpho', 'myair', 'custom-bridge', 'constructor']) {
      vitals.upsertOwnVital(db, OWNER, {
        metricKey: 'weight',
        value: 150,
        source,
        recordedAt: '2026-10-20',
      });
    }
    ctx.sqlite.prepare('update vitals set last_received_at=null where user_id=?').run(OWNER);
    const rows = await list(OWNER);
    for (const [source, label] of [
      ['renpho', 'Renpho'],
      ['myair', 'myAir / CPAP'],
      ['custom-bridge', 'custom-bridge'],
      ['constructor', 'constructor'],
    ]) {
      expect(rows.find((row) => row.source === source)).toMatchObject({
        source,
        label,
        status: 'upstream_unknown',
        lastReceivedAt: null,
        canSyncNow: false,
      });
    }
  });
});
