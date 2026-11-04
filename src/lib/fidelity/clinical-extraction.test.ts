// @vitest-environment node
import { beforeEach, afterEach, it, expect } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import { adaptTypedLabExtraction } from './clinical-extraction';
let ctx: RepoTestDb;
beforeEach(async () => {
  ctx = await setupRepoDb('hf-clinical-extraction-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
});
afterEach(() => ctx.restore());
const report = {
  unknown_report_evidence: 'preserved in raw metadata',
  results: [
    {
      test_name: 'Qualitative',
      value: 'Negative',
      visit_date: '2026-02',
      reference_range_text: 'Not established',
      flag: 'normal',
    },
    {
      test_name: 'Threshold',
      raw_result: '<5',
      source_unit: 'mg/L',
      collection_date: 'circa 2020',
    },
    { test_name: 'Above', value: '>59', collection_date: '2026-02-03', printed_flags: ['H'] },
    { test_name: 'Canceled', raw_result: 'Canceled: specimen unavailable' },
    { test_name: 'Recorded zero', value: 0, collection_date: '2026' },
    {
      test_name: 'Unsupported',
      outcome: { kind: 'quantum', value: 'x' },
      raw_evidence: 'retain this',
    },
  ],
};
it('preserves qualitative/censored/canceled/zero and date/reference/flag uncertainty without numeric coercion', () => {
  const result = adaptTypedLabExtraction(report, {
    externalId: 'synthetic',
    reference: 'Fictional.pdf',
  });
  expect(result.intake?.items).toHaveLength(5);
  expect(result.held).toHaveLength(1);
  const facts = result.intake!.items.map((item) => item.fact);
  expect(facts[0]).toMatchObject({
    outcome: { kind: 'text', text: 'Negative' },
    collection_date: { precision: 'month', value: '2026-02' },
    reference: { text: 'Not established' },
    printed_flags: [],
  });
  expect(facts[0].provenance.notes).toContain('unknown printed/derived');
  expect(facts[1]).toMatchObject({
    outcome: { kind: 'censored', comparator: '<', value: 5 },
    collection_date: { precision: 'unknown', value: null, original_text: 'circa 2020' },
  });
  expect(facts[2]).toMatchObject({
    outcome: { kind: 'censored', comparator: '>', value: 59 },
    printed_flags: ['H'],
  });
  expect(facts[3]).toMatchObject({ outcome: { kind: 'canceled' } });
  expect(facts[4]).toMatchObject({
    outcome: { kind: 'numeric', value: 0 },
    collection_date: { precision: 'year', value: '2026' },
  });
  expect(result.held[0].source_row).toEqual(report.results[5]);
});
it('holds conflicting numeric/threshold evidence and every excess row with explicit bounded coverage', () => {
  const conflict = adaptTypedLabExtraction(
    { results: [{ test_name: 'Conflict', raw_result: '<5', value: 8 }] },
    { externalId: 'conflict', reference: 'Fictional' }
  );
  expect(conflict.intake).toBeNull();
  expect(conflict.held[0].issues[0]).toContain('disagree');
  const typedConflict = adaptTypedLabExtraction(
    {
      results: [
        { test_name: 'Typed conflict', raw_result: '<5', outcome: { kind: 'numeric', value: 5 } },
        { test_name: 'Fake zero', raw_result: 'Negative', outcome: { kind: 'numeric', value: 0 } },
      ],
    },
    { externalId: 'typed-conflict', reference: 'Fictional' }
  );
  expect(typedConflict.intake).toBeNull();
  expect(typedConflict.held).toHaveLength(2);
  const many = adaptTypedLabExtraction(
    { results: Array.from({ length: 102 }, (_, i) => ({ test_name: 'Fictional ' + i, value: 0 })) },
    { externalId: 'many', reference: 'Fictional' }
  );
  expect(many.intake?.items).toHaveLength(100);
  expect(many.held).toHaveLength(2);
  expect(many.held[0].issues[0]).toContain('100-item');
});
it.each([
  {
    test_name: 'Canceled numeric projection',
    raw_result: 'Canceled: specimen unavailable',
    value: 0,
  },
  { test_name: 'Qualitative numeric projection', raw_result: 'Negative', value: 0 },
  { test_name: 'Conflicting exact numeric', raw_result: '5', value: 8 },
  { test_name: 'Conflicting string numeric', raw_result: '5', value: '8' },
  { test_name: 'Conflicting raw text', raw_text: 'Negative', value: 0 },
  { test_name: 'Conflicting text projection', raw_result: '5', value: 'Negative' },
  { test_name: 'Conflicting qualitative projection', raw_result: 'Negative', value: 'Positive' },
])('holds absent-outcome contradictory raw and numeric evidence: $test_name', (row) => {
  const result = adaptTypedLabExtraction(
    { results: [row] },
    { externalId: 'inconsistent-legacy', reference: 'Fictional source' }
  );
  expect(result.intake).toBeNull();
  expect(result.held).toHaveLength(1);
  expect(result.held[0].source_row).toEqual(row);
  expect(result.held[0].issues[0]).toContain('printed result disagree');
});
it('keeps compatible raw/numeric fallback evidence while preserving threshold, qualitative, canceled and zero meanings', () => {
  const result = adaptTypedLabExtraction(
    {
      results: [
        { test_name: 'Compatible numeric', raw_result: '5', value: 5 },
        { test_name: 'Compatible numeric units', raw_result: '5 mg/L', value: 5 },
        { test_name: 'Threshold', raw_result: '<5', value: 5 },
        { test_name: 'Real zero', raw_result: '0', value: 0 },
        { test_name: 'Qualitative', raw_result: 'Negative' },
        { test_name: 'Canceled', raw_result: 'Canceled: specimen unavailable' },
      ],
    },
    { externalId: 'compatible-legacy', reference: 'Fictional source' }
  );
  expect(result.held).toEqual([]);
  expect(result.intake?.items.map((item) => item.fact.kind === 'lab' && item.fact.outcome)).toEqual(
    [
      { kind: 'numeric', value: 5, comparator: '=' },
      { kind: 'numeric', value: 5, comparator: '=' },
      { kind: 'censored', value: 5, comparator: '<' },
      { kind: 'numeric', value: 0, comparator: '=' },
      { kind: 'text', text: 'Negative' },
      { kind: 'canceled', reason: 'Canceled: specimen unavailable' },
    ]
  );
});
const explicitEvidence = [
  { kind: 'numeric', raw: '0', outcome: { kind: 'numeric', value: 0 } },
  { kind: 'censored', raw: '<5', outcome: { kind: 'censored', comparator: '<', value: 5 } },
  { kind: 'text', raw: 'Negative', outcome: { kind: 'text', text: 'Negative' } },
  {
    kind: 'canceled',
    raw: 'Canceled: specimen unavailable',
    outcome: { kind: 'canceled', reason: 'specimen unavailable' },
  },
];
it.each(
  explicitEvidence.flatMap((source) =>
    explicitEvidence
      .filter((target) => target.kind !== source.kind)
      .map((target) => ({
        test_name: source.kind + ' source / ' + target.kind + ' outcome',
        raw_result: source.raw,
        outcome: target.outcome,
      }))
  )
)('holds cross-kind explicit outcome contradictions: $test_name', (row) => {
  const result = adaptTypedLabExtraction(
    { results: [row] },
    { externalId: 'explicit-cross-kind', reference: 'Fictional source' }
  );
  expect(result.intake).toBeNull();
  expect(result.held[0].source_row).toEqual(row);
  expect(result.held[0].issues[0]).toContain('typed outcome and printed result disagree');
});
it.each([
  {
    test_name: 'Opposite text',
    raw_result: 'Negative',
    outcome: { kind: 'text', text: 'Positive' },
  },
  { test_name: 'Changed numeric', raw_result: '0', outcome: { kind: 'numeric', value: 1 } },
  {
    test_name: 'Changed bound',
    raw_result: '<5',
    outcome: { kind: 'censored', comparator: '>', value: 5 },
  },
  {
    test_name: 'Changed cancellation reason',
    raw_result: 'Canceled: specimen unavailable',
    outcome: { kind: 'canceled', reason: 'Hemolysis' },
  },
  {
    test_name: 'Cancellation reason substring changes meaning',
    raw_result: 'Canceled: specimen unavailable',
    outcome: { kind: 'canceled', reason: 'available' },
  },
  {
    test_name: 'Numeric projection contradicts canceled outcome without raw',
    value: 0,
    outcome: { kind: 'canceled' },
  },
  {
    test_name: 'Different exact units',
    raw_result: '5 mg/L',
    source_unit: 'mmol/L',
    outcome: { kind: 'numeric', value: 5 },
  },
  {
    test_name: 'Different threshold units',
    raw_result: '<5 mg/L',
    source_unit: 'mmol/L',
    outcome: { kind: 'censored', comparator: '<', value: 5 },
  },
  {
    test_name: 'Conflicting extracted unit fields',
    raw_result: '5',
    source_unit: 'mg/L',
    unit: 'mmol/L',
    outcome: { kind: 'numeric', value: 5 },
  },
  {
    test_name: 'Unit case matters',
    raw_result: '5 mIU/L',
    source_unit: 'MIU/L',
    outcome: { kind: 'numeric', value: 5 },
  },
  {
    test_name: 'Scientific number is not a unit suffix',
    raw_result: '5e3',
    outcome: { kind: 'numeric', value: 5 },
  },
  {
    test_name: 'Two numbers are not a unit suffix',
    raw_result: '5 10',
    outcome: { kind: 'numeric', value: 5 },
  },
])('holds contradictory explicit values or units: $test_name', (row) => {
  const result = adaptTypedLabExtraction(
    { results: [row] },
    { externalId: 'explicit-disagreement', reference: 'Fictional source' }
  );
  expect(result.intake).toBeNull();
  expect(result.held).toHaveLength(1);
  expect(result.held[0].source_row).toEqual(row);
  expect(result.held[0].issues[0]).toContain('disagree');
});
it('accepts compatible explicit kinds and unit evidence without converting source values or text', () => {
  const rows = [
    ...explicitEvidence.map((source) => ({
      test_name: source.kind,
      raw_result: source.raw,
      outcome: source.outcome,
    })),
    {
      test_name: 'Numeric units',
      raw_result: '5 mg/L',
      source_unit: 'mg/L',
      outcome: { kind: 'numeric', value: 5 },
    },
    {
      test_name: 'Threshold units',
      raw_result: '<5 mg/L',
      source_unit: 'mg/L',
      outcome: { kind: 'censored', comparator: '<', value: 5 },
    },
    {
      test_name: 'Scientific notation',
      raw_result: '5e3',
      outcome: { kind: 'numeric', value: 5000 },
    },
  ];
  const result = adaptTypedLabExtraction(
    { results: rows },
    { externalId: 'compatible-explicit', reference: 'Fictional source' }
  );
  expect(result.held).toEqual([]);
  expect(result.intake?.items).toHaveLength(rows.length);
  result.intake!.items.forEach((item, i) => {
    expect(item.fact).toMatchObject({ raw_result: rows[i].raw_result, outcome: rows[i].outcome });
  });
});
it('retains original extraction evidence, disallows numeric commits and resolves held rows only after exact approval', async () => {
  const { stageImportBatch, commitImportBatch } = await import('@/lib/import/batches');
  const { saveTypedLabEvidence, getTypedLabEvidence } = await import('./clinical-extraction');
  const clinical = await import('./clinical');
  const source = await stageImportBatch(OWNER, null, {
    hash: 'synthetic',
    kind: 'clinical_labs',
    name: 'Fictional.pdf',
    sourcePath: OWNER + '/fictional.pdf',
    items: [],
  });
  const staged = await saveTypedLabEvidence(OWNER, null, source.id, report, 'Fictional.pdf');
  expect(staged.batch?.documents[0]).toMatchObject({ id: source.id, held: 1, pending: 5 });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 0 });
  await expect(commitImportBatch(OWNER, source.id, { decisions: [] })).rejects.toThrow(
    'typed source evidence'
  );
  const accepted = await clinical.approveClinicalIntake(OWNER, staged.batch!.id, {
    version: staged.batch!.version,
    digest: staged.batch!.digest,
  });
  expect(accepted.counts.created).toBe(5);
  const evidence = await getTypedLabEvidence(OWNER, source.id);
  expect(evidence.held).toHaveLength(1);
  expect(evidence.retained.filter((row) => row.status === 'typed_resolved')).toHaveLength(5);
  const held = evidence.held[0];
  const resolved = await clinical.stageClinicalIntake(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    {
      external_id: 'manual-resolution',
      items: [
        {
          item_key: 'held',
          action: 'add',
          fact: {
            kind: 'lab',
            test_name: 'Resolved unsupported',
            outcome: { kind: 'text', text: 'Verified qualitative evidence' },
            collection_date: { precision: 'unknown', value: null },
            provenance: {
              basis: 'source_reported',
              sources: [
                {
                  document_id: source.id,
                  reference: 'Fictional.pdf · clinical-source-item:' + held.source_item_id,
                },
              ],
            },
          },
        },
      ],
    }
  );
  await clinical.approveClinicalIntake(OWNER, resolved.id, {
    version: resolved.version,
    digest: resolved.digest,
  });
  const done = await getTypedLabEvidence(OWNER, source.id);
  expect(done.status).toBe('complete');
  expect(done.held).toEqual([]);
  expect(
    done.retained.find((row) => row.source_item_id === held.source_item_id)?.source_row
  ).toEqual(report.results[5]);
  expect(
    ctx.sqlite
      .prepare("SELECT payload FROM import_items WHERE batch_id=? AND status='document_metadata'")
      .get(source.id)
  ).toEqual({ payload: JSON.stringify({ _hf_document_report: report }) });
  await expect(getTypedLabEvidence(STRANGER, source.id)).rejects.toThrow();
  const dep = 'synthetic-dependent';
  insertDependent(ctx.sqlite, dep, OWNER);
  await expect(
    saveTypedLabEvidence(OWNER, dep, source.id, report, 'wrong person')
  ).rejects.toThrow();
});
it('persists contradictory absent-outcome source rows as held without staging numeric facts', async () => {
  const { stageImportBatch } = await import('@/lib/import/batches');
  const { saveTypedLabEvidence, getTypedLabEvidence } = await import('./clinical-extraction');
  const source = await stageImportBatch(OWNER, null, {
    hash: 'contradictory-fallback',
    kind: 'clinical_labs',
    name: 'Fictional contradictions.pdf',
    items: [],
  });
  const rows = [
    { test_name: 'Canceled', raw_result: 'Canceled: specimen unavailable', value: 0 },
    { test_name: 'Qualitative', raw_result: 'Negative', value: 0 },
    { test_name: 'Exact numeric conflict', raw_result: '5', value: 8 },
  ];
  const saved = await saveTypedLabEvidence(
    OWNER,
    null,
    source.id,
    { results: rows },
    'Fictional contradictions.pdf'
  );
  expect(saved.batch).toBeNull();
  expect(saved.held).toHaveLength(3);
  const evidence = await getTypedLabEvidence(OWNER, source.id);
  expect(evidence.status).toBe('incomplete');
  expect(evidence.held.map((row) => row.source_row)).toEqual(rows);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 0 });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_intake_batches').get()).toEqual({
    n: 0,
  });
});
it('recovers staging from retained rows without multiplying source identities', async () => {
  const { stageImportBatch } = await import('@/lib/import/batches');
  const { saveTypedLabEvidence } = await import('./clinical-extraction');
  const source = await stageImportBatch(OWNER, null, {
    hash: 'recovery',
    kind: 'clinical_labs',
    name: 'Fictional.png',
    items: [],
  });
  const first = await saveTypedLabEvidence(
    OWNER,
    null,
    source.id,
    { results: [{ test_name: 'Only', value: 0 }] },
    'Fictional.png'
  );
  const ids = ctx.sqlite
    .prepare('SELECT id FROM import_items WHERE batch_id=? ORDER BY position')
    .all(source.id);
  const second = await saveTypedLabEvidence(
    OWNER,
    null,
    source.id,
    { results: [{ test_name: 'Only', value: 0 }] },
    'Fictional.png'
  );
  expect(second.batch?.id).toBe(first.batch?.id);
  expect(
    ctx.sqlite
      .prepare('SELECT id FROM import_items WHERE batch_id=? ORDER BY position')
      .all(source.id)
  ).toEqual(ids);
});
it('retains an empty extraction as incomplete without creating visits, batches or repeated metadata', async () => {
  const { stageImportBatch } = await import('@/lib/import/batches');
  const { saveTypedLabEvidence, getTypedLabEvidence } = await import('./clinical-extraction');
  const source = await stageImportBatch(OWNER, null, {
    hash: 'empty',
    kind: 'clinical_labs',
    name: 'Empty.pdf',
    items: [],
  });
  for (let i = 0; i < 2; i++)
    expect(
      (await saveTypedLabEvidence(OWNER, null, source.id, { results: [] }, 'Empty.pdf')).batch
    ).toBeNull();
  const evidence = await getTypedLabEvidence(OWNER, source.id);
  expect(evidence.status).toBe('incomplete');
  expect(evidence.warnings[0]).toContain('No laboratory rows');
  expect(
    ctx.sqlite.prepare('SELECT count(*) n FROM import_items WHERE batch_id=?').get(source.id)
  ).toEqual({ n: 1 });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_intake_batches').get()).toEqual({
    n: 0,
  });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_visits').get()).toEqual({ n: 0 });
});
