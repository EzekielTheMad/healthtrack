// @vitest-environment node
/**
 * Migration 0009 — renaming the nutrition strategy values.
 *
 * SQLite cannot ALTER a column default, so the table has to be recreated. The
 * trap this test exists for: `PRAGMA foreign_keys` is a NO-OP inside a
 * transaction, and the migrator runs every statement inside one BEGIN — so
 * `DROP TABLE health_connect_integrations` performs an implicit DELETE that
 * FIRES the children's ON DELETE SET NULL actions. The stock drizzle-kit
 * output would therefore have silently orphaned every retained raw record and
 * ingest run from its integration.
 *
 * So this asserts both halves: the values are remapped, AND the child links
 * survive.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DRIZZLE_DIR = path.join(process.cwd(), 'drizzle');
const T = '2026-09-01T00:00:00Z';

let tmpDir: string;
let savedDataDir: string | undefined;

beforeEach(() => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-mig-0009-'));
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // WAL handles on Windows may lag; the OS cleans the temp dir.
  }
});

/** Migrations up to and including `throughTag`, in a scratch folder. */
function migrationsThrough(throughTag: string): string {
  const journal = JSON.parse(
    fs.readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { idx: number; tag: string }[] };

  const cutoff = journal.entries.find((e) => e.tag === throughTag);
  if (!cutoff) throw new Error(`no migration tagged ${throughTag}`);
  const kept = journal.entries.filter((e) => e.idx <= cutoff.idx);

  const folder = path.join(tmpDir, `migrations-${throughTag}`);
  fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
  for (const entry of kept) {
    fs.copyFileSync(
      path.join(DRIZZLE_DIR, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    );
  }
  fs.writeFileSync(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries: kept }),
  );
  return folder;
}

async function loadMigrator() {
  const { runMigrations } = await import('./migrate');
  const { getSqlite } = await import('./index');
  return { runMigrations, getSqlite };
}

function seedLegacyState(sqlite: Database.Database) {
  const userId = 'owner-user-000000000000000000000';
  sqlite
    .prepare(
      `insert into user (id, name, email, emailVerified, role, createdAt, updatedAt)
       values (?, ?, 'owner@example.com', 0, 'user', ?, ?)`,
    )
    .run(userId, userId, Date.now(), Date.now());

  const integrationId = crypto.randomUUID();
  sqlite
    .prepare(
      `insert into health_connect_integrations
        (id, user_id, name, status, hmac_secret_encrypted, allowed_sources_json,
         enabled_types_json, nutrition_strategy, created_at, updated_at)
       values (?, ?, 'Phone', 'active', 'iv:ct:tag', '{"nutrition":["com.sbs.diet"]}',
               '["nutrition"]', 'aggregate', ?, ?)`,
    )
    .run(integrationId, userId, T, T);

  const rawId = crypto.randomUUID();
  sqlite
    .prepare(
      `insert into health_connect_raw_records
        (id, integration_id, user_id, record_type, source_package, source_uuid,
         identity_kind, recorded_start_at, payload_json, first_seen_at, last_seen_at)
       values (?, ?, ?, 'nutrition', 'com.sbs.diet', 'mf-1', 'uuid', ?, '{}', ?, ?)`,
    )
    .run(rawId, integrationId, userId, '2026-09-01T15:00:00.000Z', T, T);

  // A record deliberately orphaned earlier ("delete integration, keep raw
  // history"). It must STAY orphaned — the restore repairs only what the
  // migration itself broke.
  const orphanId = crypto.randomUUID();
  sqlite
    .prepare(
      `insert into health_connect_raw_records
        (id, integration_id, user_id, record_type, source_package, source_uuid,
         identity_kind, recorded_start_at, payload_json, first_seen_at, last_seen_at)
       values (?, null, ?, 'nutrition', 'com.sbs.diet', 'mf-orphan', 'uuid', ?, '{}', ?, ?)`,
    )
    .run(orphanId, userId, '2026-08-01T15:00:00.000Z', T, T);

  const runId = crypto.randomUUID();
  sqlite
    .prepare(
      `insert into health_connect_ingest_runs
        (id, integration_id, user_id, body_sha256, is_backfill, status,
         received_count, inserted_count, updated_count, duplicate_count,
         rejected_count, normalization_summary_json, received_at)
       values (?, ?, ?, 'abc123', 0, 'accepted', 1, 1, 0, 0, 0, '{}', ?)`,
    )
    .run(runId, integrationId, userId, T);

  return { userId, integrationId, rawId, orphanId, runId };
}

