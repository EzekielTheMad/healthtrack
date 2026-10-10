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
it('upgrades old interaction rows non-destructively and leaves them untrusted until a new exact-profile check', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-context-upgrade-'));
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-old-migrations-'));
  dirs.push(data, staged);
  vi.stubEnv('DATA_DIR', data);
  vi.resetModules();
  fs.mkdirSync(path.join(staged, 'meta'));
  const src = path.join(process.cwd(), 'drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(src, 'meta/_journal.json'), 'utf8'));
  const prior = journal.entries.filter((entry: { idx: number }) => entry.idx < 10);
  for (const entry of prior)
    fs.copyFileSync(path.join(src, `${entry.tag}.sql`), path.join(staged, `${entry.tag}.sql`));
  fs.writeFileSync(
    path.join(staged, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: prior })
  );
  const { runMigrations } = await import('./migrate');
  const { getSqlite } = await import('./index');
  runMigrations(staged);
  const sqlite = getSqlite();
  sqlite.exec(`insert into user (id, name, email, emailVerified, createdAt, updatedAt) values ('owner', 'Synthetic', 'synthetic@example.com', 0, 0, 0);
    insert into medications (id, user_id, name, created_at, updated_at) values ('med', 'owner', 'Synthetic A', '2026-10-10', '2026-10-10');
    insert into interaction_alerts (id, user_id, trigger_medication_id, alert_text, medication_snapshot, snoozed_until, checked_at) values ('alert', 'owner', 'med', 'Synthetic legacy alert', '{}', '2099-01-01', '2026-10-10');
    insert into interaction_checks (id, user_id, has_interactions, checked_at) values ('check', 'owner', 0, '2026-10-10');`);
  runMigrations();
  runMigrations();
  expect(sqlite.prepare('select * from interaction_alerts').all()).toEqual([
    expect.objectContaining({
      id: 'alert',
      alert_text: 'Synthetic legacy alert',
      snoozed_until: '2099-01-01',
      context_version: 0,
    }),
  ]);
  expect(sqlite.prepare('select * from interaction_checks').all()).toEqual([
    expect.objectContaining({ id: 'check', has_interactions: 0, context_version: 0 }),
  ]);
  const repo = await import('@/lib/repos/interaction-alerts');
  const scope = { ownerId: 'owner', dependentId: null };
  expect(await repo.listActiveInteractionAlerts('owner', scope)).toEqual([]);
  expect(await repo.countSnoozedInteractionAlerts('owner', scope)).toBe(0);
  expect(await repo.getInteractionCheck('owner', scope)).toBeNull();
});
