// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let sqlite: Database.Database;
vi.mock('@/db', () => ({ getSqlite: () => sqlite, db: {} }));
import { hasScope } from '@/lib/api-auth';
import {
  clinicalReportGrantRequired,
  clinicalBatchReportGrantRequired,
  scanReportGrantRequired,
} from './web-write-grants';
import { intakeSchema, scanInputSchema } from './contracts';
const unknown = { precision: 'unknown', value: null } as const;
const provenance = { basis: 'patient_reported', sources: [] };
const lab = {
  kind: 'lab',
  test_name: 'Fictional',
  outcome: { kind: 'numeric', value: 0 },
  collection_date: unknown,
  provenance,
};
const intake = (target?: string) =>
  intakeSchema.parse({
    external_id: 'batch',
    items: [
      {
        item_key: 'item',
        action: target ? 'correct' : 'add',
        ...(target ? { target_id: target, expected_revision: 'selected-revision' } : {}),
        fact: lab,
      },
    ],
  });
const scan = () =>
  scanInputSchema.parse({
    external_id: 'scan',
    source: 'Fictional',
    method: 'bia',
    measured_at: unknown,
    measurements: [{ metric_key: 'weight', value: 80, unit: 'kg' }],
    provenance,
  });
beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(
    'CREATE TABLE clinical_records(id TEXT,user_id TEXT,dependent_id TEXT,kind TEXT); CREATE TABLE clinical_intake_batches(id TEXT,user_id TEXT,dependent_id TEXT,external_id TEXT,payload_json TEXT); CREATE TABLE body_scans(user_id TEXT,dependent_id TEXT,source TEXT,external_id TEXT,payload_json TEXT);'
  );
});
afterEach(() => sqlite.close());
it('requires explicit new report grants even for historical broad or old feature tokens', () => {
  for (const scopes of [['write:all'], ['write:clinical_intake', 'write:scans']]) {
    expect(
      hasScope({ userId: 'owner', keyId: 'fictional', scopes }, 'write:clinical_reports')
    ).toBe(false);
    expect(hasScope({ userId: 'owner', keyId: 'fictional', scopes }, 'write:scan_reports')).toBe(
      false
    );
  }
  expect(
    hasScope(
      { userId: 'owner', keyId: 'fictional', scopes: ['write:clinical_reports'] },
      'write:clinical_reports'
    )
  ).toBe(true);
});
it('cannot disguise an extended persisted correction target as an incoming lab', () => {
  sqlite
    .prepare('INSERT INTO clinical_records VALUES(?,?,?,?)')
    .run('target', 'owner', null, 'condition');
  expect(clinicalReportGrantRequired('owner', intake('target'))).toBe(true);
  sqlite.prepare('UPDATE clinical_records SET kind=?').run('lab');
  expect(clinicalReportGrantRequired('owner', intake('target'))).toBe(false);
});
it('protects an existing extended staged batch even when replacement items omit new kinds', () => {
  sqlite
    .prepare('INSERT INTO clinical_intake_batches VALUES(?,?,?,?,?)')
    .run(
      'batch-id',
      'owner',
      null,
      'batch',
      JSON.stringify({ items: [{ fact: { kind: 'screening' } }] })
    );
  expect(clinicalReportGrantRequired('owner', intake())).toBe(true);
  expect(clinicalBatchReportGrantRequired('owner', 'batch-id')).toBe(true);
  expect(clinicalBatchReportGrantRequired('stranger', 'batch-id')).toBe(false);
});
it('does not classify another patient target as readable self evidence', () => {
  sqlite
    .prepare('INSERT INTO clinical_records VALUES(?,?,?,?)')
    .run('target', 'owner', 'child', 'condition');
  expect(clinicalReportGrantRequired('owner', intake('target'))).toBe(false);
  // The canonical reconciliation/authz path still rejects this target as absent.
});
it('cannot erase persisted report fields by omitting them from a scan replay/update attempt', () => {
  const existing = {
    ...scan(),
    vendor_results: { scores: [{ key: 'score', name: 'Source score', value: 0 }] },
  };
  sqlite
    .prepare('INSERT INTO body_scans VALUES(?,?,?,?,?)')
    .run('owner', null, 'Fictional', 'scan', JSON.stringify(existing));
  expect(scanReportGrantRequired('owner', scan())).toBe(true);
  expect(scanReportGrantRequired('other-owner', scan())).toBe(false);
});
it('keeps legacy base scan writes available but gates new report metrics and definitions', () => {
  expect(scanReportGrantRequired('owner', scan())).toBe(false);
  expect(
    scanReportGrantRequired('owner', {
      ...scan(),
      measurements: [{ metric_key: 'lean_mass_left_arm', value: 3, unit: 'kg' }],
    })
  ).toBe(true);
  expect(
    scanReportGrantRequired('owner', {
      ...scan(),
      measurements: [
        { metric_key: 'weight', value: 80, unit: 'kg', definition: 'Reported protocol' },
      ],
    })
  ).toBe(true);
});
