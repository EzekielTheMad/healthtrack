// @vitest-environment node
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  mintApiToken,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { NativeBatch, NativeEvent, NativeRecord } from './native-schema';
import type { NativeDeviceIdentity } from './native-ingest';
let ctx: RepoTestDb;
let ingest: typeof import('./native-ingest').ingestNativeBatch;
let device: NativeDeviceIdentity;
const pkg = 'com.example.health';
let sequence: number;
let token: string;
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-native-hc-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  vi.stubEnv('TZ', 'America/Phoenix');
  sequence = 0;
  token = mintApiToken(ctx.sqlite, OWNER, ['write:health_connect']);
  const key = ctx.sqlite.prepare('SELECT id FROM api_keys WHERE user_id=?').get(OWNER) as {
    id: string;
  };
  const integration = crypto.randomUUID();
  ctx.sqlite
    .prepare(
      `INSERT INTO health_connect_integrations(id,user_id,name,hmac_secret_encrypted,status,enabled_types_json,allowed_sources_json,created_at,updated_at) VALUES(?,?,'Native','unused','active',?,?,?,?)`
    )
    .run(
      integration,
      OWNER,
      JSON.stringify([
        'daily_totals',
        'nutrition',
        'weight',
        'blood_pressure',
        'blood_glucose',
        'sleep',
        'hydration',
        'body_temperature',
        'resting_heart_rate',
      ]),
      JSON.stringify(
        Object.fromEntries(
          [
            'nutrition',
            'weight',
            'blood_pressure',
            'blood_glucose',
            'sleep',
            'hydration',
            'body_temperature',
            'resting_heart_rate',
          ].map((t) => [t, [pkg]])
        )
      ),
      new Date().toISOString(),
      new Date().toISOString()
    );
  device = {
    id: crypto.randomUUID(),
    userId: OWNER,
    keyId: key.id,
    integrationId: integration,
    generation: crypto.randomUUID(),
  };
  const { encrypt } = await import('@/lib/crypto/encrypt');
  ctx.sqlite
    .prepare(
      `INSERT INTO mobile_devices(id,user_id,integration_id,generation,key_id,hmac_secret_encrypted,name,created_at) VALUES(?,?,?,?,?,?,'Synthetic phone',?)`
    )
    .run(
      device.id,
      OWNER,
      integration,
      device.generation,
      key.id,
      encrypt('synthetic-native-secret'),
      new Date().toISOString()
    );
  ctx.sqlite
    .prepare(`INSERT INTO mobile_delivery_modes(user_id,mode,device_id) VALUES(?,'native',?)`)
    .run(OWNER, device.id);
  ingest = (await import('./native-ingest')).ingestNativeBatch;
});
afterEach(() => {
  ctx.restore();
  vi.unstubAllEnvs();
});
function record(
  type = 'weight',
  value = 80,
  at = '2026-10-24T06:30:00Z',
  id = crypto.randomUUID()
): NativeRecord {
  return {
    record_type: type,
    source_package: pkg,
    record_id: id,
    start_time: at,
    source_modified_at: '2026-10-24T12:00:00Z',
    data: type === 'weight' ? { value, unit: 'kg' } : { value, unit: 'mg/dL' },
  };
}
function body(events: NativeEvent[], seq = ++sequence): NativeBatch {
  return {
    protocol_version: 2,
    device_generation: device.generation,
    sequence: seq,
    batch_id: crypto.randomUUID(),
    read_at: '2026-10-25T01:00:00Z',
    app_version: 'test-1',
    events,
  };
}
function send(events: NativeEvent[]) {
  const b = body(events);
  return ingest(device, b, crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex'));
}
function vitals() {
  return ctx.sqlite
    .prepare(
      'SELECT * FROM vitals WHERE user_id=? ORDER BY metric_key,recorded_at,native_record_id'
    )
    .all(OWNER) as Array<{
    value: number;
    metric_key: string;
    recorded_at: string;
    source: string;
    metadata: string;
    native_record_id: string | null;
  }>;
}

describe('ordered native delivery transaction', () => {
  it('commits exact retries once and stores receipt/read times and integration outcomes', () => {
    const b = body([{ kind: 'upsert', record: record() }]);
    const first = ingest(device, b, 'digest');
    expect(first.records.inserted).toBe(1);
    expect(ingest(device, b, 'digest')).toEqual(first);
    expect(vitals()).toHaveLength(1);
    expect(vitals()[0].value).toBeCloseTo(176.4, 1);
    expect(vitals()[0].recorded_at).toBe('2026-10-23T00:00:00Z');
    expect(
      ctx.sqlite.prepare('SELECT count(*) n FROM health_connect_native_batches').get()
    ).toEqual({ n: 1 });
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM health_connect_ingest_runs').get()).toEqual({
      n: 1,
    });
    const state = ctx.sqlite
      .prepare('SELECT last_read_at,last_received_at FROM health_connect_native_state')
      .get() as { last_read_at: string; last_received_at: string };
    expect(state.last_read_at).toBe(b.read_at);
    expect(state.last_received_at).toBe(first.received_at);
    expect(() => ingest(device, b, 'changed bytes')).toThrow(/batch ID/);
  });
  it('rejects reordered/concurrent sequence and stale generation before any raw writes', () => {
    const b = body([{ kind: 'upsert', record: record() }], 2);
    expect(() => ingest(device, b, 'x')).toThrow(/Expected sequence 1/);
    b.sequence = 1;
    b.device_generation = crypto.randomUUID();
    expect(() => ingest(device, b, 'x')).toThrow(/Pair this phone/);
    b.device_generation = device.generation;
    ingest(device, b, 'y');
    expect(() => ingest(device, { ...b, batch_id: crypto.randomUUID() }, 'z')).toThrow(
      /Expected sequence 2/
    );
    expect(vitals()).toHaveLength(1);
  });
  it.each(['revoked', 'key_revoked', 'key_expired', 'key_scope', 'legacy', 'wrong_owner'])(
    'rechecks %s under the write lock',
    (kind) => {
      const b = body([{ kind: 'upsert', record: record() }]);
      if (kind === 'revoked')
        ctx.sqlite.prepare('UPDATE mobile_devices SET revoked_at=?').run(new Date().toISOString());
      if (kind === 'key_revoked')
        ctx.sqlite.prepare('UPDATE api_keys SET revoked_at=?').run(new Date().toISOString());
      if (kind === 'key_expired')
        ctx.sqlite.prepare("UPDATE api_keys SET expires_at='2000-01-01T00:00:00Z'").run();
      if (kind === 'key_scope')
        ctx.sqlite.prepare('UPDATE api_keys SET scopes=\'["read:all"]\'').run();
      if (kind === 'legacy')
        ctx.sqlite.prepare("UPDATE mobile_delivery_modes SET mode='legacy'").run();
      expect(() =>
        ingest(kind === 'wrong_owner' ? { ...device, userId: STRANGER } : device, b, 'x')
      ).toThrow(/no longer/);
      expect(vitals()).toHaveLength(0);
      expect(ctx.sqlite.prepare('SELECT count(*) n FROM health_connect_raw_records').get()).toEqual(
        { n: 0 }
      );
    }
  );
  it('retains inventory and unknown types but requires an exact approved package', () => {
    const r = record();
    r.source_package = `${pkg}.lookalike`;
    const unknown = record('new_metric');
    const result = send([
      { kind: 'upsert', record: r },
      { kind: 'upsert', record: unknown },
    ]);
    expect(result.records.inserted).toBe(2);
    expect(vitals()).toHaveLength(0);
    expect(result.normalization.skipped_unapproved).toBe(2);
  });
  it('recomputes the old and new local day after edits and rejects older modifications', () => {
    const r = record();
    send([{ kind: 'upsert', record: r }]);
    const moved = {
      ...r,
      start_time: '2026-10-24T08:00:00Z',
      source_modified_at: '2026-10-25T00:00:00Z',
      data: { value: 81, unit: 'kg' },
    };
    send([{ kind: 'upsert', record: moved }]);
    expect(vitals()).toHaveLength(1);
    expect(vitals()[0].recorded_at).toBe('2026-10-24T00:00:00Z');
    expect(vitals()[0].value).toBeCloseTo(178.6, 1);
    expect(send([{ kind: 'upsert', record: r }]).records.stale).toBe(1);
    expect(vitals()[0].value).toBeCloseTo(178.6, 1);
  });
  it('preserves nanosecond modification ordering rather than dropping same-millisecond edits', () => {
    const a = { ...record(), source_modified_at: '2026-10-24T12:00:00.123456789Z' };
    send([{ kind: 'upsert', record: a }]);
    const b = {
      ...a,
      source_modified_at: '2026-10-24T12:00:00.123456790Z',
      data: { value: 81, unit: 'kg' },
    };
    expect(send([{ kind: 'upsert', record: b }]).records.updated).toBe(1);
    expect(vitals()[0].value).toBeCloseTo(178.6, 1);
    expect(send([{ kind: 'upsert', record: a }]).records.stale).toBe(1);
  });
  it('preserves projection IDs and metric receipt when later polls contain unchanged observations or aggregates', () => {
    const r = record();
    const aggregate: NativeEvent = {
      kind: 'daily_snapshot',
      date: '2026-10-24',
      values: { steps: 1234 },
    };
    send([{ kind: 'upsert', record: r }, aggregate]);
    const rows = () =>
      ctx.sqlite
        .prepare('SELECT id,metric_key,last_received_at,created_at FROM vitals ORDER BY metric_key')
        .all();
    const before = rows();
    expect(send([{ kind: 'upsert', record: r }, aggregate]).normalization.vitals_upserted).toBe(0);
    expect(rows()).toEqual(before);
    send([
      {
        kind: 'upsert',
        record: {
          ...r,
          source_modified_at: '2026-10-25T00:00:00Z',
          data: { value: 81, unit: 'kg' },
        },
      },
    ]);
    const after = rows() as { id: string; metric_key: string }[];
    expect(after.map((v) => v.id)).toEqual((before as { id: string }[]).map((v) => v.id));
  });
  it('delete events contain only UUIDs and remove the last day as a gap; stale snapshots cannot revive it', () => {
    const r = record();
    send([{ kind: 'upsert', record: r }]);
    expect(send([{ kind: 'delete', record_id: r.record_id }]).records.deleted).toBe(1);
    expect(vitals()).toHaveLength(0);
    expect(
      send([{ kind: 'upsert', record: { ...r, source_modified_at: '2026-10-25T12:00:00Z' } }])
        .records.stale
    ).toBe(1);
    expect(vitals()).toHaveLength(0);
    expect(
      ctx.sqlite.prepare('SELECT count(*) n FROM health_connect_native_deletions').get()
    ).toEqual({ n: 1 });
  });
  it('records a fence for a delete delivered before its upload', () => {
    const r = record();
    send([{ kind: 'delete', record_id: r.record_id }]);
    expect(send([{ kind: 'upsert', record: r }]).records.stale).toBe(1);
    expect(vitals()).toHaveLength(0);
  });
  it('activity snapshots replace overlapping totals and omitted values become gaps', () => {
    send([
      {
        kind: 'daily_snapshot',
        date: '2026-10-24',
        values: { steps: 1234, active_calories: 0, distance_meters: 1609.344 },
      },
    ]);
    expect(vitals().map((v) => [v.metric_key, v.value])).toEqual([
      ['active_calories', 0],
      ['distance', 1],
      ['steps', 1234],
    ]);
    send([{ kind: 'daily_snapshot', date: '2026-10-24', values: { steps: 1500 } }]);
    expect(vitals().map((v) => [v.metric_key, v.value])).toEqual([['steps', 1500]]);
    expect(vitals()[0].source).toBe('health_connect_daily');
  });
  it('keeps every BP/glucose UUID at one timestamp and legacy writes cannot overwrite them', async () => {
    const a = { ...record('blood_pressure'), data: { systolic: 120, diastolic: 80, unit: 'mmHg' } };
    const b = {
      ...a,
      record_id: crypto.randomUUID(),
      data: { systolic: 130, diastolic: 90, unit: 'mmHg' },
    };
    const glucose = record('blood_glucose', 0);
    const glucose2 = {
      ...glucose,
      record_id: crypto.randomUUID(),
      data: { value: 5, unit: 'mmol/L' },
    };
    send([a, b, glucose, glucose2].map((r) => ({ kind: 'upsert', record: r })));
    expect(vitals()).toHaveLength(6);
    const { upsertOwnVital } = await import('@/lib/repos/vitals');
    const { getDb } = await import('@/db');
    upsertOwnVital(getDb(), OWNER, {
      metricKey: 'bp_systolic',
      value: 140,
      unit: 'mmHg',
      source: vitals().find((v) => v.metric_key === 'bp_systolic')!.source,
      recordedAt: a.start_time,
    });
    expect(vitals()).toHaveLength(7);
    expect(
      vitals()
        .filter((v) => v.metric_key === 'bp_systolic' && v.native_record_id)
        .map((v) => v.value)
        .sort()
    ).toEqual([120, 130]);
    send([{ kind: 'delete', record_id: a.record_id }]);
    expect(
      vitals()
        .filter((v) => v.metric_key === 'bp_diastolic')
        .map((v) => v.value)
    ).toEqual([90]);
    expect(vitals().find((v) => v.metric_key === 'bp_systolic' && !v.native_record_id)?.value).toBe(
      140
    );
  });
  it('updates only affected local-day discrete projections and keeps BP components coherent', async () => {
    const a = { ...record('blood_pressure'), data: { systolic: 120, diastolic: 80, unit: 'mmHg' } };
    const b = {
      ...a,
      record_id: crypto.randomUUID(),
      start_time: '2026-10-24T08:00:00Z',
      data: { systolic: 130, diastolic: 90, unit: 'mmHg' },
    };
    send([a, b].map((record) => ({ kind: 'upsert', record })));
    const old = ctx.sqlite
      .prepare(
        "SELECT id,value,last_received_at FROM vitals WHERE json_extract(metadata,'$.source_record_id')=? ORDER BY metric_key"
      )
      .all(a.record_id);
    send([
      {
        kind: 'upsert',
        record: {
          ...b,
          source_modified_at: '2026-10-25T00:00:00Z',
          data: { systolic: 135, diastolic: 95, unit: 'mmHg' },
        },
      },
    ]);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT id,value,last_received_at FROM vitals WHERE json_extract(metadata,'$.source_record_id')=? ORDER BY metric_key"
        )
        .all(a.record_id)
    ).toEqual(old);
    const { listVitals } = await import('@/lib/repos/vitals');
    const rows = await listVitals(OWNER, { ownerId: OWNER, dependentId: null });
    expect(rows.find((v) => v.metricKey === 'bp_systolic')!.metadata.source_record_id).toBe(
      rows.find((v) => v.metricKey === 'bp_diastolic')!.metadata.source_record_id
    );
    expect(rows.find((v) => v.metricKey === 'bp_systolic')!.value).toBe(135);
  });
  it('reuses relay UUID nutrition identity and recalculates deletion without zeroing missing nutrients', () => {
    const r = {
      ...record('nutrition'),
      end_time: '2026-10-24T06:35:00Z',
      data: { calories: 100, protein_grams: 0 },
    };
    const legacyRawId = crypto.randomUUID();
    ctx.sqlite
      .prepare(
        `INSERT INTO health_connect_raw_records(id,integration_id,user_id,record_type,source_package,source_uuid,identity_kind,recorded_start_at,payload_json,first_seen_at,last_seen_at)
      VALUES(?,?,?,'nutrition',?,?,'uuid',?,?,?,?)`
      )
      .run(
        legacyRawId,
        device.integrationId,
        OWNER,
        pkg,
        r.record_id,
        r.start_time,
        JSON.stringify({ uuid: r.record_id, source: pkg, start_time: r.start_time, ...r.data }),
        new Date().toISOString(),
        new Date().toISOString()
      );
    send([{ kind: 'upsert', record: r }]);
    const row = () =>
      ctx.sqlite
        .prepare('SELECT calories,protein_grams,carbs_grams,record_count,date FROM nutrition_daily')
        .all();
    expect(row()).toEqual([
      { calories: 100, protein_grams: 0, carbs_grams: null, record_count: 1, date: '2026-10-23' },
    ]);
    expect(ctx.sqlite.prepare('SELECT id FROM health_connect_raw_records').all()).toEqual([
      { id: legacyRawId },
    ]);
    send([{ kind: 'upsert', record: r }]);
    expect(row()).toHaveLength(1);
    send([{ kind: 'delete', record_id: r.record_id }]);
    expect(row()).toHaveLength(0);
  });
  it('retains malformed native nutrients without projecting them or coercing blank to zero', () => {
    const r = { ...record('nutrition'), data: { calories: -10, protein_grams: 0 } };
    send([{ kind: 'upsert', record: r }]);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM health_connect_raw_records').get()).toEqual({
      n: 1,
    });
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM nutrition_daily').get()).toEqual({ n: 0 });
    const scalar = { ...record(), data: { value: '', unit: 'kg' } };
    send([{ kind: 'upsert', record: scalar }]);
    expect(vitals()).toHaveLength(0);
  });
  it('rolls back raw rows, sequence, batch ledger and outcomes when a projection fails, then safely retries', () => {
    ctx.sqlite.exec(
      "CREATE TRIGGER fail_native_vital BEFORE INSERT ON vitals BEGIN SELECT RAISE(ABORT,'synthetic projection failure'); END"
    );
    const b = body([{ kind: 'upsert', record: record() }]);
    expect(() => ingest(device, b, 'retry')).toThrow(/synthetic projection failure/);
    for (const table of [
      'health_connect_raw_records',
      'health_connect_native_state',
      'health_connect_native_batches',
      'health_connect_ingest_runs',
    ])
      expect(ctx.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({ n: 0 });
    ctx.sqlite.exec('DROP TRIGGER fail_native_vital');
    expect(ingest(device, b, 'retry').records.inserted).toBe(1);
    expect(vitals()).toHaveLength(1);
  });
  it('projects already retained native data after explicit source approval', async () => {
    ctx.sqlite.prepare("UPDATE health_connect_integrations SET status='inventory'").run();
    send([
      { kind: 'upsert', record: record() },
      { kind: 'daily_snapshot', date: '2026-10-24', values: { steps: 1234 } },
    ]);
    expect(vitals()).toHaveLength(0);
    const { updateIntegrationSettings } = await import('./rebuild-nutrition');
    await updateIntegrationSettings(OWNER, device.integrationId, { status: 'active' });
    expect(vitals().map((v) => v.metric_key)).toEqual(['steps', 'weight']);
  });
});