describe('0009 nutrition-strategy-rename', () => {
  it('remaps legacy values and preserves every child link', async () => {
    const { runMigrations, getSqlite } = await loadMigrator();

    // Bring the database up to the state that shipped BEFORE this change.
    runMigrations(migrationsThrough('0008_health-connect-ingestion'));
    const sqlite = getSqlite();
    sqlite.pragma('foreign_keys = ON');
    const seeded = seedLegacyState(sqlite);

    expect(
      (
        sqlite
          .prepare('select nutrition_strategy from health_connect_integrations')
          .get() as { nutrition_strategy: string }
      ).nutrition_strategy,
    ).toBe('aggregate');

    // Now apply 0009.
    runMigrations();

    const integration = sqlite
      .prepare('select * from health_connect_integrations')
      .get() as Record<string, string>;
    expect(integration.nutrition_strategy).toBe('sum_items');
    // Nothing else about the row moved.
    expect(integration.id).toBe(seeded.integrationId);
    expect(integration.status).toBe('active');
    expect(integration.hmac_secret_encrypted).toBe('iv:ct:tag');
    expect(JSON.parse(integration.allowed_sources_json)).toEqual({
      nutrition: ['com.sbs.diet'],
    });

    // The whole point: children still point at their integration.
    const raw = sqlite
      .prepare('select id, integration_id from health_connect_raw_records order by recorded_start_at')
      .all() as { id: string; integration_id: string | null }[];
    expect(raw).toHaveLength(2);
    expect(raw.find((r) => r.id === seeded.rawId)!.integration_id).toBe(seeded.integrationId);
    // …and the deliberately orphaned one is still orphaned.
    expect(raw.find((r) => r.id === seeded.orphanId)!.integration_id).toBeNull();

    const run = sqlite
      .prepare('select integration_id from health_connect_ingest_runs')
      .get() as { integration_id: string | null };
    expect(run.integration_id).toBe(seeded.integrationId);
  });

  it('maps daily_snapshot to latest_summary', async () => {
    const { runMigrations, getSqlite } = await loadMigrator();
    runMigrations(migrationsThrough('0008_health-connect-ingestion'));
    const sqlite = getSqlite();
    const seeded = seedLegacyState(sqlite);
    sqlite
      .prepare('update health_connect_integrations set nutrition_strategy = ? where id = ?')
      .run('daily_snapshot', seeded.integrationId);

    runMigrations();

    expect(
      (
        sqlite
          .prepare('select nutrition_strategy from health_connect_integrations')
          .get() as { nutrition_strategy: string }
      ).nutrition_strategy,
    ).toBe('latest_summary');
  });

  it('leaves the new column default and no scratch tables behind', async () => {
    const { runMigrations, getSqlite } = await loadMigrator();
    runMigrations();
    const sqlite = getSqlite();

    const ddl = (
      sqlite
        .prepare("select sql from sqlite_master where name = 'health_connect_integrations'")
        .get() as { sql: string }
    ).sql;
    expect(ddl).toContain("`nutrition_strategy` text DEFAULT 'sum_items' NOT NULL");

    // GLOB, not LIKE: '_' is a single-character wildcard in LIKE and would
    // match every table with two or more characters in its name.
    // __drizzle_migrations is the migrator's own bookkeeping table.
    const scratch = sqlite
      .prepare(
        "select name from sqlite_master where name glob '__*' and name != '__drizzle_migrations'",
      )
      .all() as { name: string }[];
    expect(scratch).toEqual([]);

    // The unique index survived the table swap.
    const indexes = sqlite
      .prepare("select name from sqlite_master where type = 'index' and tbl_name = 'health_connect_integrations'")
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('idx_health_connect_integrations_user');
  });

  it('is idempotent — a second run is a no-op', async () => {
    const { runMigrations, getSqlite } = await loadMigrator();
    runMigrations();
    const sqlite = getSqlite();
    const before = sqlite
      .prepare("select count(*) as n from sqlite_master where type = 'table'")
      .get() as { n: number };

    runMigrations();

    const after = sqlite
      .prepare("select count(*) as n from sqlite_master where type = 'table'")
      .get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
