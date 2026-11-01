// @vitest-environment node
import { beforeEach, afterEach, it, expect } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
let ctx: RepoTestDb;
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-hf-export-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
});
afterEach(() => ctx.restore());
it('exports all owned typed source precision and corrections without another person’s data', async () => {
  const insert = ctx.sqlite.prepare(
    'INSERT INTO clinical_records(id,user_id,kind,payload_json,received_at,updated_at)VALUES(?,?,?,?,?,?)'
  );
  const fact = {
    kind: 'lab',
    raw_result: '<5.00',
    source_unit: 'mIU / mL',
    collection_date: { precision: 'year', value: '2020' },
    outcome: { kind: 'censored', value: 5, comparator: '<' },
    printed_flags: [],
    reference: { text: 'Not established' },
  };
  insert.run(
    'owner-fact',
    OWNER,
    'lab',
    JSON.stringify(fact),
    '2026-10-31T00:00:00Z',
    '2026-10-31T00:00:00Z'
  );
  insert.run(
    'stranger-fact',
    STRANGER,
    'lab',
    JSON.stringify({ ...fact, raw_result: 'private-other' }),
    '2026-10-31T00:00:00Z',
    '2026-10-31T00:00:00Z'
  );
  const { exportFidelityData } = await import('./export');
  const exported = exportFidelityData(OWNER);
  expect(exported.clinical_records).toHaveLength(1);
  expect(exported.clinical_records[0].fact).toEqual(fact);
  expect(JSON.stringify(exported)).not.toContain('private-other');
});
