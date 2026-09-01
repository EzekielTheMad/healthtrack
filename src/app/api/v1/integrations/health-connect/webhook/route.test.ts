// @vitest-environment node
/**
 * POST /api/v1/integrations/health-connect/webhook — end-to-end contract.
 *
 * Covers the auth/scope/signature/size matrix, lossless raw retention with
 * UUID identity, inventory mode, daily-totals → vitals, MacroFactor nutrition
 * → nutrition_daily (including the never-additive rule), idempotency across
 * retries and backfills, transaction rollback, and the regression pins that
 * the Oura/Renpho/myAir data paths and the existing vitals batch endpoint are
 * untouched.
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
import {
  TEST_PING,
  PREVIEW_PAYLOAD,
  BACKFILL_PAYLOAD,
  MACROFACTOR_PACKAGE,
} from '@/lib/integrations/health-connect/fixtures/payloads';

type WebhookRoute = typeof import('./route');
type SignatureLib = typeof import('@/lib/integrations/health-connect/signature');
type HcRepo = typeof import('@/lib/repos/health-connect');

let ctx: RepoTestDb;
let route: WebhookRoute;
let sig: SignatureLib;
let repo: HcRepo;
let secret: string;
let integrationId: string;

const URL = 'http://localhost/api/v1/integrations/health-connect/webhook';

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-hc-webhook-');
  [route, sig, repo] = await Promise.all([
    import('./route'),
    import('@/lib/integrations/health-connect/signature'),
    import('@/lib/repos/health-connect'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  const created = await repo.createIntegration(OWNER, { name: 'Phone' });
  secret = created.secret;
  integrationId = created.integration.id;
});

afterEach(() => ctx.restore());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(
  body: unknown,
  opts: { token?: string | null; signature?: string | null; raw?: string } = {},
): NextRequest {
  const rawBody = opts.raw ?? JSON.stringify(body);
  const token = opts.token === undefined ? mintApiToken(ctx.sqlite, OWNER, ['write:health_connect']) : opts.token;
  const signature =
    opts.signature === undefined ? sig.computeSignature(rawBody, secret) : opts.signature;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (signature) headers['X-Signature'] = signature;
  return new NextRequest(URL, { method: 'POST', headers, body: rawBody });
}

async function send(body: unknown, opts?: Parameters<typeof post>[1]) {
  const res = await route.POST(post(body, opts));
  return { res, body: await res.json() };
}

function rows(sql: string, ...params: unknown[]): Record<string, unknown>[] {
  return ctx.sqlite.prepare(sql).all(...params) as Record<string, unknown>[];
}

/** Approve MacroFactor + daily totals and go live. */
async function activate() {
  await repo.updateIntegration(OWNER, integrationId, {
    allowedSources: { nutrition: [MACROFACTOR_PACKAGE] },
    enabledTypes: ['daily_totals', 'nutrition'],
    status: 'active',
  });
}

// ---------------------------------------------------------------------------
// Auth + scope
// ---------------------------------------------------------------------------

