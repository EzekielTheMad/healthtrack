// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { StagedClaim } from './batches';
let ctx: RepoTestDb;
let repo: typeof import('./batches');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-reconcile-');
  repo = await import('./batches');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
});
afterEach(() => ctx.restore());
const lab = (value = 5): StagedClaim => ({
  domain: 'lab_results',
  payload: {
    test_name: 'Synthetic marker',
    value,
    unit: 'mg',
    visit_date: '2026-02-04',
    _visit_key: '0',
  },
});
async function stage(
  items: StagedClaim[],
  hash = 'document-one',
  dependentId: string | null = null
) {
  return repo.stageImportBatch(OWNER, dependentId, {
    hash,
    kind: 'labs',
    name: 'synthetic.pdf',
    sourcePath: `${OWNER}/synthetic.pdf`,
    items,
  });
}
describe('durable patient-scoped import reconciliation', () => {
  it('persists printed LOINC and preserves it through an unrelated import correction', async () => {
    const first = await stage([
      { ...lab(), payload: { ...lab().payload, loinc_code: '718-7', accession_id: 'printed-one' } },
    ]);
    const saved = await repo.commitImportBatch(OWNER, first.id, {
      decisions: [{ item_id: first.items[0].id, action: 'add' }],
    });
    const recordId = saved.items[0].record_id;
    expect(
      ctx.sqlite.prepare('SELECT loinc_code FROM lab_results WHERE id=?').get(recordId)
    ).toEqual({ loinc_code: '718-7' });
    const next = await stage(
      [
        {
          ...lab(8),
          payload: { ...lab(8).payload, test_name: 'Renamed printed analyte', loinc_code: '718-7' },
        },
      ],
      'loinc-correction'
    );
    expect(next.items[0].classification).toBe('conflict');
    expect(next.items[0].matches[0].id).toBe(recordId);
    const result = await repo.commitImportBatch(OWNER, next.id, {
      decisions: [
        {
          item_id: next.items[0].id,
          action: 'correct',
          target_id: recordId,
          expected: next.items[0].matches[0].values,
          values: { value: 8 },
        },
      ],
    });
    expect(result.counts.corrected).toBe(1);
    expect(
      ctx.sqlite.prepare('SELECT value,loinc_code FROM lab_results WHERE id=?').get(recordId)
    ).toEqual({ value: 8, loinc_code: '718-7' });
  });
  it('invalidates only the changed patient active-medication interaction outcome, not date-only corrections', async () => {
    const checks = await import('@/lib/repos/interaction-alerts');
    insertDependent(ctx.sqlite, 'interaction-child', OWNER);
    await checks.recordInteractionCheck(OWNER, null, false);
    await checks.recordInteractionCheck(OWNER, 'interaction-child', false);
    const medication = {
      domain: 'medications' as const,
      payload: {
        name: 'Synthetic medication',
        dosage: '5 mg',
        start_date: '2026-01-02',
        active: true,
      },
    };
    const batch = await stage([medication]);
    await repo.commitImportBatch(OWNER, batch.id, {
      decisions: [{ item_id: batch.items[0].id, action: 'add' }],
    });
    expect(
      await checks.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null })
    ).toBeNull();
    expect(
      await checks.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: 'interaction-child' })
    ).not.toBeNull();
    await checks.recordInteractionCheck(OWNER, null, false);
    const next = await stage(
      [{ ...medication, payload: { ...medication.payload, start_date: '2026-01-03' } }],
      'date-only'
    );
    await repo.commitImportBatch(OWNER, next.id, {
      decisions: [
        {
          item_id: next.items[0].id,
          action: 'correct',
          target_id: next.items[0].matches[0].id,
          expected: next.items[0].matches[0].values,
          values: { start_date: '2026-01-03' },
        },
      ],
    });
    expect(
      await checks.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null })
    ).not.toBeNull();
  });
  it('does not store numeric thresholds as exact results', async () => {
    const batch = await stage([{ ...lab(), payload: { ...lab().payload, raw_text: '<5 mg' } }]);
    const result = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: [{ item_id: batch.items[0].id, action: 'add' }],
    });
    expect(result.counts.error).toBe(1);
    expect(result.items[0].payload.raw_text).toBe('<5 mg');
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_results').get()).toEqual({ n: 0 });
  });
  it('adds ambiguous records separately even if a caller supplies a target ID', async () => {
    const first = await stage([lab()]);
    const saved = await repo.commitImportBatch(OWNER, first.id, {
      decisions: [{ item_id: first.items[0].id, action: 'add' }],
    });
    const next = await stage([lab(8)], 'separate-draw');
    const added = await repo.commitImportBatch(OWNER, next.id, {
      decisions: [
        { item_id: next.items[0].id, action: 'add', target_id: saved.items[0].record_id },
      ],
    });
    expect(added.counts.applied).toBe(1);
    expect(added.items[0].record_id).not.toBe(saved.items[0].record_id);
  });
  it('separates contradictory specimens in an extracted same-date visit', async () => {
    const items = [
      { ...lab(), payload: { ...lab().payload, accession_id: 'a', specimen_id: 'one' } },
      { ...lab(), payload: { ...lab().payload, accession_id: 'a', specimen_id: 'two' } },
    ];
    const batch = await stage(items);
    const result = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: batch.items.map((item) => ({ item_id: item.id, action: 'add' })),
    });
    expect(result.counts.applied).toBe(2);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_visits').get()).toEqual({ n: 2 });
  });
  it('does not let an unknown-specimen row bridge contradictory draws into one visit', async () => {
    const items = [
      { ...lab(), payload: { ...lab().payload, specimen_id: 'tube-a' } },
      lab(),
      { ...lab(), payload: { ...lab().payload, specimen_id: 'tube-b' } },
    ];
    const batch = await stage(items);
    const result = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: batch.items.map((item) => ({ item_id: item.id, action: 'add' })),
    });
    expect(result.counts.applied).toBe(3);
    const visits = result.items.map(
      (item) =>
        (
          ctx.sqlite
            .prepare('SELECT lab_visit_id FROM lab_results WHERE id=?')
            .get(item.record_id) as { lab_visit_id: string }
        ).lab_visit_id
    );
    expect(visits[0]).toBe(visits[1]);
    expect(visits[2]).not.toBe(visits[0]);
  });
  it('keeps incomplete extraction distinct and appends retried claims without replaying applied ones', async () => {
    const one = lab();
    let batch = await repo.stageImportBatch(OWNER, null, {
      hash: 'partial-file',
      kind: 'medical_history',
      name: 'synthetic.pdf',
      warnings: ['Pages 26-50 could not be processed'],
      items: [one],
    });
    batch = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: [{ item_id: batch.items[0].id, action: 'add' }],
    });
    expect(batch.status).toBe('incomplete');
    const retry = await repo.stageImportBatch(OWNER, null, {
      hash: 'partial-file',
      kind: 'medical_history',
      name: 'synthetic.pdf',
      warnings: [],
      items: [one, { ...lab(8), payload: { ...lab(8).payload, test_name: 'New section marker' } }],
      retryExtraction: true,
    });
    expect(retry.id).toBe(batch.id);
    expect(retry.items).toHaveLength(2);
    expect(retry.items[0].status).toBe('applied');
    expect(retry.items[1].status).toBe('pending');
    const complete = await repo.commitImportBatch(OWNER, retry.id, {
      decisions: [{ item_id: retry.items[1].id, action: 'add' }],
    });
    expect(complete.status).toBe('complete');
    expect(complete.counts.applied).toBe(2);
  });
  it('scopes file hashes by patient and serializes concurrent stage/commit retries', async () => {
    const [one, two] = await Promise.all([stage([lab()]), stage([lab()])]);
    expect(one.id).toBe(two.id);
    const decisions = { decisions: [{ item_id: one.items[0].id, action: 'add' }] };
    await Promise.all([
      repo.commitImportBatch(OWNER, one.id, decisions),
      repo.commitImportBatch(OWNER, one.id, decisions),
    ]);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_results').get()).toEqual({ n: 1 });
    insertDependent(ctx.sqlite, 'synthetic-child', OWNER);
    expect((await stage([lab()], 'document-one', 'synthetic-child')).id).not.toBe(one.id);
    await expect(repo.getImportBatch(STRANGER, one.id)).rejects.toMatchObject({ status: 404 });
    await expect(stage([lab()], 'other', 'not-owned')).rejects.toMatchObject({ status: 404 });
  });
  it('retains same-day draw conflicts and never auto-discards by date/name/value', async () => {
    const first = await stage([lab(), lab(7)]);
    expect(first.items.map((i) => i.classification)).toEqual(['new', 'conflict']);
    const saved = await repo.commitImportBatch(OWNER, first.id, {
      decisions: first.items.map((i) => ({ item_id: i.id, action: 'add' })),
    });
    expect(saved.counts.applied).toBe(2);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_visits').get()).toEqual({ n: 1 });
    expect(ctx.sqlite.prepare('SELECT value FROM lab_results ORDER BY value').all()).toEqual([
      { value: 5 },
      { value: 7 },
    ]);
    const again = await stage([lab()], 'different-file');
    expect(again.items[0].classification).toBe('conflict');
    const identical = await stage(
      [{ ...lab(), payload: { ...lab().payload, test_name: 'Other marker' } }],
      'third-file'
    );
    await repo.commitImportBatch(OWNER, identical.id, {
      decisions: [{ item_id: identical.items[0].id, action: 'add' }],
    });
    const same = await stage(
      [{ ...lab(), payload: { ...lab().payload, test_name: 'Other marker' } }],
      'fourth-file'
    );
    expect(same.items[0].classification).toBe('possible');
  });
  it('keeps uncertain dates and unknown severity staged without inventing facts', async () => {
    const batch = await stage([
      { domain: 'procedures', payload: { name: 'Synthetic procedure', procedure_date: '2024' } },
      { domain: 'allergies', payload: { name: 'Synthetic allergen', severity: null } },
    ]);
    let result = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: batch.items.map((i) => ({ item_id: i.id, action: 'add' })),
    });
    expect(result.counts.error).toBe(2);
    expect(result.items[0].payload.procedure_date).toBe('2024');
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM procedures').get()).toEqual({ n: 0 });
    result = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: [
        { item_id: batch.items[0].id, action: 'add', values: { procedure_date: '2024-05-06' } },
        { item_id: batch.items[1].id, action: 'skip' },
      ],
    });
    expect(result.counts.applied).toBe(1);
    expect(result.counts.skipped).toBe(1);
    expect(result.status).toBe('complete');
    expect(JSON.parse(result.items[0].applied_payload!).procedure_date).toBe('2024-05-06');
  });
  it('supports explicit link/correct with stable records, audit and stale-review protection', async () => {
    const first = await stage([lab()]);
    const saved = await repo.commitImportBatch(OWNER, first.id, {
      decisions: [{ item_id: first.items[0].id, action: 'add' }],
    });
    const target = saved.items[0].record_id!;
    const next = await stage([lab(8)], 'new-value');
    const item = next.items[0];
    const corrected = await repo.commitImportBatch(OWNER, next.id, {
      decisions: [
        {
          item_id: item.id,
          action: 'correct',
          target_id: target,
          expected: item.matches[0].values,
          values: { value: 8 },
          reason: 'Verified printed value',
        },
      ],
    });
    expect(corrected.counts.corrected).toBe(1);
    expect(ctx.sqlite.prepare('SELECT value FROM lab_results WHERE id=?').get(target)).toEqual({
      value: 8,
    });
    const audit = ctx.sqlite
      .prepare('SELECT before_json,after_json FROM clinical_corrections')
      .get() as { before_json: string; after_json: string };
    expect(JSON.parse(audit.before_json).value).toBe(5);
    expect(JSON.parse(audit.after_json).value).toBe(8);
    const stale = await stage([lab(9)], 'stale-value');
    ctx.sqlite.prepare('UPDATE lab_results SET value=10 WHERE id=?').run(target);
    const rejected = await repo.commitImportBatch(OWNER, stale.id, {
      decisions: [
        {
          item_id: stale.items[0].id,
          action: 'correct',
          target_id: target,
          expected: stale.items[0].matches[0].values,
          values: { value: 9 },
        },
      ],
    });
    expect(rejected.counts.error).toBe(1);
    expect(ctx.sqlite.prepare('SELECT value FROM lab_results WHERE id=?').get(target)).toEqual({
      value: 10,
    });
    const linked = await repo.commitImportBatch(OWNER, stale.id, {
      decisions: [{ item_id: stale.items[0].id, action: 'link', target_id: target }],
    });
    expect(linked.counts.linked).toBe(1);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_results').get()).toEqual({ n: 1 });
  });
  it('rolls back a failed clinical insert but records a retryable item outcome', async () => {
    ctx.sqlite.exec(
      "CREATE TRIGGER synthetic_failure BEFORE INSERT ON lab_results BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"
    );
    const batch = await stage([lab()]);
    const result = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: [{ item_id: batch.items[0].id, action: 'add' }],
    });
    expect(result.counts.error).toBe(1);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_visits').get()).toEqual({ n: 0 });
    ctx.sqlite.exec('DROP TRIGGER synthetic_failure');
    const retry = await repo.commitImportBatch(OWNER, batch.id, {
      decisions: [{ item_id: batch.items[0].id, action: 'add' }],
    });
    expect(retry.counts.applied).toBe(1);
  });
});
