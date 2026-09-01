// @vitest-environment node
/**
 * GET /api/v1/integrations/health-connect/{inventory,records} — the PAT read
 * surface for retained Health Connect data.
 *
 * The security shape being pinned: `read:health_connect` is a NEW scope that
 * `read:all` satisfies and `write:health_connect` does not. A token pasted
 * into a phone can deliver records; it must not be able to read the retained
 * history back out, and no caller can reach another user's records or any
 * secret material.
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
import { MACROFACTOR_ITEMS } from '@/lib/integrations/health-connect/fixtures/macrofactor';
import { MACROFACTOR_PACKAGE } from '@/lib/integrations/health-connect/fixtures/payloads';

type InventoryRoute = typeof import('./inventory/route');
type RecordsRoute = typeof import('./records/route');
type Repo = typeof import('@/lib/repos/health-connect');
type Rebuild = typeof import('@/lib/integrations/health-connect/rebuild-nutrition');

let ctx: RepoTestDb;
let inventoryRoute: InventoryRoute;
let recordsRoute: RecordsRoute;
let repo: Repo;
let rebuild: Rebuild;
let integrationId: string;

const INVENTORY_URL = 'http://localhost/api/v1/integrations/health-connect/inventory';
const RECORDS_URL = 'http://localhost/api/v1/integrations/health-connect/records';

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-hc-readapi-');
  [inventoryRoute, recordsRoute, repo, rebuild] = await Promise.all([
    import('./inventory/route'),
    import('./records/route'),
    import('@/lib/repos/health-connect'),
    import('@/lib/integrations/health-connect/rebuild-nutrition'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  integrationId = (await repo.createIntegration(OWNER, { name: 'Phone' })).integration.id;
});

afterEach(() => ctx.restore());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedRecord(opts: {
  userId?: string;
  recordType?: string;
  sourcePackage?: string;
  uuid: string;
  startAt: string;
  payload?: Record<string, unknown>;
  integrationId?: string | null;
}) {
  ctx.sqlite
    .prepare(
      `insert into health_connect_raw_records
        (id, integration_id, user_id, record_type, source_package, source_uuid,
         identity_kind, recorded_start_at, recorded_end_at, source_last_modified_at,
         payload_json, first_seen_at, last_seen_at, last_ingest_id)
       values (?, ?, ?, ?, ?, ?, 'uuid', ?, null, null, ?, ?, ?, 'ingest-1')`,
    )
    .run(
      crypto.randomUUID(),
      opts.integrationId === undefined ? integrationId : opts.integrationId,
      opts.userId ?? OWNER,
      opts.recordType ?? 'nutrition',
      opts.sourcePackage ?? MACROFACTOR_PACKAGE,
      opts.uuid,
      // Ingestion always stores a normalized ISO instant (with milliseconds);
      // seeding must match, or a boundary comparison is testing the wrong thing.
      new Date(opts.startAt).toISOString(),
      JSON.stringify(opts.payload ?? { calories: 100, start_time: opts.startAt }),
      '2026-09-01T00:00:00Z',
      '2026-09-01T00:00:00Z',
    );
}

function seedMacroFactor(userId = OWNER) {
  for (const item of MACROFACTOR_ITEMS) {
    seedRecord({
      userId,
      uuid: item.uuid,
      startAt: new Date(item.start_time).toISOString(),
      payload: item as unknown as Record<string, unknown>,
    });
  }
}

function get(
  route: { GET: (r: NextRequest) => Promise<Response> },
  url: string,
  query: Record<string, string | undefined>,
  scopes: string[] | null = ['read:health_connect'],
) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) target.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (scopes) headers.Authorization = `Bearer ${mintApiToken(ctx.sqlite, OWNER, scopes)}`;
  return route.GET(new NextRequest(target, { headers }));
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

/** A window wide enough to cover every seeded record. */
const WINDOW = { start_at: '2026-08-01T00:00:00Z', end_at: '2026-09-10T00:00:00Z' };

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('authorization', () => {
  for (const [name, route, url] of [
    ['inventory', () => inventoryRoute, INVENTORY_URL],
    ['records', () => recordsRoute, RECORDS_URL],
  ] as const) {
    it(`${name}: 401 without a token`, async () => {
      const res = await get(route(), url, { record_type: 'nutrition', ...WINDOW }, null);
      expect(res.status).toBe(401);
    });

    it(`${name}: accepts read:health_connect`, async () => {
      const res = await get(route(), url, { record_type: 'nutrition', ...WINDOW });
      expect(res.status).toBe(200);
    });

    it(`${name}: accepts read:all`, async () => {
      const res = await get(route(), url, { record_type: 'nutrition', ...WINDOW }, ['read:all']);
      expect(res.status).toBe(200);
    });

    it(`${name}: 403 for write:health_connect — ingest does not imply read`, async () => {
      const res = await get(route(), url, { record_type: 'nutrition', ...WINDOW }, [
        'write:health_connect',
      ]);
      expect(res.status).toBe(403);
      expect((await json(res)).error).toContain('read:health_connect');
    });

    it(`${name}: 403 for unrelated read scopes`, async () => {
      for (const scopes of [['read:nutrition'], ['read:vitals'], ['write:all']]) {
        const res = await get(route(), url, { record_type: 'nutrition', ...WINDOW }, scopes);
        expect(res.status, scopes.join(',')).toBe(403);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe('inventory', () => {
  it('summarises each record type × exact package with counts and range', async () => {
    seedMacroFactor();
    seedRecord({
      recordType: 'sleep',
      sourcePackage: 'com.ouraring.oura',
      uuid: 'oura-1',
      startAt: '2026-09-01T13:00:00Z',
      payload: { session_end_time: '2026-09-01T13:00:00Z', duration_seconds: 26400 },
    });

    const body = (await (await get(inventoryRoute, INVENTORY_URL, {})).json()) as Record<
      string,
      unknown
    >[];

    expect(body).toHaveLength(2);
    const nutrition = body.find((e) => e.record_type === 'nutrition')!;
    expect(nutrition.source_package).toBe(MACROFACTOR_PACKAGE);
    expect(nutrition.record_count).toBe(16);
    expect(nutrition.integration_id).toBe(integrationId);
    expect(nutrition.integration_status).toBe('inventory');
    expect(nutrition.earliest_record_at).toBe('2026-08-31T13:42:00.000Z');
    expect(nutrition.fields_observed).toEqual(
      expect.arrayContaining(['calories', 'protein_grams', 'start_time', 'uuid']),
    );
  });

  it('reports the canonical policy and why, per exact package', async () => {
    seedMacroFactor();
    seedRecord({
      recordType: 'sleep',
      sourcePackage: 'com.ouraring.oura',
      uuid: 'oura-1',
      startAt: '2026-09-01T13:00:00Z',
    });

    let body = (await (await get(inventoryRoute, INVENTORY_URL, {})).json()) as Record<
      string,
      unknown
    >[];
    // Unapproved nutrition and always-raw sleep are both raw_only, for
    // different, stated reasons.
    expect(body.find((e) => e.record_type === 'nutrition')!.canonical_policy).toBe('raw_only');
    expect(
      String(body.find((e) => e.record_type === 'nutrition')!.canonical_policy_reason),
    ).toMatch(/not enabled/i);
    expect(body.find((e) => e.record_type === 'sleep')!.canonical_policy).toBe('raw_only');
    expect(String(body.find((e) => e.record_type === 'sleep')!.canonical_policy_reason)).toMatch(
      /oura/i,
    );

    await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      allowedSources: { nutrition: [MACROFACTOR_PACKAGE] },
      enabledTypes: ['nutrition'],
      status: 'active',
    });

    body = (await (await get(inventoryRoute, INVENTORY_URL, {})).json()) as Record<
      string,
      unknown
    >[];
    expect(body.find((e) => e.record_type === 'nutrition')!.canonical_policy).toBe('normalized');
    expect(body.find((e) => e.record_type === 'nutrition')!.last_normalized_at).not.toBeNull();
    // Sleep is unaffected by nutrition approval.
    expect(body.find((e) => e.record_type === 'sleep')!.canonical_policy).toBe('raw_only');
  });

  it('filters by record type, exact package and integration id', async () => {
    seedMacroFactor();
    seedRecord({
      sourcePackage: 'com.sbs.diet.free',
      uuid: 'lookalike-1',
      startAt: '2026-09-01T15:00:00Z',
    });

    const byType = (await (
      await get(inventoryRoute, INVENTORY_URL, { record_type: 'nutrition' })
    ).json()) as unknown[];
    expect(byType).toHaveLength(2);

    // Exact package matching — the lookalike is a separate entry, never merged.
    const byPackage = (await (
      await get(inventoryRoute, INVENTORY_URL, { source_package: MACROFACTOR_PACKAGE })
    ).json()) as Record<string, unknown>[];
    expect(byPackage).toHaveLength(1);
    expect(byPackage[0].record_count).toBe(16);

    const byIntegration = (await (
      await get(inventoryRoute, INVENTORY_URL, { integration_id: integrationId })
    ).json()) as unknown[];
    expect(byIntegration).toHaveLength(2);
  });

  it('returns nothing for an integration id the caller does not own', async () => {
    seedMacroFactor();
    const other = crypto.randomUUID();
    const body = (await (
      await get(inventoryRoute, INVENTORY_URL, { integration_id: other })
    ).json()) as unknown[];
    expect(body).toEqual([]);
  });

  it('never includes another user’s records', async () => {
    seedMacroFactor(VIEWER);
    const body = (await (await get(inventoryRoute, INVENTORY_URL, {})).json()) as unknown[];
    expect(body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

describe('records', () => {
  it('refuses an unbounded query with 400, never a full dump', async () => {
    seedMacroFactor();

    // No narrowing filter at all.
    let res = await get(recordsRoute, RECORDS_URL, WINDOW);
    expect(res.status).toBe(400);
    expect(String((await json(res)).error)).toMatch(/integration_id or record_type/);

    // No time range.
    res = await get(recordsRoute, RECORDS_URL, { record_type: 'nutrition' });
    expect(res.status).toBe(400);
    expect(String((await json(res)).error)).toMatch(/start_at and end_at/);

    // Only half a range.
    res = await get(recordsRoute, RECORDS_URL, {
      record_type: 'nutrition',
      start_at: WINDOW.start_at,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a range wider than the maximum window', async () => {
    const res = await get(recordsRoute, RECORDS_URL, {
      record_type: 'nutrition',
      start_at: '2020-01-01T00:00:00Z',
      end_at: '2026-09-01T00:00:00Z',
    });
    expect(res.status).toBe(400);
    expect(String((await json(res)).error)).toMatch(/maximum is 400/);
  });

  it('rejects malformed and inverted ranges', async () => {
    let res = await get(recordsRoute, RECORDS_URL, {
      record_type: 'nutrition',
      start_at: 'yesterday',
      end_at: WINDOW.end_at,
    });
    expect(res.status).toBe(400);

    res = await get(recordsRoute, RECORDS_URL, {
      record_type: 'nutrition',
      start_at: WINDOW.end_at,
      end_at: WINDOW.start_at,
    });
    expect(res.status).toBe(400);
  });

  it('returns the raw envelope with the record object preserved verbatim', async () => {
    seedRecord({
      uuid: 'mf-1',
      startAt: '2026-09-01T15:00:00Z',
      payload: {
        calories: 520,
        protein_grams: null,
        start_time: '2026-09-01T15:00:00Z',
        some_future_field: { nested: true },
      },
    });

    const body = await json(
      await get(recordsRoute, RECORDS_URL, { record_type: 'nutrition', ...WINDOW }),
    );
    const records = body.records as Record<string, unknown>[];
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.record_type).toBe('nutrition');
    expect(r.source_package).toBe(MACROFACTOR_PACKAGE);
    expect(r.source_uuid).toBe('mf-1');
    expect(r.identity_kind).toBe('uuid');
    expect(r.recorded_start_at).toBe('2026-09-01T15:00:00.000Z');
    // 15:00Z is 08:00 Phoenix on the same day.
    expect(r.phoenix_date).toBe('2026-09-01');
    expect(r.observed_fields).toEqual([
      'calories',
      'protein_grams',
      'some_future_field',
      'start_time',
    ]);
    // null vs absent both survive: protein is null, fat is simply not there.
    const record = r.record as Record<string, unknown>;
    expect(record.protein_grams).toBeNull();
    expect('fat_grams' in record).toBe(false);
    expect(record.some_future_field).toEqual({ nested: true });
  });

  it('never returns secrets or body digests', async () => {
    seedMacroFactor();
    ctx.sqlite
      .prepare(
        `insert into health_connect_ingest_runs
          (id, integration_id, user_id, body_sha256, is_backfill, status,
           received_count, inserted_count, updated_count, duplicate_count,
           rejected_count, normalization_summary_json, received_at)
         values (?, ?, ?, 'deadbeefdigest', 0, 'accepted', 1, 1, 0, 0, 0, '{}', ?)`,
      )
      .run(crypto.randomUUID(), integrationId, OWNER, '2026-09-01T00:00:00Z');

    const secret = String(
      ctx.sqlite
        .prepare('select hmac_secret_encrypted from health_connect_integrations')
        .get() as { hmac_secret_encrypted: string },
    );
    const text = await (
      await get(recordsRoute, RECORDS_URL, { record_type: 'nutrition', ...WINDOW })
    ).text();

    expect(text).not.toContain('hmac');
    expect(text).not.toContain('deadbeefdigest');
    expect(text).not.toContain('token_hash');
    expect(text).not.toContain(secret);
  });

  it('paginates with a stable cursor and no repeats or gaps', async () => {
    seedMacroFactor();
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 10; page += 1) {
      const body = await json(
        await get(recordsRoute, RECORDS_URL, {
          record_type: 'nutrition',
          ...WINDOW,
          limit: '5',
          cursor,
        }),
      );
      const records = body.records as Record<string, unknown>[];
      expect(records.length).toBeLessThanOrEqual(5);
      seen.push(...records.map((r) => String(r.source_uuid)));
      cursor = (body.next_cursor as string | null) ?? undefined;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(16);
    expect(new Set(seen).size).toBe(16);
  });

  it('caps the page size at the documented maximum', async () => {
    seedMacroFactor();
    const body = await json(
      await get(recordsRoute, RECORDS_URL, {
        record_type: 'nutrition',
        ...WINDOW,
        limit: '10000',
      }),
    );
    expect(body.max_page_size).toBe(200);
    expect((body.records as unknown[]).length).toBe(16);
    expect(body.next_cursor).toBeNull();
  });

  it('rejects a malformed cursor rather than ignoring it', async () => {
    seedMacroFactor();
    const res = await get(recordsRoute, RECORDS_URL, {
      record_type: 'nutrition',
      ...WINDOW,
      cursor: 'not-a-cursor',
    });
    expect(res.status).toBe(400);
  });

  it('filters by exact source package', async () => {
    seedMacroFactor();
    seedRecord({
      sourcePackage: 'com.sbs.diet.free',
      uuid: 'lookalike-1',
      startAt: '2026-09-01T15:00:00Z',
    });

    const body = await json(
      await get(recordsRoute, RECORDS_URL, {
        record_type: 'nutrition',
        source_package: MACROFACTOR_PACKAGE,
        ...WINDOW,
      }),
    );
    const packages = new Set(
      (body.records as Record<string, unknown>[]).map((r) => r.source_package),
    );
    expect([...packages]).toEqual([MACROFACTOR_PACKAGE]);
  });

  it('honours the date range boundaries inclusively', async () => {
    seedRecord({ uuid: 'a', startAt: '2026-09-01T00:00:00Z' });
    seedRecord({ uuid: 'b', startAt: '2026-09-02T00:00:00Z' });
    seedRecord({ uuid: 'c', startAt: '2026-09-03T00:00:00Z' });

    const body = await json(
      await get(recordsRoute, RECORDS_URL, {
        record_type: 'nutrition',
        start_at: '2026-09-01T00:00:00Z',
        end_at: '2026-09-02T00:00:00Z',
      }),
    );
    expect((body.records as Record<string, unknown>[]).map((r) => r.source_uuid)).toEqual([
      'a',
      'b',
    ]);
  });

  it('never returns another user’s records', async () => {
    seedMacroFactor(VIEWER);
    seedRecord({ uuid: 'mine', startAt: '2026-09-01T15:00:00Z' });

    const body = await json(
      await get(recordsRoute, RECORDS_URL, { record_type: 'nutrition', ...WINDOW }),
    );
    const records = body.records as Record<string, unknown>[];
    expect(records).toHaveLength(1);
    expect(records[0].source_uuid).toBe('mine');
  });

  it('cannot reach another user’s records through an integration id', async () => {
    // Seed VIEWER's records under their own integration id.
    const viewerIntegration = crypto.randomUUID();
    ctx.sqlite
      .prepare(
        `insert into health_connect_integrations
          (id, user_id, name, status, hmac_secret_encrypted, allowed_sources_json,
           enabled_types_json, nutrition_strategy, created_at, updated_at)
         values (?, ?, 'Their phone', 'active', 'x:y:z', '{}', '[]', 'sum_items', ?, ?)`,
      )
      .run(viewerIntegration, VIEWER, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
    seedRecord({
      userId: VIEWER,
      integrationId: viewerIntegration,
      uuid: 'theirs',
      startAt: '2026-09-01T15:00:00Z',
    });

    const body = await json(
      await get(recordsRoute, RECORDS_URL, {
        integration_id: viewerIntegration,
        ...WINDOW,
      }),
    );
    expect(body.records).toEqual([]);
  });
});
