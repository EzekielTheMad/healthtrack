// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  prepareMigrationArtifacts,
  readMigrationByteManifest,
} from './prepare-migration-artifacts.mjs';

const manifest = readMigrationByteManifest();
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = new Set();
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const expectedLastHash = '011571d7a16921f802613dbb8954927876c20f18007351d3d31ab1b20fe1868e';

function fixture(representation = 'canonical') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-migration-bytes-'));
  roots.add(root);
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'meta'), { recursive: true });
  for (const pin of manifest.entries) {
    const canonical = Buffer.from(
      fs.readFileSync(path.join(repository, 'drizzle', pin.path), 'utf8').replace(/\r\n/g, '\n')
    );
    expect(hash(canonical)).toBe(pin.source_sha256);
    const raw = Buffer.from(canonical.toString('utf8').split('\n').join('\r\n'));
    expect(hash(raw)).toBe(pin.runtime_sha256);
    fs.writeFileSync(path.join(source, pin.path), representation === 'canonical' ? canonical : raw);
  }
  return { root, source, output: path.join(root, 'runtime') };
}

function expectRuntime(output) {
  for (const pin of manifest.entries)
    expect(hash(fs.readFileSync(path.join(output, pin.path)))).toBe(pin.runtime_sha256);
  expect(hash(fs.readFileSync(path.join(output, '0018_web_clinical_records.sql')))).toBe(
    expectedLastHash
  );
}

afterEach(() => {
  for (const root of roots) {
    const resolved = fs.realpathSync(root);
    expect(path.dirname(resolved)).toBe(fs.realpathSync(os.tmpdir()));
    expect(path.basename(resolved)).toMatch(/^healthtrack-migration-bytes-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  roots.clear();
});

describe('pinned runtime migration bytes', () => {
  it('materializes every known canonical input without editing source or binary assets', () => {
    const f = fixture();
    const before = manifest.entries.map((pin) =>
      hash(fs.readFileSync(path.join(f.source, pin.path)))
    );
    const binary = Buffer.from([0, 10, 255, 13, 10]);
    fs.writeFileSync(path.join(f.source, 'reference.bin'), binary);
    expect(prepareMigrationArtifacts(f.source, f.output).prepared).toBe(20);
    expectRuntime(f.output);
    expect(fs.readFileSync(path.join(f.output, 'reference.bin'))).toEqual(binary);
    expect(
      manifest.entries.map((pin) => hash(fs.readFileSync(path.join(f.source, pin.path))))
    ).toEqual(before);
  });

  it('accepts already-pinned raw inputs without another conversion', () => {
    const f = fixture('runtime');
    prepareMigrationArtifacts(f.source, f.output);
    expectRuntime(f.output);
    for (const pin of manifest.entries)
      expect(fs.readFileSync(path.join(f.output, pin.path))).toEqual(
        fs.readFileSync(path.join(f.source, pin.path))
      );
  });

  it('rejects changed SQL before creating any output', () => {
    const f = fixture();
    fs.appendFileSync(path.join(f.source, manifest.entries[0].path), '-- changed');
    expect(() => prepareMigrationArtifacts(f.source, f.output)).toThrow(
      /Unrecognized migration bytes/
    );
    expect(fs.existsSync(f.output)).toBe(false);
  });

  it('rejects a changed journal before creating output', () => {
    const f = fixture();
    fs.appendFileSync(path.join(f.source, 'meta/_journal.json'), '\n');
    expect(() => prepareMigrationArtifacts(f.source, f.output)).toThrow(
      /Unrecognized migration bytes/
    );
    expect(fs.existsSync(f.output)).toBe(false);
  });

  it('requires an explicit manifest entry for an added SQL file', () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.source, '0019_unreviewed.sql'), 'select 1;');
    expect(() => prepareMigrationArtifacts(f.source, f.output)).toThrow(/inventory/);
    expect(fs.existsSync(f.output)).toBe(false);
  });

  it('rejects manifest traversal paths', () => {
    const f = fixture();
    const invalid = structuredClone(manifest);
    invalid.entries[0].path = '../outside.sql';
    expect(() => prepareMigrationArtifacts(f.source, f.output, invalid)).toThrow(
      /Invalid migration byte entry/
    );
    expect(fs.existsSync(f.output)).toBe(false);
  });

  it('rejects overlapping output paths without changing source', () => {
    const f = fixture();
    expect(() => prepareMigrationArtifacts(f.source, f.source)).toThrow(/separate/);
    expect(() => prepareMigrationArtifacts(f.source, path.join(f.source, 'nested'))).toThrow(
      /separate/
    );
    expect(fs.existsSync(path.join(f.source, 'nested'))).toBe(false);
  });

  it('does not overwrite an existing output directory', () => {
    const f = fixture();
    fs.mkdirSync(f.output);
    fs.writeFileSync(path.join(f.output, 'keep.txt'), 'untouched');
    expect(() => prepareMigrationArtifacts(f.source, f.output)).toThrow(/already exists/);
    expect(fs.readFileSync(path.join(f.output, 'keep.txt'), 'utf8')).toBe('untouched');
  });

  it('checks the declared output digest before writing files', () => {
    const f = fixture();
    const invalid = structuredClone(manifest);
    invalid.entries[0].runtime_sha256 = '0'.repeat(64);
    expect(() => prepareMigrationArtifacts(f.source, f.output, invalid)).toThrow(
      /checksum mismatch/
    );
    expect(fs.existsSync(f.output)).toBe(false);
  });

  it('creates and preserves the exact synthetic ledger through repeated migrations', () => {
    const f = fixture();
    prepareMigrationArtifacts(f.source, f.output);
    const databaseFile = path.join(f.root, 'ledger.sqlite');
    let sqlite = new Database(databaseFile);
    try {
      sqlite.pragma('foreign_keys = ON');
      sqlite.pragma('journal_mode = WAL');
      migrate(drizzle(sqlite), { migrationsFolder: f.output });
      const before = sqlite
        .prepare('select id, hash, created_at from __drizzle_migrations order by id')
        .all();
      expect(before).toHaveLength(19);
      expect(before.at(-1).hash).toBe(expectedLastHash);
      sqlite.close();
      sqlite = new Database(databaseFile);
      sqlite.pragma('foreign_keys = ON');
      sqlite.pragma('journal_mode = WAL');
      migrate(drizzle(sqlite), { migrationsFolder: f.output });
      expect(
        sqlite.prepare('select id, hash, created_at from __drizzle_migrations order by id').all()
      ).toEqual(before);
      expect(sqlite.prepare('select count(*) as n from user').get().n).toBe(0);
      expect(sqlite.prepare('select count(*) as n from api_keys').get().n).toBe(0);
      expect(sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      if (sqlite.open) sqlite.close();
    }
  });
});