describe('bounded complete rescan reconciliation', () => {
  it('partial scans never infer deletions and completed scans delete only exact covered package/type/window', () => {
    const missing = record();
    const present = record();
    const outside = record('weight', 82, '2026-10-22T06:30:00Z');
    send([missing, present, outside].map((record) => ({ kind: 'upsert', record })));
    const scan = crypto.randomUUID();
    send([
      {
        kind: 'rescan_begin',
        scope: {
          scan_id: scan,
          record_type: 'weight',
          source_packages: [pkg],
          start_time: '2026-10-24T00:00:00Z',
          end_time: '2026-10-25T00:00:00Z',
        },
        cursor_anchored: true,
        authorized: true,
      },
    ]);
    send([{ kind: 'rescan_page', scan_id: scan, page: 0, records: [present] }]);
    expect(
      ctx.sqlite
        .prepare('SELECT count(*) n FROM health_connect_raw_records WHERE deleted_at IS NULL')
        .get()
    ).toEqual({ n: 3 });
    expect(
      send([{ kind: 'rescan_complete', scan_id: scan, page_count: 1, authorized: true }]).records
        .deleted
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare('SELECT source_uuid FROM health_connect_raw_records WHERE deleted_at IS NOT NULL')
        .all()
    ).toEqual([{ source_uuid: missing.record_id }]);
    expect(vitals()).toHaveLength(2);
  });
  it('rejects missing pages and out-of-scope records transactionally', () => {
    const scan = crypto.randomUUID();
    send([
      {
        kind: 'rescan_begin',
        scope: {
          scan_id: scan,
          record_type: 'weight',
          source_packages: [pkg],
          start_time: '2026-10-24T00:00:00Z',
          end_time: '2026-10-25T00:00:00Z',
        },
        cursor_anchored: true,
        authorized: true,
      },
    ]);
    const b = body([
      { kind: 'rescan_page', scan_id: scan, page: 0, records: [record(), record('blood_glucose')] },
    ]);
    expect(() => ingest(device, b, 'bad')).toThrow(/outside/);
    expect(vitals()).toHaveLength(0);
    b.events = [{ kind: 'rescan_complete', scan_id: scan, page_count: 1, authorized: true }];
    expect(() => ingest(device, b, 'bad2')).toThrow(/All rescan pages/);
  });
  it('does not delete a change delivered after the scan anchor', () => {
    const r = record();
    send([{ kind: 'upsert', record: r }]);
    const scan = crypto.randomUUID();
    send([
      {
        kind: 'rescan_begin',
        scope: {
          scan_id: scan,
          record_type: 'weight',
          source_packages: [pkg],
          start_time: '2026-10-24T00:00:00Z',
          end_time: '2026-10-25T00:00:00Z',
        },
        cursor_anchored: true,
        authorized: true,
      },
    ]);
    send([{ kind: 'upsert', record: r }]);
    expect(
      send([{ kind: 'rescan_complete', scan_id: scan, page_count: 0, authorized: true }]).records
        .deleted
    ).toBe(0);
    expect(vitals()).toHaveLength(1);
  });
});

