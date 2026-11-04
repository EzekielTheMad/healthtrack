// @vitest-environment node
import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
it('adds HF storage without rewriting any legacy schema, values, IDs or uncertain dates', () => {
  const sqlite = new Database(':memory:');
  try {
    const folder = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx < 17))
      sqlite.exec(fs.readFileSync(path.join(folder, entry.tag + '.sql'), 'utf8'));
    sqlite
      .prepare(
        "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt)VALUES('owner','Fictional','fixture@example.test',0,1,1)"
      )
      .run();
    sqlite
      .prepare(
        "INSERT INTO medications(id,user_id,name,start_date,active,created_at,updated_at)VALUES('same-id','owner','Fictional supplement','approx 2020',0,'legacy','legacy')"
      )
      .run();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const before = Object.fromEntries(
      tables.map(({ name }) => [
        name,
        {
          columns: sqlite.prepare('PRAGMA table_xinfo("' + name + '")').all(),
          rows: sqlite.prepare('SELECT * FROM "' + name + '"').all(),
        },
      ])
    );
    sqlite.exec(fs.readFileSync(path.join(folder, '0017_fidelity_contracts.sql'), 'utf8'));
    for (const { name } of tables) {
      expect(sqlite.prepare('PRAGMA table_xinfo("' + name + '")').all()).toEqual(
        before[name].columns
      );
      expect(sqlite.prepare('SELECT * FROM "' + name + '"').all()).toEqual(before[name].rows);
    }
    for (const name of [
      'clinical_records',
      'clinical_intake_batches',
      'clinical_intake_items',
      'body_scans',
    ])
      expect(sqlite.prepare('SELECT count(*) n FROM ' + name).get()).toEqual({ n: 0 });
    expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    sqlite.close();
  }
});
