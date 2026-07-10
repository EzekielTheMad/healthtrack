// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;
let savedDataDir: string | undefined;

async function loadDb() {
  vi.resetModules();
  const [{ runMigrations }, { getSqlite, getDb }, { seedReferenceRanges, REFERENCE_RANGE_SEED }] =
    await Promise.all([import('./migrate'), import('./index'), import('./seed-reference-ranges')]);
  return { runMigrations, sqlite: getSqlite(), db: getDb(), seedReferenceRanges, REFERENCE_RANGE_SEED };
}

/**
 * Copy only migration 0000 (sql + journal entry) into a temp folder so tests
 * can simulate a database created by an older build, then upgrade it with the
 * full migrations folder.
 */
function stagePartialMigrations(): string {
  const src = path.join(process.cwd(), 'drizzle');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-mig-'));
  fs.mkdirSync(path.join(dest, 'meta'));
  const journal = JSON.parse(
    fs.readFileSync(path.join(src, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const first = journal.entries.find((e) => e.idx === 0)!;
  fs.copyFileSync(path.join(src, `${first.tag}.sql`), path.join(dest, `${first.tag}.sql`));
  fs.writeFileSync(
    path.join(dest, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: [first] }),
  );
  return dest;
}

const EXPECTED_TABLES = [
  'user',
  'profiles',
  'dependents',
  'dashboard_stat_preferences',
  'providers',
  'medications',
  'conditions',
  'allergies',
  'procedures',
  'vaccines',
  'lab_visits',
  'lab_results',
  'appointments',
  'notes',
  'vitals',
  'vital_source_preferences',
  'vital_reference_ranges',
  'health_shares',
  'delegates',
  'connected_sources',
  'query_history',
  'interaction_alerts',
  'api_keys',
  'breach_events',
  'breach_notifications',
];

beforeEach(() => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-db-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // WAL handles on Windows may lag; temp dir is cleaned by the OS
  }
});

