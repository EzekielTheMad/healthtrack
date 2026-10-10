// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('boots from pre-0011 twice, preserves all legacy rows, and separates trusted writes from old writers', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-owner-ai-upgrade-'));
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-pre0011-migrations-'));
  dirs.push(data, staged);
  vi.stubEnv('DATA_DIR', data);
  vi.resetModules();
  fs.mkdirSync(path.join(staged, 'meta'));
  const source = path.join(process.cwd(), 'drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta/_journal.json'), 'utf8'));
  const prior = journal.entries.filter((entry: { idx: number }) => entry.idx < 11);
  expect(prior).toHaveLength(11);
  for (const entry of prior) {
    fs.copyFileSync(path.join(source, `${entry.tag}.sql`), path.join(staged, `${entry.tag}.sql`));
  }
  fs.writeFileSync(
    path.join(staged, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: prior })
  );

  // The production/local startup runner applies only the staged historical schema.
  const { runMigrations } = await import('./migrate');
  const { getSqlite } = await import('./index');
  runMigrations(staged);
  const sqlite = getSqlite();
  const tables = ['daily_summaries', 'query_history', 'ai_lab_warning_dismissals'] as const;
  for (const table of tables) {
    expect(sqlite.prepare(`PRAGMA table_info(${table})`).all()).not.toContainEqual(
      expect.objectContaining({ name: 'context_version' })
    );
  }
  sqlite.exec(`
    insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Synthetic Owner', 'owner@example.test', 0, 0, 0),
             ('other', 'Synthetic Other', 'other@example.test', 0, 0, 0);
    insert into dependents (id, parent_user_id, name, date_of_birth, relationship, created_at, updated_at)
      values ('dep-one', 'owner', 'Synthetic One', '2015-01-01', 'child', '2026-10-10', '2026-10-10'),
             ('dep-two', 'owner', 'Synthetic Two', '2016-01-01', 'child', '2026-10-10', '2026-10-10');
    insert into daily_summaries (id, user_id, summary_date, summary_json, generated_at, model)
      values ('legacy-summary', 'owner', '2026-10-10', '{"summary":"Synthetic pooled legacy summary","highlights":[]}', '2026-10-10T01:00:00Z', 'legacy-model'),
             ('other-summary', 'other', '2026-10-10', '{"summary":"Other legacy summary","highlights":[]}', '2026-10-10T02:00:00Z', 'legacy-model');
    insert into query_history (id, user_id, dependent_id, query_text, response_text, created_at)
      values ('legacy-owner', 'owner', null, 'Synthetic owner Q', 'Synthetic pooled A', '2026-10-10T01:00:00Z'),
             ('legacy-one', 'owner', 'dep-one', 'Synthetic one Q', 'Synthetic one A', '2026-10-10T02:00:00Z'),
             ('legacy-two', 'owner', 'dep-two', 'Synthetic two Q', 'Synthetic two A', '2026-10-10T03:00:00Z'),
             ('legacy-other', 'other', null, 'Synthetic other Q', 'Synthetic other A', '2026-10-10T04:00:00Z');
    insert into ai_lab_warning_dismissals (id, user_id, warning_key, lab_visit_date, created_at, updated_at)
      values ('legacy-dismissal', 'owner', 'ldl', '2099-01-01', '2026-10-10T01:00:00Z', '2026-10-10T01:00:00Z'),
             ('other-dismissal', 'other', 'ldl', '2099-01-02', '2026-10-10T02:00:00Z', '2026-10-10T02:00:00Z');
    insert into lab_visits (id, user_id, dependent_id, visit_date, created_at)
      values ('owner-lab', 'owner', null, '2026-10-09', '2026-10-09'),
             ('dep-lab', 'owner', 'dep-one', '2099-01-01', '2026-10-10');
  `);
  const before = Object.fromEntries(
    tables.map((table) => [table, sqlite.prepare(`select * from ${table} order by id`).all()])
  ) as Record<(typeof tables)[number], Record<string, unknown>[]>;

  // Exercise the actual startup migration code twice, not just direct ALTER SQL.
  runMigrations();
  runMigrations();
  for (const table of tables) {
    expect(sqlite.prepare(`select * from ${table} order by id`).all()).toEqual(
      before[table].map((row) => ({ ...row, context_version: 0 }))
    );
    expect(sqlite.prepare(`PRAGMA table_info(${table})`).all()).toContainEqual(
      expect.objectContaining({
        name: 'context_version',
        type: 'INTEGER',
        notnull: 1,
        dflt_value: '0',
      })
    );
  }
  const summaries = await import('@/lib/repos/daily-summaries');
  const history = await import('@/lib/repos/query-history');
  const dismissals = await import('@/lib/repos/lab-warning-dismissals');
  const { OWNER_AI_CONTEXT_VERSION } = await import('@/lib/claude/owner-context');
  expect(await summaries.getCachedSummary('owner', '2026-10-10')).toBeNull();
  expect(await summaries.getLatestCachedSummary('owner')).toBeNull();
  expect(await history.listQueryHistory('owner')).toEqual([]);
  expect(await dismissals.listLabWarningDismissals('owner')).toEqual([]);
  expect(await dismissals.latestLabVisitDate('owner')).toBe('2026-10-09');

  const freshSummary = { summary: 'Synthetic exact owner summary', highlights: [] };
  await summaries.upsertCachedSummary('owner', '2026-10-10', freshSummary, 'current-model');
  await history.createQueryHistoryEntry('owner', { queryText: 'Owner Q', responseText: 'Owner A' });
  await dismissals.dismissLabWarnings('owner', ['LDL']);
  for (const table of tables) {
    expect(
      sqlite.prepare(`select * from ${table} where context_version = 0 order by id`).all()
    ).toEqual(before[table].map((row) => ({ ...row, context_version: 0 })));
    expect(
      sqlite
        .prepare(`select count(*) as n from ${table} where context_version = ?`)
        .get(OWNER_AI_CONTEXT_VERSION)
    ).toEqual({ n: 1 });
  }
  expect(await summaries.getCachedSummary('owner', '2026-10-10')).toMatchObject({
    contextVersion: OWNER_AI_CONTEXT_VERSION,
    summaryJson: JSON.stringify(freshSummary),
  });
  expect(await dismissals.listLabWarningDismissals('owner')).toEqual([
    expect.objectContaining({
      contextVersion: OWNER_AI_CONTEXT_VERSION,
      labVisitDate: '2026-10-09',
    }),
  ]);

  // An old process's exact two-column conflict target must fail closed. Without
  // version-inclusive keys, that process could replace trusted data while
  // leaving its context_version=1 marker intact.
  const savedCurrent = Object.fromEntries(
    tables.map((table) => [table, sqlite.prepare(`select * from ${table} order by id`).all()])
  );
  expect(() =>
    sqlite
      .prepare(
        `
    insert into daily_summaries (id, user_id, summary_date, summary_json, generated_at, model)
      values ('old-writer-summary', 'owner', '2026-10-10', '{}', '2099-01-01', 'old-model')
    on conflict (user_id, summary_date) do update set
      summary_json = excluded.summary_json, generated_at = excluded.generated_at, model = excluded.model
  `
      )
      .run()
  ).toThrow(/ON CONFLICT clause does not match/);
  expect(() =>
    sqlite
      .prepare(
        `
    insert into ai_lab_warning_dismissals (id, user_id, warning_key, lab_visit_date, created_at, updated_at)
      values ('old-writer-dismissal', 'owner', 'ldl', '2099-01-01', '2099-01-01', '2099-01-01')
    on conflict (user_id, warning_key) do update set
      lab_visit_date = excluded.lab_visit_date, updated_at = '2099-01-01'
  `
      )
      .run()
  ).toThrow(/ON CONFLICT clause does not match/);
  for (const table of tables) {
    expect(sqlite.prepare(`select * from ${table} order by id`).all()).toEqual(savedCurrent[table]);
  }

  // Plain old inserts have no trusted version and remain hidden after upgrade.
  sqlite.exec(`insert into query_history (id, user_id, query_text, response_text, created_at)
    values ('old-writer-history', 'owner', 'Old writer Q', 'Pooled writer A', '2099-01-01')`);
  expect(
    sqlite
      .prepare('select context_version from query_history where id = ?')
      .get('old-writer-history')
  ).toEqual({ context_version: 0 });
  expect(await history.listQueryHistory('owner')).toEqual([
    expect.objectContaining({ responseText: 'Owner A', contextVersion: OWNER_AI_CONTEXT_VERSION }),
  ]);
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
