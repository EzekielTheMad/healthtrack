// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;
let savedDataDir: string | undefined;

async function loadDb() {
  vi.resetModules();
  const [{ runMigrations }, { getSqlite }] = await Promise.all([
    import('./migrate'),
    import('./index'),
  ]);
  return { runMigrations, sqlite: getSqlite() };
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

  it('seeds vital_reference_ranges from 002 (51 rows)', async () => {
    const { runMigrations, sqlite } = await loadDb();
    runMigrations();
    const { n } = sqlite
      .prepare('select count(*) as n from vital_reference_ranges')
      .get() as { n: number };
    expect(n).toBe(51);
    const systolic = sqlite
      .prepare(
        "select label, range_low, range_high from vital_reference_ranges where metric_key='bp_systolic' order by range_low",
      )
      .all() as { label: string; range_low: number | null; range_high: number | null }[];
    expect(systolic).toHaveLength(5);
    expect(systolic.map((r) => r.label)).toContain('Hypertensive Crisis');
  });

  it('is idempotent — running twice neither throws nor duplicates seed rows', async () => {
    const { runMigrations, sqlite } = await loadDb();
    runMigrations();
    runMigrations();
    const { n } = sqlite
      .prepare('select count(*) as n from vital_reference_ranges')
      .get() as { n: number };
    expect(n).toBe(51);
  });
});
