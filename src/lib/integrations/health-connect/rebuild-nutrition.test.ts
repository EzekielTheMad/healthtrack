// @vitest-environment node
/**
 * rebuildNutritionDays — the canonical nutrition rebuild, against a real
 * SQLite database.
 *
 * The regression this file exists for: retained raw records that never became
 * canonical rows because approval, the strategy and the canonical-write toggle
 * only ever affected the NEXT webhook delivery. The 16-record MacroFactor
 * fixture must produce both expected daily rows from RETAINED state alone.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import {
  MACROFACTOR_ITEMS,
  EXPECTED_DAILY_TOTALS,
} from './fixtures/macrofactor';
import { MACROFACTOR_PACKAGE } from './fixtures/payloads';

type Rebuild = typeof import('./rebuild-nutrition');
type Repo = typeof import('@/lib/repos/health-connect');
type Db = typeof import('@/db');

let ctx: RepoTestDb;
let rebuild: Rebuild;
let repo: Repo;
let dbMod: Db;
let integrationId: string;

/** Health Connect hands the relay IEEE-754 doubles; compare accordingly. */
const TOLERANCE = 1e-6;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-hc-rebuild-');
  [rebuild, repo, dbMod] = await Promise.all([
    import('./rebuild-nutrition'),
    import('@/lib/repos/health-connect'),
    import('@/db'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  integrationId = (await repo.createIntegration(OWNER, { name: 'Phone' })).integration.id;
});

afterEach(() => ctx.restore());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a retained raw nutrition record exactly as ingestion would. */
function seedRecord(
  payload: Record<string, unknown>,
  opts: { userId?: string; sourcePackage?: string; uuid?: string; integrationId?: string } = {},
) {
  const start = String(payload.start_time);
  ctx.sqlite
    .prepare(
      `insert into health_connect_raw_records
        (id, integration_id, user_id, record_type, source_package, source_uuid,
         identity_kind, recorded_start_at, recorded_end_at, source_last_modified_at,
         payload_json, first_seen_at, last_seen_at, last_ingest_id)
       values (?, ?, ?, 'nutrition', ?, ?, 'uuid', ?, ?, null, ?, ?, ?, 'ingest-1')`,
    )
    .run(
      crypto.randomUUID(),
      opts.integrationId ?? integrationId,
      opts.userId ?? OWNER,
      opts.sourcePackage ?? MACROFACTOR_PACKAGE,
      opts.uuid ?? String(payload.uuid ?? crypto.randomUUID()),
      new Date(start).toISOString(),
      payload.end_time ? new Date(String(payload.end_time)).toISOString() : null,
      JSON.stringify(payload),
      new Date().toISOString(),
      new Date().toISOString(),
    );
}

function seedMacroFactor(userId = OWNER) {
  for (const item of MACROFACTOR_ITEMS) {
    seedRecord(item as unknown as Record<string, unknown>, { userId });
  }
}

function canonicalRows(userId = OWNER) {
  return ctx.sqlite
    .prepare('select * from nutrition_daily where user_id = ? order by date, source_package')
    .all(userId) as Record<string, number | string | null>[];
}

function run(input: Partial<Parameters<Rebuild['rebuildNutritionDays']>[1]> = {}) {
  return rebuild.rebuildNutritionDays(dbMod.db, {
    userId: OWNER,
    integrationId,
    allowedPackages: [MACROFACTOR_PACKAGE],
    strategy: 'sum_items',
    ...input,
  });
}

/** Approve MacroFactor and enable canonical nutrition writes (which, by
    design, also rebuilds whatever those approvals newly authorised). */
async function approve(extra: Record<string, unknown> = {}) {
  return rebuild.updateIntegrationSettings(OWNER, integrationId, {
    allowedSources: { nutrition: [MACROFACTOR_PACKAGE] },
    enabledTypes: ['nutrition'],
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// The captured fixture
// ---------------------------------------------------------------------------

describe('the 16-record MacroFactor fixture', () => {
  it('produces both expected daily rows under sum_items', () => {
    seedMacroFactor();
    const report = run();

    expect(report.datesRebuilt).toEqual(['2026-08-31', '2026-09-01']);
    expect(report.rowsUpserted).toBe(2);
    expect(report.recordsConsidered).toBe(16);
    expect(report.recordsSkipped).toBe(0);
    expect(report.errors).toEqual([]);

    const rows = canonicalRows();
    expect(rows).toHaveLength(2);
    for (const [i, expected] of EXPECTED_DAILY_TOTALS.entries()) {
      const row = rows[i];
      expect(row.date).toBe(expected.date);
      expect(row.source_package).toBe(MACROFACTOR_PACKAGE);
      expect(row.record_count).toBe(expected.recordCount);
      expect(row.calories as number).toBeCloseTo(expected.calories, 6);
      expect(row.protein_grams as number).toBeCloseTo(expected.proteinGrams, 6);
      expect(row.carbs_grams as number).toBeCloseTo(expected.carbsGrams, 6);
      expect(row.fat_grams as number).toBeCloseTo(expected.fatGrams, 6);
    }
  });

  it('is idempotent — reprocessing twice cannot inflate a day', () => {
    seedMacroFactor();
    run();
    const first = canonicalRows();
    run();
    run();
    const third = canonicalRows();

    expect(third).toHaveLength(2);
    for (const [i, row] of third.entries()) {
      expect(row.calories as number).toBeCloseTo(first[i].calories as number, 9);
      expect(row.protein_grams as number).toBeCloseTo(first[i].protein_grams as number, 9);
      expect(row.record_count).toBe(first[i].record_count);
    }
    // The stored total is the day's records, never a running sum of batches.
    expect(third[0].calories as number).toBeCloseTo(EXPECTED_DAILY_TOTALS[0].calories, 6);
  });

  it('keeps full precision in the store — rounding is a display concern', () => {
    seedMacroFactor();
    run();
    const stored = canonicalRows()[0].calories as number;
    expect(Math.abs(stored - EXPECTED_DAILY_TOTALS[0].calories)).toBeLessThan(TOLERANCE);
    // Not rounded to a whole kcal or a tenth on the way in.
    expect(stored).not.toBe(Math.round(stored));
  });
});

// ---------------------------------------------------------------------------
// Exact source matching
// ---------------------------------------------------------------------------

describe('source package matching', () => {
  it('is exact — a lookalike package never contributes', () => {
    seedMacroFactor();
    // Same days, deliberately similar package names.
    for (const pkg of ['com.sbs.diet.free', 'com.sbs.dietary', 'sbs.diet', 'com.sbs']) {
      seedRecord(
        { calories: 9999, start_time: '2026-08-31T15:00:00Z', uuid: `x-${pkg}` },
        { sourcePackage: pkg },
      );
    }
    run();

    const rows = canonicalRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].calories as number).toBeCloseTo(EXPECTED_DAILY_TOTALS[0].calories, 6);
    expect(rows[0].record_count).toBe(10);
  });

  it('writes one row per approved package, never a merged total', () => {
    seedMacroFactor();
    seedRecord(
      { calories: 300, protein_grams: 12, start_time: '2026-08-31T15:00:00Z', uuid: 'other-1' },
      { sourcePackage: 'com.other.tracker' },
    );
    run({ allowedPackages: [MACROFACTOR_PACKAGE, 'com.other.tracker'] });

    const aug31 = canonicalRows().filter((r) => r.date === '2026-08-31');
    // One row per package, ordered by package name (list order, not merged).
    expect(aug31.map((r) => r.source_package)).toEqual([
      'com.other.tracker',
      MACROFACTOR_PACKAGE,
    ]);
    expect(aug31[0].calories).toBe(300);
    expect(aug31[1].calories as number).toBeCloseTo(EXPECTED_DAILY_TOTALS[0].calories, 6);
  });

  it('does nothing when no package is approved', () => {
    seedMacroFactor();
    const report = run({ allowedPackages: [] });
    expect(report.rowsUpserted).toBe(0);
    expect(canonicalRows()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phoenix dates, null vs zero, strategies
// ---------------------------------------------------------------------------

describe('day assignment and nutrient semantics', () => {
  it('assigns records to America/Phoenix calendar dates, not UTC ones', () => {
    // 06:59Z on Sep 1 is 23:59 on Aug 31 in Phoenix (UTC-7, no DST).
    seedRecord({ calories: 100, start_time: '2026-09-01T06:59:00Z', uuid: 'late-night' });
    seedRecord({ calories: 200, start_time: '2026-09-01T07:00:00Z', uuid: 'next-morning' });
    run({ dates: ['2026-08-31', '2026-09-01'] });

    const rows = canonicalRows();
    expect(rows.map((r) => [r.date, r.calories])).toEqual([
      ['2026-08-31', 100],
      ['2026-09-01', 200],
    ]);
  });

  it('keeps an unreported nutrient null and a reported zero zero', () => {
    seedRecord({ calories: 0, protein_grams: 0, start_time: '2026-08-31T15:00:00Z', uuid: 'z' });
    run({ dates: ['2026-08-31'] });

    const row = canonicalRows()[0];
    expect(row.calories).toBe(0);
    expect(row.protein_grams).toBe(0);
    expect(row.carbs_grams).toBeNull();
    expect(row.fat_grams).toBeNull();
  });

  it('latest_summary uses only the newest record, never a mixed sum', () => {
    seedRecord({ calories: 520, start_time: '2026-08-31T14:00:00Z', uuid: 'item-1' });
    seedRecord({ calories: 740, start_time: '2026-08-31T19:00:00Z', uuid: 'item-2' });
    seedRecord({ calories: 1260, start_time: '2026-08-31T23:00:00Z', uuid: 'summary' });

    const report = run({ dates: ['2026-08-31'], strategy: 'latest_summary' });
    const row = canonicalRows()[0];
    expect(row.calories).toBe(1260);
    expect(row.record_count).toBe(1);
    // The two items were read and deliberately not counted.
    expect(report.recordsConsidered).toBe(3);
    expect(report.recordsSkipped).toBe(2);
  });

  it('drops a day whose records have all gone away rather than zeroing it', () => {
    seedRecord({ calories: 500, start_time: '2026-08-31T15:00:00Z', uuid: 'gone' });
    run({ dates: ['2026-08-31'] });
    expect(canonicalRows()).toHaveLength(1);

    ctx.sqlite.prepare('delete from health_connect_raw_records').run();
    const report = run({ dates: ['2026-08-31'] });
    expect(report.rowsDeleted).toBe(1);
    expect(canonicalRows()).toHaveLength(0);
  });

  it('counts a malformed retained record without discarding the valid ones', () => {
    seedRecord({ calories: 400, start_time: '2026-08-31T15:00:00Z', uuid: 'good-1' });
    seedRecord({ calories: 600, start_time: '2026-08-31T18:00:00Z', uuid: 'good-2' });
    // No start_time in the payload — not a valid nutrition record.
    seedRecord(
      { calories: 5000, uuid: 'bad', start_time: '2026-08-31T19:00:00Z' },
      { uuid: 'bad' },
    );
    ctx.sqlite
      .prepare("update health_connect_raw_records set payload_json = ? where source_uuid = 'bad'")
      .run(JSON.stringify({ calories: 5000 }));

    const report = run({ dates: ['2026-08-31'] });
    const row = canonicalRows()[0];
    expect(row.calories).toBe(1000);
    expect(row.record_count).toBe(2);
    expect(report.recordsSkipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Full reprocess of retained state
// ---------------------------------------------------------------------------

describe('reprocessRetainedNutrition', () => {
  it('normalizes retained records with no further webhook delivery', async () => {
    seedMacroFactor();
    await approve();
    // Whatever the approval already rebuilt, an explicit reprocess is safe.
    const report = rebuild.reprocessRetainedNutrition(OWNER, integrationId);

    expect(report.datesRebuilt).toEqual(['2026-08-31', '2026-09-01']);
    expect(report.recordsConsidered).toBe(16);
    expect(canonicalRows()).toHaveLength(2);
    expect(canonicalRows()[1].calories as number).toBeCloseTo(
      EXPECTED_DAILY_TOTALS[1].calories,
      6,
    );
  });

  it('discovers every retained date without being told which', async () => {
    seedRecord({ calories: 100, start_time: '2026-06-01T15:00:00Z', uuid: 'june' });
    seedRecord({ calories: 200, start_time: '2026-07-15T15:00:00Z', uuid: 'july' });
    seedMacroFactor();
    await approve();

    const report = rebuild.reprocessRetainedNutrition(OWNER, integrationId);
    expect(report.datesRebuilt).toEqual([
      '2026-06-01',
      '2026-07-15',
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('clears a canonical row whose raw records are gone', async () => {
    seedMacroFactor();
    await approve();
    expect(canonicalRows()).toHaveLength(2);

    ctx.sqlite
      .prepare("delete from health_connect_raw_records where recorded_start_at < '2026-09-01T07:00:00.000Z'")
      .run();
    const report = rebuild.reprocessRetainedNutrition(OWNER, integrationId);

    expect(report.rowsDeleted).toBe(1);
    expect(canonicalRows().map((r) => r.date)).toEqual(['2026-09-01']);
  });

  it('refuses when nutrition canonical writes are not authorised', () => {
    seedMacroFactor();
    const report = rebuild.reprocessRetainedNutrition(OWNER, integrationId);
    expect(report.rowsUpserted).toBe(0);
    expect(report.errors[0]).toMatch(/approve an exact source package/i);
    expect(canonicalRows()).toHaveLength(0);
  });

  it('runs while the integration is still in inventory once nutrition is enabled', async () => {
    seedMacroFactor();
    await approve();
    const integration = await repo.getIntegration(OWNER);
    expect(integration?.status).toBe('inventory');
    expect(canonicalRows()).toHaveLength(2);
  });

  it('404s for another user’s integration id', () => {
    seedMacroFactor();
    expect(() => rebuild.reprocessRetainedNutrition(VIEWER, integrationId)).toThrow();
  });

  it('never reads another user’s retained records', async () => {
    seedMacroFactor(VIEWER);
    await approve();
    const report = rebuild.reprocessRetainedNutrition(OWNER, integrationId);

    expect(report.recordsConsidered).toBe(0);
    expect(canonicalRows(OWNER)).toHaveLength(0);
    expect(canonicalRows(VIEWER)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Settings changes are retroactive
// ---------------------------------------------------------------------------

describe('settings changes rebuild what they newly authorise', () => {
  it('approving a package normalizes the records already retained', async () => {
    seedMacroFactor();
    expect(canonicalRows()).toHaveLength(0);

    const result = await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      allowedSources: { nutrition: [MACROFACTOR_PACKAGE] },
      enabledTypes: ['nutrition'],
    });

    expect(result.rebuild?.rowsUpserted).toBe(2);
    expect(canonicalRows()).toHaveLength(2);
  });

  it('enabling canonical writes after approval also rebuilds', async () => {
    seedMacroFactor();
    // Approve the package but leave the canonical write off.
    await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      allowedSources: { nutrition: [MACROFACTOR_PACKAGE] },
    });
    expect(canonicalRows()).toHaveLength(0);

    const result = await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      enabledTypes: ['nutrition'],
    });
    expect(result.rebuild?.rowsUpserted).toBe(2);
    expect(canonicalRows()).toHaveLength(2);
  });

  it('switching the strategy recomputes every retained day', async () => {
    seedRecord({ calories: 520, start_time: '2026-08-31T14:00:00Z', uuid: 'item-1' });
    seedRecord({ calories: 740, start_time: '2026-08-31T23:00:00Z', uuid: 'item-2' });
    await approve();
    expect(canonicalRows()[0].calories).toBe(1260);

    const result = await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      nutritionStrategy: 'latest_summary',
    });
    expect(result.rebuild).not.toBeNull();
    expect(canonicalRows()[0].calories).toBe(740);
    expect(canonicalRows()[0].record_count).toBe(1);
  });

  it('activating the integration normalizes what already landed', async () => {
    seedMacroFactor();
    // Approve + enable in one patch (which rebuilds), then delete the rows to
    // prove activation alone brings them back.
    await approve();
    ctx.sqlite.prepare('delete from nutrition_daily').run();

    const result = await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      status: 'active',
    });
    expect(result.rebuild?.rowsUpserted).toBe(2);
    expect(canonicalRows()).toHaveLength(2);
  });

  it('a rename triggers no rebuild at all', async () => {
    seedMacroFactor();
    await approve();
    const result = await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      name: 'Pixel 9',
    });
    expect(result.rebuild).toBeNull();
    expect(result.integration.name).toBe('Pixel 9');
  });

  it('removing an approval leaves the rows the user already accepted', async () => {
    seedMacroFactor();
    await approve();
    expect(canonicalRows()).toHaveLength(2);

    const result = await rebuild.updateIntegrationSettings(OWNER, integrationId, {
      enabledTypes: [],
      allowedSources: { nutrition: [] },
    });
    expect(result.rebuild).toBeNull();
    expect(canonicalRows()).toHaveLength(2);
  });
});