describe('paired sync HTTP contract', () => {
  const url = 'http://localhost/api/v1/mobile/health-connect/sync';
  async function post(raw: string, headers: Record<string, string> = {}) {
    const { POST } = await import('@/app/api/v1/mobile/health-connect/sync/route');
    return POST(
      new Request(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body: raw,
      })
    );
  }
  async function signed(raw: string) {
    const { computeSignature } = await import('./signature');
    return { 'X-Signature': computeSignature(raw, 'synthetic-native-secret') };
  }
  it('requires a paired PAT and exact mandatory HMAC before interpreting records', async () => {
    const raw = JSON.stringify(body([{ kind: 'upsert', record: record() }]));
    expect((await post(raw)).status).toBe(403);
    expect((await post(raw, { 'X-Signature': 'sha256=bad' })).status).toBe(403);
    expect(
      (await post(raw, { ...(await signed(raw)), Authorization: 'Bearer bogus' })).status
    ).toBe(401);
    expect((await post(` ${raw}`, await signed(raw))).status).toBe(403);
    expect(vitals()).toHaveLength(0);
    const first = await post(raw, await signed(raw));
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(await (await post(raw, await signed(raw))).json()).toEqual(result);
    expect(vitals()).toHaveLength(1);
  });
  it('bounds raw bytes, rejects malformed JSON, and strips all client scope injection by schema rejection', async () => {
    const huge = 'x'.repeat(1048577);
    expect((await post(huge, { 'content-length': String(huge.length) })).status).toBe(413);
    expect((await post(huge)).status).toBe(413);
    expect((await post('{', await signed('{'))).status).toBe(400);
    const injected = JSON.stringify({ ...body([]), user_id: STRANGER });
    expect((await post(injected, await signed(injected))).status).toBe(400);
    expect(vitals()).toHaveLength(0);
  });
});