describe('runMigrations', () => {
  it('creates every table from the translated schema', async () => {
    const { runMigrations, sqlite } = await loadDb();
    runMigrations();
    const rows = sqlite
      .prepare("select name from sqlite_master where type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const table of EXPECTED_TABLES) {
      expect(names, `missing table ${table}`).toContain(table);
    }
  });

  it('applies WAL journal mode and enforces foreign keys', async () => {
    const { runMigrations, sqlite } = await loadDb();
    runMigrations();
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    // FK enforcement is real: inserting a profile for a missing user throws
    expect(() =>
      sqlite
        .prepare(
          "insert into profiles (id, created_at, updated_at) values ('nope', 'x', 'x')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('seeds every vital_reference_ranges row on a fresh database', async () => {
    const { runMigrations, sqlite, REFERENCE_RANGE_SEED } = await loadDb();
    runMigrations();
    const { n } = sqlite
      .prepare('select count(*) as n from vital_reference_ranges')
      .get() as { n: number };
    expect(n).toBe(REFERENCE_RANGE_SEED.length);
    const systolic = sqlite
      .prepare(
        "select label, range_low, range_high from vital_reference_ranges where metric_key='bp_systolic' order by range_low",
      )
      .all() as { label: string; range_low: number | null; range_high: number | null }[];
    expect(systolic).toHaveLength(5);
    expect(systolic.map((r) => r.label)).toContain('Hypertensive Crisis');
    // Device-metric ranges landed with the registry
    const glucose = sqlite
      .prepare("select label from vital_reference_ranges where metric_key='blood_glucose'")
      .all() as { label: string }[];
    expect(glucose.map((r) => r.label)).toContain('Normal (fasting)');
  });

  it('every seeded metric_key exists in the metric registry', async () => {
    const { REFERENCE_RANGE_SEED } = await loadDb();
    const { getMetric } = await import('@/lib/metrics/registry');
    for (const r of REFERENCE_RANGE_SEED) {
      expect(getMetric(r.metricKey), `seed key ${r.metricKey} missing from registry`).toBeDefined();
    }
  });

  it('is idempotent — running twice neither throws nor duplicates seed rows', async () => {
    const { runMigrations, sqlite, REFERENCE_RANGE_SEED } = await loadDb();
    runMigrations();
    runMigrations();
    const { n } = sqlite
      .prepare('select count(*) as n from vital_reference_ranges')
      .get() as { n: number };
    expect(n).toBe(REFERENCE_RANGE_SEED.length);
  });

  it('per-metric guard: a pre-seeded database gains only rows for missing metrics', async () => {
    const { runMigrations, sqlite, db, seedReferenceRanges, REFERENCE_RANGE_SEED } = await loadDb();
    runMigrations();
    const newMetrics = ['blood_glucose', 'cpap_usage', 'mask_leak', 'vo2_max', 'peak_flow'];
    // Simulate a database seeded by an older build that predates the new ranges
    sqlite
      .prepare(
        `delete from vital_reference_ranges where metric_key in (${newMetrics.map(() => '?').join(',')})`,
      )
      .run(...newMetrics);
    // Old metrics keep their rows; drop one resting_hr row to prove no re-insert happens
    sqlite.prepare("delete from vital_reference_ranges where metric_key='resting_hr' and label='Athlete normal'").run();

    seedReferenceRanges(db);

    const counts = Object.fromEntries(
      (
        sqlite
          .prepare('select metric_key as k, count(*) as n from vital_reference_ranges group by metric_key')
          .all() as { k: string; n: number }[]
      ).map((r) => [r.k, r.n]),
    );
    for (const key of newMetrics) {
      const expected = REFERENCE_RANGE_SEED.filter((r) => r.metricKey === key).length;
      expect(counts[key], `rows for ${key}`).toBe(expected);
    }
    // resting_hr was NOT topped back up (guard is per metric, not per row)
    expect(counts['resting_hr']).toBe(
      REFERENCE_RANGE_SEED.filter((r) => r.metricKey === 'resting_hr').length - 1,
    );
  });

  it('migration 0002 dedups legacy vitals rows and enforces the upsert tuple', async () => {
    const partial = stagePartialMigrations();
    try {
      const { runMigrations, sqlite } = await loadDb();
      // Old build: only migration 0000 applied — no unique index yet.
      runMigrations(partial);
      const now = new Date().toISOString();
      const day = '2026-07-10T00:00:00Z';
      sqlite
        .prepare(
          "insert into user (id, name, email, emailVerified, createdAt, updatedAt) values ('u1', 'Test', 't@example.com', 1, 0, 0)",
        )
        .run();
      const insertVital = sqlite.prepare(
        "insert into vitals (id, user_id, metric_key, value, source, recorded_at, created_at) values (?, 'u1', ?, ?, ?, ?, ?)",
      );
      // Duplicate tuple with NULL dependent_id — exactly what the app-level
      // upsert should have collapsed, slipped in by an older build.
      insertVital.run('v1', 'weight', 210, 'manual', day, now);
      insertVital.run('v2', 'weight', 212, 'manual', day, now);
      // Same metric/day from a different source — a distinct tuple, kept.
      insertVital.run('v3', 'weight', 211, 'withings', day, now);

      // Upgrade: full migrations folder applies 0002 (dedup + unique index).
      runMigrations();

      const weights = sqlite
        .prepare("select id, value from vitals where metric_key='weight' order by id")
        .all() as { id: string; value: number }[];
      // The most recently inserted duplicate survives (upsert semantics).
      expect(weights).toEqual([
        { id: 'v2', value: 212 },
        { id: 'v3', value: 211 },
      ]);

      // The tuple is now constrained even with dependent_id NULL (the index
      // coalesces NULL to '' — plain unique columns would treat NULLs as
      // distinct and never fire).
      expect(() => insertVital.run('v4', 'weight', 215, 'manual', day, now)).toThrow(
        /UNIQUE/i,
      );
    } finally {
      fs.rmSync(partial, { recursive: true, force: true });
    }
  });

  it('migration 0001 renames legacy hrv rows to hrv_rmssd on upgrade', async () => {
    const partial = stagePartialMigrations();
    try {
      const { runMigrations, sqlite } = await loadDb();
      // Old build: only migration 0000 applied
      runMigrations(partial);
      const now = new Date().toISOString();
      sqlite
        .prepare(
          "insert into user (id, name, email, emailVerified, createdAt, updatedAt) values ('u1', 'Test', 't@example.com', 1, 0, 0)",
        )
        .run();
      const insertVital = sqlite.prepare(
        "insert into vitals (id, user_id, metric_key, value, source, recorded_at, created_at) values (?, 'u1', ?, ?, 'oura', ?, ?)",
      );
      insertVital.run('v1', 'hrv', 42, now, now);
      insertVital.run('v2', 'resting_hr', 55, now, now);

      // Upgrade: full migrations folder applies 0001
      runMigrations();

      const hrvOld = sqlite
        .prepare("select count(*) as n from vitals where metric_key='hrv'")
        .get() as { n: number };
      expect(hrvOld.n).toBe(0);
      const renamed = sqlite
        .prepare("select value from vitals where metric_key='hrv_rmssd'")
        .all() as { value: number }[];
      expect(renamed).toHaveLength(1);
      expect(renamed[0].value).toBe(42);
      // Unrelated rows untouched
      const rhr = sqlite
        .prepare("select count(*) as n from vitals where metric_key='resting_hr'")
        .get() as { n: number };
      expect(rhr.n).toBe(1);
    } finally {
      fs.rmSync(partial, { recursive: true, force: true });
    }
  });
});
