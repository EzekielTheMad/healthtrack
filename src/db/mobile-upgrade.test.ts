// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { insertUser, OWNER } from '@/lib/repos/repo-test-harness';

let folder: string;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.DATA_DIR;
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-android-upgrade-'));
  process.env.DATA_DIR = folder;
  vi.resetModules();
});
afterEach(() => {
  if (saved === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = saved;
  // Test-owned disposable directory. Never touches a configured installation.
  if (path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    try {
      fs.rmSync(folder, { recursive: true, force: true });
    } catch {
      /* Windows WAL handles */
    }
  }
});

it('upgrades an rc3 schema without rewriting clinical dates and restores its compatible snapshot', async () => {
  const migrations = path.join(process.cwd(), 'drizzle');
  const staged = path.join(folder, 'rc3-migrations');
  fs.mkdirSync(path.join(staged, 'meta'), { recursive: true });
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8')
  );
  const entries = journal.entries.filter((e: { idx: number }) => e.idx <= 12) as { tag: string }[];
  fs.writeFileSync(
    path.join(staged, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries })
  );
  for (const entry of entries)
    fs.copyFileSync(
      path.join(migrations, `${entry.tag}.sql`),
      path.join(staged, `${entry.tag}.sql`),
      fs.constants.COPYFILE_EXCL
    );
  const { runMigrations } = await import('./migrate');
  const { getSqlite } = await import('./index');
  runMigrations(staged);
  const sql = getSqlite();
  insertUser(sql, OWNER);
  sql
    .prepare(
      "INSERT INTO medications(id,user_id,name,start_date,active,created_at,updated_at) VALUES ('med',?,'Synthetic medicine','2020-01-02',1,'2020-01-01','2020-01-01')"
    )
    .run(OWNER);
  sql
    .prepare(
      "INSERT INTO vitals(id,user_id,metric_key,value,source,recorded_at,created_at) VALUES ('vital',?,'steps',5000,'health_connect_daily','2026-10-24T00:00:00Z','2026-10-24')"
    )
    .run(OWNER);
  const backup = path.join(folder, 'rc3-compatible-backup.db');
  await sql.backup(backup);
  runMigrations(migrations);
  expect(sql.prepare('SELECT start_date FROM medications WHERE id=?').get('med')).toEqual({
    start_date: '2020-01-02',
  });
  expect(
    sql
      .prepare('SELECT value,native_record_id,last_received_at FROM vitals WHERE id=?')
      .get('vital')
  ).toEqual({ value: 5000, native_record_id: null, last_received_at: null });
  expect(sql.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({ n: 15 });
  const restoredPath = path.join(folder, 'restored-rc3.db');
  fs.copyFileSync(backup, restoredPath, fs.constants.COPYFILE_EXCL);
  const restored = new Database(restoredPath, { readonly: true });
  try {
    expect(restored.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual({
      n: 13,
    });
    expect(restored.prepare('SELECT start_date FROM medications WHERE id=?').get('med')).toEqual({
      start_date: '2020-01-02',
    });
    expect(
      restored.prepare("SELECT name FROM sqlite_master WHERE name='mobile_devices'").get()
    ).toBeUndefined();
  } finally {
    restored.close();
  }
});