describe('auth matrix', () => {
  it('401 without a token', async () => {
    const { res } = await send(PREVIEW_PAYLOAD, { token: null });
    expect(res.status).toBe(401);
  });

  it('403 for a token without write:health_connect', async () => {
    for (const scopes of [['read:all'], ['write:vitals'], ['write:fitness'], ['read:vitals']]) {
      const { res, body } = await send(PREVIEW_PAYLOAD, {
        token: mintApiToken(ctx.sqlite, OWNER, scopes),
      });
      expect(res.status, `scopes ${scopes.join(',')}`).toBe(403);
      expect(body.error).toContain('write:health_connect');
    }
  });

  it('accepts the dedicated scope', async () => {
    const { res } = await send(PREVIEW_PAYLOAD);
    expect(res.status).toBe(200);
  });

  it('403 when the token owner has no integration', async () => {
    const { res, body } = await send(PREVIEW_PAYLOAD, {
      token: mintApiToken(ctx.sqlite, VIEWER, ['write:health_connect']),
      signature: null,
    });
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/No Health Connect integration/);
  });

  it('403 for a paused integration', async () => {
    await repo.updateIntegration(OWNER, integrationId, { status: 'paused' });
    const { res, body } = await send(PREVIEW_PAYLOAD);
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/paused/);
    expect(rows('select * from health_connect_raw_records')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

describe('HMAC verification', () => {
  it('accepts a valid signature over the exact raw body', async () => {
    const { res } = await send(PREVIEW_PAYLOAD);
    expect(res.status).toBe(200);
  });

  it('403 for a missing signature', async () => {
    const { res, body } = await send(PREVIEW_PAYLOAD, { signature: null });
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/X-Signature/);
  });

  it('403 for an invalid or malformed signature', async () => {
    for (const signature of ['sha256=deadbeef', 'garbage', `sha256=${'0'.repeat(64)}`]) {
      const { res } = await send(PREVIEW_PAYLOAD, { signature });
      expect(res.status, signature).toBe(403);
    }
  });

  it('403 for a signature made with a different secret', async () => {
    const raw = JSON.stringify(PREVIEW_PAYLOAD);
    const { res } = await send(PREVIEW_PAYLOAD, {
      raw,
      signature: sig.computeSignature(raw, 'f'.repeat(64)),
    });
    expect(res.status).toBe(403);
  });

  it('verifies the RAW bytes, not reserialized JSON', async () => {
    // Bytes the "phone" sent: key order and spacing differ from JSON.stringify.
    const raw = '{ "source":"health_connect" ,  "timestamp":"2026-09-01T16:00:00Z","app_version":"1.8.0" }';
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);

    const wrong = await route.POST(
      post(null, { raw, signature: sig.computeSignature(reserialized, secret) }),
    );
    expect(wrong.status).toBe(403);

    const right = await route.POST(post(null, { raw, signature: sig.computeSignature(raw, secret) }));
    expect(right.status).toBe(200);
  });

  it('rejects everything after a secret rotation until the phone is updated', async () => {
    const stale = JSON.stringify(PREVIEW_PAYLOAD);
    const staleSignature = sig.computeSignature(stale, secret);
    const rotated = await repo.rotateSecret(OWNER, integrationId);
    expect(rotated).not.toBe(secret);

    const before = await route.POST(post(null, { raw: stale, signature: staleSignature }));
    expect(before.status).toBe(403);

    const after = await route.POST(
      post(null, { raw: stale, signature: sig.computeSignature(stale, rotated) }),
    );
    expect(after.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Envelope + limits
// ---------------------------------------------------------------------------

describe('envelope validation', () => {
  it('400 for malformed JSON', async () => {
    const { res, body } = await send(null, { raw: '{not json' });
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/valid JSON/);
  });

  it('400 for a JSON array body', async () => {
    const { res } = await send([1, 2, 3]);
    expect(res.status).toBe(400);
  });

  it('400 for a missing timestamp or a wrong source', async () => {
    const missing = await send({ app_version: '1.8.0', source: 'health_connect' });
    expect(missing.res.status).toBe(400);
    const wrongSource = await send({
      timestamp: '2026-09-01T00:00:00Z',
      app_version: '1.8.0',
      source: 'healthkit_ios',
    });
    expect(wrongSource.res.status).toBe(400);
  });

  it('400 for an out-of-range timestamp', async () => {
    const { res } = await send({
      timestamp: '1850-01-01T00:00:00Z',
      app_version: '1.8.0',
      source: 'health_connect',
    });
    expect(res.status).toBe(400);
  });

  it('413 for an oversized body', async () => {
    const saved = process.env.HEALTH_CONNECT_MAX_BODY_BYTES;
    process.env.HEALTH_CONNECT_MAX_BODY_BYTES = '256';
    try {
      const { res, body } = await send(PREVIEW_PAYLOAD);
      expect(res.status).toBe(413);
      expect(body.error).toMatch(/too large/);
      // Nothing was written, and the size check ran before authentication.
      expect(rows('select * from health_connect_ingest_runs')).toHaveLength(0);
    } finally {
      if (saved === undefined) delete process.env.HEALTH_CONNECT_MAX_BODY_BYTES;
      else process.env.HEALTH_CONNECT_MAX_BODY_BYTES = saved;
    }
  });

  it('retains unknown top-level fields without normalizing them', async () => {
    await activate();
    const { res } = await send({
      timestamp: '2026-09-01T16:00:00Z',
      app_version: '1.8.0',
      source: 'health_connect',
      _diagnostics: { steps: 'ok' },
      future_metric: [{ value: 42, uuid: 'x' }],
    });
    expect(res.status).toBe(200);
    const run = rows('select * from health_connect_ingest_runs')[0];
    const envelope = JSON.parse(String(run.raw_envelope_json));
    expect(envelope._diagnostics).toEqual({ steps: 'ok' });
    expect(envelope.future_metric).toEqual({ omitted_array_length: 1 });
    // The unknown array became neither a raw record nor a vital.
    expect(rows('select * from health_connect_raw_records')).toHaveLength(0);
    expect(rows('select * from vitals')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test ping
// ---------------------------------------------------------------------------

describe('Send Test Ping', () => {
  it('returns 200 and logs the delivery without touching health data', async () => {
    const { res, body } = await send(TEST_PING);
    expect(res.status).toBe(200);
    expect(body.status).toBe('test_ping');
    expect(body.records.received).toBe(0);

    const runs = rows('select * from health_connect_ingest_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('test_ping');
    expect(rows('select * from health_connect_raw_records')).toHaveLength(0);
    expect(rows('select * from vitals')).toHaveLength(0);

    const integration = await repo.getIntegration(OWNER);
    expect(integration!.lastReceivedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Inventory mode
// ---------------------------------------------------------------------------

describe('inventory mode', () => {
  it('stores raw records losslessly but writes nothing canonical', async () => {
    const { res, body } = await send(PREVIEW_PAYLOAD);
    expect(res.status).toBe(200);
    expect(body.status).toBe('accepted');
    // 2 daily_totals + 2 nutrition + 1 sleep + 1 weight + 1 exercise
    expect(body.records.inserted).toBe(7);
    expect(body.normalization.vitals_upserted).toBe(0);
    expect(body.normalization.nutrition_days_upserted).toBe(0);
    expect(body.normalization.skipped_unapproved).toBe(body.records.received);

    expect(rows('select * from vitals')).toHaveLength(0);
    expect(rows('select * from nutrition_daily')).toHaveLength(0);
    expect(rows('select * from health_connect_raw_records').length).toBeGreaterThan(0);
  });

  it('preserves source uuid and package verbatim for every record that has them', async () => {
    await send(PREVIEW_PAYLOAD);
    const raw = rows('select * from health_connect_raw_records order by record_type');
    const byUuid = new Map(raw.map((r) => [r.source_uuid, r]));
    expect(byUuid.get('mf-record-0001')!.source_package).toBe('com.sbs.diet');
    expect(byUuid.get('oura-sleep-0001')!.source_package).toBe('com.ouraring.oura');
    expect(byUuid.get('renpho-weight-0001')!.source_package).toBe('com.renpho.healthcare');
    for (const uuid of ['mf-record-0001', 'oura-sleep-0001', 'renpho-weight-0001']) {
      expect(byUuid.get(uuid)!.identity_kind).toBe('uuid');
    }
    // The full record body is retained, unknown fields included.
    const sleep = byUuid.get('oura-sleep-0001')!;
    expect(JSON.parse(String(sleep.payload_json)).stages).toHaveLength(1);
  });

  it('gives uuid-less daily_totals a labelled derived identity keyed on the date', async () => {
    await send(PREVIEW_PAYLOAD);
    const totals = rows(
      "select * from health_connect_raw_records where record_type = 'daily_totals' order by source_uuid",
    );
    expect(totals).toHaveLength(2);
    expect(totals.map((t) => t.source_uuid)).toEqual(['date:2026-08-31', 'date:2026-09-01']);
    expect(totals[0].identity_kind).toBe('derived');
    expect(totals[0].source_package).toBe('health_connect_aggregate');
  });

  it('surfaces observed types and packages in the inventory', async () => {
    await send(PREVIEW_PAYLOAD);
    const inventory = await repo.getInventory(OWNER, integrationId);
    const nutrition = inventory.find((i) => i.recordType === 'nutrition')!;
    expect(nutrition.sourcePackage).toBe(MACROFACTOR_PACKAGE);
    expect(nutrition.count).toBe(2);
    expect(nutrition.populatedFields).toContain('protein_grams');
    expect(nutrition.oldest).toBe('2026-09-01T14:05:00.000Z');
    expect(nutrition.newest).toBe('2026-09-01T19:30:00.000Z');
    expect(inventory.map((i) => i.recordType)).toContain('sleep');
  });
});

// ---------------------------------------------------------------------------
// Daily activity totals
// ---------------------------------------------------------------------------

describe('daily totals normalization', () => {
  it('writes the four approved metrics with correct units and dates', async () => {
    await activate();
    const { body } = await send(PREVIEW_PAYLOAD);
    expect(body.normalization.vitals_upserted).toBe(7); // 4 for Aug 31, 3 for Sep 1

    const vitals = rows(
      "select metric_key, value, unit, source, recorded_at from vitals where recorded_at = '2026-08-31T00:00:00Z' order by metric_key",
    );
    expect(vitals).toEqual([
      { metric_key: 'active_calories', value: 612.5, unit: 'kcal', source: 'health_connect_daily', recorded_at: '2026-08-31T00:00:00Z' },
      { metric_key: 'distance', value: 5, unit: 'mi', source: 'health_connect_daily', recorded_at: '2026-08-31T00:00:00Z' },
      { metric_key: 'steps', value: 11240, unit: 'steps', source: 'health_connect_daily', recorded_at: '2026-08-31T00:00:00Z' },
      { metric_key: 'total_calories', value: 2430, unit: 'kcal', source: 'health_connect_daily', recorded_at: '2026-08-31T00:00:00Z' },
    ]);
  });

  it('leaves a metric untouched when the snapshot omits it (unknown, not zero)', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);
    const sep1 = rows(
      "select metric_key from vitals where recorded_at = '2026-09-01T00:00:00Z' order by metric_key",
    ).map((r) => r.metric_key);
    // The Sep 1 entry carries no total_calories.
    expect(sep1).toEqual(['active_calories', 'distance', 'steps']);
  });

  it('REPLACES the day rather than adding to it', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);
    const revised = {
      ...PREVIEW_PAYLOAD,
      timestamp: '2026-09-01T18:00:00Z',
      daily_totals: [{ date: '2026-08-31', steps: 12000 }],
      nutrition: [],
    };
    await send(revised);
    const steps = rows(
      "select value from vitals where metric_key = 'steps' and recorded_at = '2026-08-31T00:00:00Z'",
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].value).toBe(12000); // not 11240 + 12000
  });

  it('stamps traceability metadata on every row', async () => {
    await activate();
    const { body } = await send(PREVIEW_PAYLOAD);
    const row = rows("select metadata from vitals where metric_key = 'steps' limit 1")[0];
    const metadata = JSON.parse(String(row.metadata));
    expect(metadata.health_connect_date).toBe('2026-08-31');
    expect(metadata.app_version).toBe('1.8.0');
    expect(metadata.integration_id).toBe(integrationId);
    expect(metadata.ingest_id).toBe(body.ingest_id);
  });
});

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

describe('nutrition normalization', () => {
  it('writes one canonical row per Phoenix date and approved package', async () => {
    await activate();
    const { body } = await send(PREVIEW_PAYLOAD);
    expect(body.normalization.nutrition_days_upserted).toBe(1);

    const days = rows('select * from nutrition_daily');
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({
      date: '2026-09-01',
      source_package: MACROFACTOR_PACKAGE,
      calories: 1260,
      protein_grams: 97.5,
      carbs_grams: 99,
      fat_grams: 42.5,
      record_count: 2,
    });
    // Reserved nutrients the relay does not publish stay null.
    expect(days[0].fiber_grams).toBeNull();
    expect(days[0].sodium_milligrams).toBeNull();
  });

  it('recomputes the day when a record is edited — never adds to the stored total', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);

    const edited = {
      ...PREVIEW_PAYLOAD,
      timestamp: '2026-09-01T20:00:00Z',
      daily_totals: [],
      nutrition: [
        {
          ...PREVIEW_PAYLOAD.nutrition[1],
          calories: 640, // corrected down from 740
          protein_grams: 50,
        },
      ],
    };
    const { body } = await send(edited);
    expect(body.records.updated).toBe(1);

    const day = rows('select * from nutrition_daily')[0];
    expect(day.calories).toBe(1160); // 520 + 640, recomputed from BOTH retained records
    expect(day.protein_grams).toBe(92.5);
    expect(day.record_count).toBe(2);
  });

  it('recomputes BOTH days when an edit moves a record across the Phoenix boundary', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);
    expect(rows('select * from nutrition_daily')).toHaveLength(1);

    const moved = {
      ...PREVIEW_PAYLOAD,
      timestamp: '2026-09-02T20:00:00Z',
      daily_totals: [],
      nutrition: [
        {
          ...PREVIEW_PAYLOAD.nutrition[1],
          // 07:30Z on Sep 2 is 00:30 Sep 2 in Phoenix — the next day.
          start_time: '2026-09-02T07:30:00Z',
          end_time: '2026-09-02T07:30:00Z',
        },
      ],
    };
    await send(moved);

    const days = rows('select * from nutrition_daily order by date');
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: '2026-09-01', calories: 520, record_count: 1 });
    expect(days[1]).toMatchObject({ date: '2026-09-02', calories: 740, record_count: 1 });
  });

  it('keeps unreported nutrients null instead of zero', async () => {
    await activate();
    await send({
      timestamp: '2026-09-03T16:00:00Z',
      app_version: '1.8.0',
      source: 'health_connect',
      nutrition: [
        {
          calories: 400,
          start_time: '2026-09-03T15:00:00Z',
          end_time: '2026-09-03T15:00:00Z',
          source: MACROFACTOR_PACKAGE,
          uuid: 'mf-partial-1',
        },
      ],
    });
    const day = rows("select * from nutrition_daily where date = '2026-09-03'")[0];
    expect(day.calories).toBe(400);
    expect(day.protein_grams).toBeNull();
    expect(day.carbs_grams).toBeNull();
    expect(day.fat_grams).toBeNull();
  });

  it('matches the approved package EXACTLY, never by substring', async () => {
    await activate();
    await send({
      timestamp: '2026-09-04T16:00:00Z',
      app_version: '1.8.0',
      source: 'health_connect',
      nutrition: [
        {
          calories: 999,
          start_time: '2026-09-04T15:00:00Z',
          end_time: '2026-09-04T15:00:00Z',
          source: `${MACROFACTOR_PACKAGE}.clone`,
          uuid: 'impostor-1',
        },
        {
          calories: 111,
          start_time: '2026-09-04T15:05:00Z',
          end_time: '2026-09-04T15:05:00Z',
          source: 'com.sbs',
          uuid: 'impostor-2',
        },
      ],
    });
    // Both impostors are retained raw…
    expect(
      rows("select * from health_connect_raw_records where record_type = 'nutrition' and source_uuid like 'impostor%'"),
    ).toHaveLength(2);
    // …and neither reached the canonical table.
    expect(rows("select * from nutrition_daily where date = '2026-09-04'")).toHaveLength(0);
  });

  it('leaves nutrition alone when the type is not enabled', async () => {
    await repo.updateIntegration(OWNER, integrationId, {
      allowedSources: { nutrition: [MACROFACTOR_PACKAGE] },
      enabledTypes: ['daily_totals'],
      status: 'active',
    });
    await send(PREVIEW_PAYLOAD);
    expect(rows('select * from nutrition_daily')).toHaveLength(0);
    expect(rows('select * from vitals').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('treats an identical re-delivery as one ingest with no duplicate rows', async () => {
    await activate();
    const first = await send(PREVIEW_PAYLOAD);
    const second = await send(PREVIEW_PAYLOAD);

    expect(second.res.status).toBe(200);
    expect(second.body.status).toBe('duplicate');
    expect(second.body.ingest_id).toBe(first.body.ingest_id);
    expect(rows('select * from health_connect_ingest_runs')).toHaveLength(1);
    expect(rows('select * from health_connect_raw_records')).toHaveLength(7);
    expect(rows('select * from nutrition_daily')).toHaveLength(1);
    expect(rows("select * from vitals where metric_key = 'steps'")).toHaveLength(2);
  });

  it('updates the raw record when the same uuid arrives in a different batch', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);
    const { body } = await send({
      ...PREVIEW_PAYLOAD,
      timestamp: '2026-09-01T21:00:00Z',
      daily_totals: [],
      nutrition: [{ ...PREVIEW_PAYLOAD.nutrition[0], calories: 555 }],
    });
    expect(body.records.updated).toBe(1);
    expect(body.records.inserted).toBe(0);
    const raw = rows("select * from health_connect_raw_records where source_uuid = 'mf-record-0001'");
    expect(raw).toHaveLength(1);
    expect(JSON.parse(String(raw[0].payload_json)).calories).toBe(555);
  });

  it('counts an unchanged repeat record as a duplicate, not an update', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);
    const { body } = await send({
      timestamp: '2026-09-01T22:00:00Z',
      app_version: '1.8.0',
      source: 'health_connect',
      nutrition: [PREVIEW_PAYLOAD.nutrition[0]],
    });
    expect(body.records.received).toBe(1);
    expect(body.records.duplicates).toBe(1);
    expect(body.records.updated).toBe(0);
    expect(body.records.inserted).toBe(0);
  });

  it('does not duplicate when a backfill overlaps a normal sync', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);
    const before = rows('select * from health_connect_raw_records').length;

    const { res, body } = await send(BACKFILL_PAYLOAD);
    expect(res.status).toBe(200);
    expect(body.records.duplicates).toBe(1);
    expect(body.records.inserted).toBe(0);
    expect(rows('select * from health_connect_raw_records')).toHaveLength(before);

    const day = rows('select * from nutrition_daily')[0];
    expect(day.calories).toBe(1260); // unchanged — not 1260 + 520
    const run = rows("select * from health_connect_ingest_runs where is_backfill = 1")[0];
    expect(run.window_start).toBe('2026-08-25T00:00:00Z');
  });

  it('keeps the same uuid separate across source packages and record types', async () => {
    const shared = 'shared-uuid-1';
    await send({
      timestamp: '2026-09-05T16:00:00Z',
      app_version: '1.8.0',
      source: 'health_connect',
      nutrition: [
        { calories: 10, start_time: '2026-09-05T15:00:00Z', end_time: '2026-09-05T15:00:00Z', source: 'app.one', uuid: shared },
        { calories: 20, start_time: '2026-09-05T15:00:00Z', end_time: '2026-09-05T15:00:00Z', source: 'app.two', uuid: shared },
      ],
      hydration: [
        { liters: 0.5, start_time: '2026-09-05T15:00:00Z', end_time: '2026-09-05T15:00:00Z', source: 'app.one', uuid: shared },
      ],
    });
    expect(rows('select * from health_connect_raw_records where source_uuid = ?', shared)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

describe('transaction integrity', () => {
  it('rolls raw and canonical writes back together on a database failure', async () => {
    await activate();
    // Break the canonical target mid-flight: nutrition normalization will
    // throw, and the raw inserts from the same payload must not survive.
    ctx.sqlite.exec('drop table nutrition_daily');
    const { res, body } = await send(PREVIEW_PAYLOAD);

    expect(res.status).toBe(500);
    expect(body.error).toBe('internal_error');
    expect(rows('select * from health_connect_raw_records')).toHaveLength(0);
    expect(rows('select * from health_connect_ingest_runs')).toHaveLength(0);
    expect(rows('select * from vitals')).toHaveLength(0);
  });

  it('leaves no partial rows when the envelope is rejected', async () => {
    await activate();
    const { res } = await send({ timestamp: 'nope', source: 'health_connect' });
    expect(res.status).toBe(400);
    expect(rows('select * from health_connect_raw_records')).toHaveLength(0);
    expect(rows('select * from health_connect_ingest_runs')).toHaveLength(0);
    expect(rows('select * from nutrition_daily')).toHaveLength(0);
  });

  it('records a run only after the ingestion commits, so a failed delivery can be retried', async () => {
    await activate();
    ctx.sqlite.exec('drop table nutrition_daily');
    await send(PREVIEW_PAYLOAD);
    expect(rows('select * from health_connect_ingest_runs')).toHaveLength(0);

    // Restore and retry the very same payload — it must process normally
    // rather than being mistaken for an already-handled duplicate.
    ctx.sqlite.exec(`create table nutrition_daily (
      id text primary key not null, user_id text not null, date text not null,
      source_package text not null, calories real, protein_grams real, carbs_grams real,
      fat_grams real, fiber_grams real, sugar_grams real, sodium_milligrams real,
      record_count integer default 0 not null, metadata_json text default '{}' not null,
      created_at text not null, updated_at text not null)`);
    ctx.sqlite.exec(
      'create unique index idx_nutrition_daily_unique on nutrition_daily (user_id, date, source_package)',
    );

    const { res, body } = await send(PREVIEW_PAYLOAD);
    expect(res.status).toBe(200);
    expect(body.status).toBe('accepted');
    expect(body.records.inserted).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Source ownership + cross-user isolation
// ---------------------------------------------------------------------------

describe('source ownership protections', () => {
  it('never normalizes Oura, Renpho or generic exercise records', async () => {
    await activate();
    // Pre-existing direct-bridge rows.
    const insert = ctx.sqlite.prepare(
      `insert into vitals (id, user_id, metric_key, value, unit, source, recorded_at, metadata, created_at)
       values (?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
    );
    insert.run(crypto.randomUUID(), OWNER, 'weight', 196.0, 'lbs', 'renpho', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
    insert.run(crypto.randomUUID(), OWNER, 'sleep_duration', 7.4, 'hours', 'oura', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
    insert.run(crypto.randomUUID(), OWNER, 'ahi', 1.2, 'events/hr', 'myair', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

    await send(PREVIEW_PAYLOAD);

    // Untouched.
    expect(rows("select value from vitals where source = 'renpho'")[0].value).toBe(196.0);
    expect(rows("select value from vitals where source = 'oura'")[0].value).toBe(7.4);
    expect(rows("select value from vitals where source = 'myair'")[0].value).toBe(1.2);
    // No competing rows were created from the Health Connect payload.
    expect(rows("select * from vitals where source = 'health_connect_daily' and metric_key in ('weight','sleep_duration')")).toHaveLength(0);
    // And no workout was invented from the generic exercise session.
    expect(rows('select * from workout_sessions')).toHaveLength(0);
  });

  it('writes only to the token owner (no cross-user leakage)', async () => {
    await activate();
    await send(PREVIEW_PAYLOAD);
    expect(rows('select distinct user_id from health_connect_raw_records')).toEqual([
      { user_id: OWNER },
    ]);
    expect(rows('select * from nutrition_daily where user_id = ?', VIEWER)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression pins
// ---------------------------------------------------------------------------

describe('regressions', () => {
  it('leaves the existing vitals batch endpoint behaviour unchanged', async () => {
    const batch = await import('@/app/api/v1/vitals/batch/route');
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:vitals']);
    const res = await batch.POST(
      new NextRequest('http://localhost/api/v1/vitals/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: [
            { metric_key: 'steps', value: 8200, source: 'samsung_health', recorded_at: '2026-09-01T21:15:00Z' },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1, updated: 0, errors: [] });
    // A different source keeps its own row alongside health_connect_daily.
    await activate();
    await send(PREVIEW_PAYLOAD);
    expect(
      rows("select source from vitals where metric_key = 'steps' and recorded_at = '2026-09-01T00:00:00Z' order by source"),
    ).toEqual([{ source: 'health_connect_daily' }, { source: 'samsung_health' }]);
  });

  it('does not let write:health_connect reach other write endpoints', async () => {
    const batch = await import('@/app/api/v1/vitals/batch/route');
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:health_connect']);
    const res = await batch.POST(
      new NextRequest('http://localhost/api/v1/vitals/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
