// @vitest-environment node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
it('widens clinical kinds without changing old rowids, payload bytes, references or patient boundaries', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    const dir = path.join(process.cwd(), 'drizzle');
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx < 18))
      db.exec(fs.readFileSync(path.join(dir, entry.tag + '.sql'), 'utf8'));
    db.prepare(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt)VALUES('fixture','Fictional','wc@example.test',0,1,1)"
    ).run();
    const insert = db.prepare(
      'INSERT INTO clinical_records(rowid,id,user_id,kind,payload_json,revision,source_key,received_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?)'
    );
    insert.run(
      501,
      'one',
      'fixture',
      'lab',
      '{"kind":"lab","raw":"<5 µg; date uncertain"}',
      7,
      'source-one',
      'received',
      'updated'
    );
    insert.run(
      999,
      'two',
      'fixture',
      'medication',
      '{"kind":"medication","rxcui":"preserve"}',
      2,
      null,
      'received',
      'updated'
    );
    const prior = db.prepare('SELECT rowid,* FROM clinical_records ORDER BY rowid').all();
    db.exec(fs.readFileSync(path.join(dir, '0018_web_clinical_records.sql'), 'utf8'));
    expect(db.prepare('SELECT rowid,* FROM clinical_records ORDER BY rowid').all()).toEqual(prior);
    db.prepare(
      "INSERT INTO clinical_records(id,user_id,kind,payload_json,legacy_table,legacy_id,received_at,updated_at)VALUES('new','fixture','condition','{}','conditions','legacy-one','now','now')"
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO clinical_records(id,user_id,kind,payload_json,legacy_table,legacy_id,received_at,updated_at)VALUES('duplicate','fixture','condition','{}','conditions','legacy-one','now','now')"
        )
        .run()
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO clinical_records(id,user_id,kind,payload_json,received_at,updated_at)VALUES('invalid','fixture','unsupported','{}','now','now')"
        )
        .run()
    ).toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally {
    db.close();
  }
});
