// @vitest-environment node
import { beforeEach, afterEach, it, expect } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertShare,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { ClinicalFact } from './contracts';
let ctx: RepoTestDb;
let repo: typeof import('./clinical');
const scope = { ownerId: OWNER, dependentId: null };
const evidence = {
  basis: 'source_reported' as const,
  verification: 'unconfirmed' as const,
  sources: [{ reference: 'Fictional report A' }],
};
const lab = (
  outcome: Record<string, unknown> = { kind: 'censored', value: 5, comparator: '<' }
) => ({
  kind: 'lab',
  test_name: 'Fictional analyte',
  outcome,
  raw_result: '<5',
  source_unit: 'mg/L',
  reference: { text: 'Not established' },
  printed_flags: ['H?'],
  collection_date: { precision: 'month', value: '2026-02' },
  report_date: { precision: 'day', value: '2026-03-01' },
  provenance: evidence,
});
const med = () => ({
  kind: 'medication',
  name: 'Fictional regimen',
  status: 'unconfirmed',
  product_strength: { value: 20, unit: 'mg' },
  concentration: { numerator: { value: 20, unit: 'mg' }, denominator: { value: 1, unit: 'mL' } },
  administered_amount: { value: 0.25, unit: 'mL' },
  route: 'subcutaneous',
  prn: true,
  prescribed_directions: 'As prescribed',
  patient_reported_use: 'Reported different schedule',
  schedule: [
    { weekday: 1, amount: { value: 0.25, unit: 'mL' } },
    { weekday: 4, amount: { value: 0.5, unit: 'mL' } },
  ],
  start_date: { precision: 'year', value: '2020', approximate: true },
  provenance: evidence,
});
const intake = (external_id: string, fact: unknown, extra: Record<string, unknown> = {}) => ({
  external_id,
  items: [{ item_key: 'one', action: 'add', fact, ...extra }],
});
async function accept(external: string, fact: unknown, extra: Record<string, unknown> = {}) {
  const preview = await repo.stageClinicalIntake(OWNER, scope, intake(external, fact, extra));
  return repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
}
beforeEach(async () => {
  ctx = await setupRepoDb('hf-clinical-');
  for (const user of [OWNER, VIEWER, STRANGER]) insertUser(ctx.sqlite, user);
  repo = await import('./clinical');
});
afterEach(() => ctx.restore());
it('lets an explicitly skipped invalid reference coexist with valid approved facts without linking other-subject evidence', async () => {
  const invalid = {
    ...lab(),
    provenance: {
      ...evidence,
      sources: [
        {
          document_id: 'unavailable-source',
          reference: 'clinical-source-item:11111111-1111-1111-1111-111111111111',
        },
      ],
    },
  };
  const preview = await repo.stageClinicalIntake(OWNER, scope, {
    external_id: 'safe-skip',
    items: [
      { item_key: 'skip', action: 'skip', fact: invalid },
      { item_key: 'valid', action: 'add', fact: { ...lab(), test_name: 'Valid selected result' } },
    ],
  });
  const approved = await repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  expect(approved.counts).toMatchObject({ skipped: 1, created: 1 });
  expect(
    (await repo.listClinicalFacts(OWNER, scope)).map(
      (row) => row.fact.kind === 'lab' && row.fact.test_name
    )
  ).toEqual(['Valid selected result']);
  await expect(
    repo.stageClinicalIntake(OWNER, scope, intake('invalid-add', invalid))
  ).rejects.toThrow('source document');
});
it('matches older records beyond the read window and fingerprints matches omitted from the bounded preview', async () => {
  const { clinicalFactSchema } = await import('./contracts');
  const exact = clinicalFactSchema.parse({
    ...lab(),
    collection_date: { precision: 'day', value: '2026-02-03' },
    accession_id: 'Fictional accession',
  });
  const insert = ctx.sqlite.prepare(
    'INSERT INTO clinical_records(id,user_id,kind,payload_json,received_at,updated_at)VALUES(?,?,?,?,?,?)'
  );
  ctx.sqlite.transaction(() => {
    insert.run(
      'old-exact',
      OWNER,
      'lab',
      JSON.stringify(exact),
      '2000-01-01T00:00:00Z',
      '2000-01-01T00:00:00Z'
    );
    for (let i = 0; i < 1005; i++)
      insert.run(
        'new-' + i,
        OWNER,
        'lab',
        JSON.stringify({ ...exact, test_name: 'Unrelated ' + i }),
        '2026-10-31T00:00:00Z',
        '2026-10-31T00:00:00Z'
      );
  })();
  expect(
    (await repo.listClinicalFacts(OWNER, scope, { kind: 'lab', limit: 1000 })).some(
      (r) => r.id === 'old-exact'
    )
  ).toBe(false);
  const preview = await repo.stageClinicalIntake(OWNER, scope, intake('older-duplicate', exact));
  expect(preview.items[0].matches).toMatchObject([
    { id: 'old-exact', classification: 'duplicate' },
  ]);
  const done = await repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  expect(done.counts.skipped).toBe(1);
  ctx.sqlite.transaction(() => {
    for (let i = 0; i < 110; i++)
      insert.run(
        'related-' + String(i).padStart(3, '0'),
        OWNER,
        'lab',
        JSON.stringify({ ...exact, accession_id: 'Other ' + i }),
        '2026-10-31T00:00:00Z',
        '2026-10-31T00:00:00Z'
      );
  })();
  const bounded = await repo.stageClinicalIntake(
    OWNER,
    scope,
    intake('bounded-matches', { ...exact, raw_result: '4', outcome: { kind: 'numeric', value: 4 } })
  );
  expect(bounded.items[0].matches).toHaveLength(100);
  expect(bounded.items[0].matching_count).toBe(111);
  const hidden = 'related-109';
  expect(bounded.items[0].matches.some((m) => m.id === hidden)).toBe(false);
  ctx.sqlite.prepare('UPDATE clinical_records SET revision=revision+1 WHERE id=?').run(hidden);
  await expect(
    repo.approveClinicalIntake(OWNER, bounded.id, {
      version: bounded.version,
      digest: bounded.digest,
    })
  ).rejects.toThrow('changed');
});
it('stages without canonical mutation, then preserves typed values and server receipt through approval/retry', async () => {
  const preview = await repo.stageClinicalIntake(OWNER, scope, intake('bounded-result', lab()));
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 0 });
  const result = await repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  expect(result.counts.created).toBe(1);
  const id = result.items[0].outcome?.record_id;
  const records = await repo.listClinicalFacts(OWNER, scope, { kind: 'lab' });
  expect(records).toHaveLength(1);
  expect(records[0].fact).toMatchObject(lab());
  expect(records[0].received_at).toMatch(/^\d{4}-/);
  expect(records[0].id).toBe(id);
  expect((records[0].fact as Extract<ClinicalFact, { kind: 'lab' }>).outcome).toEqual({
    kind: 'censored',
    value: 5,
    comparator: '<',
  });
  await Promise.all([
    repo.approveClinicalIntake(OWNER, preview.id, {
      version: preview.version,
      digest: preview.digest,
    }),
    repo.approveClinicalIntake(OWNER, preview.id, {
      version: preview.version,
      digest: preview.digest,
    }),
  ]);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 1 });
});
it('retains qualitative, canceled and real zero independently without numeric legacy projection', async () => {
  for (const [i, outcome] of [
    { kind: 'text', text: 'Negative' },
    { kind: 'canceled', reason: 'Specimen unavailable' },
    { kind: 'numeric', value: 0 },
  ].entries())
    await accept('state-' + i, { ...lab(outcome), test_name: 'State ' + i });
  const records = await repo.listClinicalFacts(OWNER, scope, { kind: 'lab' });
  expect(records.map((r) => r.fact.kind === 'lab' && r.fact.outcome.kind).sort()).toEqual([
    'canceled',
    'numeric',
    'text',
  ]);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_results').get()).toEqual({ n: 0 });
});
it('binds approval to revised contents and returns conflict without writes on stale approval', async () => {
  const initial = await repo.stageClinicalIntake(OWNER, scope, intake('editable', lab()));
  const revised = await repo.reviseClinicalIntake(OWNER, initial.id, {
    expected_version: initial.version,
    intake: intake('editable', { ...lab(), test_name: 'Revised' }),
  });
  expect(revised.digest).not.toBe(initial.digest);
  await expect(
    repo.approveClinicalIntake(OWNER, initial.id, {
      version: initial.version,
      digest: initial.digest,
    })
  ).rejects.toThrow('changed');
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 0 });
  await repo.approveClinicalIntake(OWNER, revised.id, {
    version: revised.version,
    digest: revised.digest,
  });
  await expect(repo.stageClinicalIntake(OWNER, scope, intake('editable', lab()))).rejects.toThrow(
    'different content'
  );
});
it('rechecks record revisions and current matches at commit, auditing selected typed corrections', async () => {
  await accept('original', lab());
  const original = (await repo.listClinicalFacts(OWNER, scope, { kind: 'lab' }))[0];
  const staged = await repo.stageClinicalIntake(
    OWNER,
    scope,
    intake(
      'stale-correction',
      { ...lab(), raw_result: '<4', outcome: { kind: 'censored', value: 4, comparator: '<' } },
      {
        action: 'correct',
        target_id: original.id,
        expected_revision: original.revision,
        reason: 'Fictional correction',
      }
    )
  );
  const correction = await accept(
    'other-correction',
    { ...lab(), raw_result: '<3', outcome: { kind: 'censored', value: 3, comparator: '<' } },
    {
      action: 'correct',
      target_id: original.id,
      expected_revision: original.revision,
      reason: 'Updated report',
    }
  );
  expect(correction.counts.corrected).toBe(1);
  await expect(
    repo.approveClinicalIntake(OWNER, staged.id, { version: staged.version, digest: staged.digest })
  ).rejects.toThrow('changed');
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_corrections').get()).toEqual({ n: 1 });
  const current = (await repo.listClinicalFacts(OWNER, scope, { kind: 'lab' }))[0];
  expect(current.id).toBe(original.id);
  expect(current.revision).not.toBe(original.revision);
});
it('keeps uncertain same-day/different medication courses held until explicit owner add-separately review', async () => {
  await accept('first-course', med());
  const staged = await repo.stageClinicalIntake(
    OWNER,
    scope,
    intake('other-course', { ...med(), administered_amount: { value: 0.5, unit: 'mL' } })
  );
  expect(staged.items[0].matches).toHaveLength(1);
  const result = await repo.approveClinicalIntake(OWNER, staged.id, {
    version: staged.version,
    digest: staged.digest,
  });
  expect(result.counts.unresolved).toBe(1);
  expect(await repo.listClinicalFacts(OWNER, scope, { kind: 'medication' })).toHaveLength(1);
  const separate = await accept(
    'reviewed-other-course',
    { ...med(), administered_amount: { value: 0.5, unit: 'mL' } },
    { reason: 'Reviewed as a distinct medication course.' }
  );
  expect(separate.counts.created).toBe(1);
  expect(await repo.listClinicalFacts(OWNER, scope, { kind: 'medication' })).toHaveLength(2);
});
it('skips only confirmed lab duplicate identity; preserves partial dates as review candidates', async () => {
  const fact = {
    ...lab({ kind: 'numeric', value: 5 }),
    raw_result: '5',
    accession_id: 'accession-A',
    collection_date: { precision: 'day', value: '2026-02-03' },
  };
  await accept('report-A', fact);
  expect((await accept('same-draw', fact)).counts.skipped).toBe(1);
  expect(
    (await accept('same-day-other-draw', { ...fact, accession_id: 'accession-B' })).counts
      .unresolved
  ).toBe(1);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 1 });
  expect(
    (
      await accept(
        'reviewed-same-day-other-draw',
        { ...fact, accession_id: 'accession-B' },
        { reason: 'Owner verified a distinct same-day draw.' }
      )
    ).counts.created
  ).toBe(1);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 2 });
});
it.each([
  ['report_id', 'unknown'],
  ['specimen_id', 'N/A'],
  ['accession_id', 'none'],
  ['report_id', ' UNKNOWN '],
  ['specimen_id', 'not available'],
  ['accession_id', 'Not Applicable'],
  ['report_id', 'not_reported'],
  ['specimen_id', 'null'],
  ['accession_id', '--'],
  ['report_id', 'pending'],
])(
  'does not confirm a duplicate from placeholder %s=%s; explicit separate review preserves both',
  async (field, value) => {
    const fact = {
      ...lab({ kind: 'numeric', value: 5 }),
      raw_result: '5',
      collection_date: { precision: 'day', value: '2026-02-03' },
      [field]: value,
    };
    await accept('first-uncertain-identity', fact);
    const preview = await repo.stageClinicalIntake(
      OWNER,
      scope,
      intake('same-uncertain-identity', fact)
    );
    expect(preview.items[0].matches[0].classification).toBe('possible');
    const held = await repo.approveClinicalIntake(OWNER, preview.id, {
      version: preview.version,
      digest: preview.digest,
    });
    expect(held.counts.unresolved).toBe(1);
    const separate = await accept('owner-separated-uncertain-identity', fact, {
      reason:
        'Owner verified a separate same-day result; placeholder identity is not a draw identifier.',
    });
    expect(separate.counts.created).toBe(1);
    expect(separate.counts.skipped).toBe(0);
    const records = await repo.listClinicalFacts(OWNER, scope, { kind: 'lab' });
    expect(records).toHaveLength(2);
    expect(records[0].fact).toMatchObject({ [field]: value.trim() });
  }
);
it('fences subjects, source-document references and new owner approval from delegates/shares', async () => {
  insertDependent(ctx.sqlite, 'child', OWNER);
  insertDependent(ctx.sqlite, 'other-child', STRANGER);
  insertDelegate(ctx.sqlite, { ownerId: OWNER, delegateUserId: VIEWER, permissionLevel: 'admin' });
  insertShare(ctx.sqlite, { ownerId: OWNER, sharedWithId: STRANGER, sections: ['labs'] });
  const preview = await repo.stageClinicalIntake(
    OWNER,
    { ownerId: OWNER, dependentId: 'child' },
    intake('child', lab())
  );
  await repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  expect(await repo.listClinicalFacts(OWNER, scope)).toEqual([]);
  expect(
    await repo.listClinicalFacts(VIEWER, { ownerId: OWNER, dependentId: 'child' }, { kind: 'lab' })
  ).toHaveLength(1);
  await expect(repo.getClinicalIntake(VIEWER, preview.id)).rejects.toThrow('Not found');
  await expect(
    repo.stageClinicalIntake(
      VIEWER,
      { ownerId: OWNER, dependentId: 'child' },
      intake('delegate', lab())
    )
  ).rejects.toThrow('Not found');
  await expect(
    repo.stageClinicalIntake(
      OWNER,
      { ownerId: OWNER, dependentId: 'other-child' },
      intake('wrong', lab())
    )
  ).rejects.toThrow('Not found');
  await expect(
    repo.stageClinicalIntake(
      OWNER,
      scope,
      intake('wrong-source', {
        ...lab(),
        provenance: { ...evidence, sources: [{ reference: 'other', document_id: 'not-owned' }] },
      })
    )
  ).rejects.toThrow('source document');
  await expect(repo.getClinicalIntake(OWNER, preview.id, true)).rejects.toThrow('Not found');
});
it.each(['accession_id', 'specimen_id', 'report_id'])(
  'still distinguishes identical and distinct real %s values',
  async (field) => {
    const fact = {
      ...lab({ kind: 'numeric', value: 5 }),
      raw_result: '5',
      collection_date: { precision: 'day', value: '2026-02-03' },
      [field]: 'Fictional-real-A',
    };
    expect((await accept('first-real-identity', fact)).counts.created).toBe(1);
    expect((await accept('same-real-identity', fact)).counts.skipped).toBe(1);
    expect(
      (
        await accept(
          'different-real-identity',
          { ...fact, [field]: 'Fictional-real-B' },
          { reason: 'Owner verified a different collection/report.' }
        )
      ).counts.created
    ).toBe(1);
    expect(await repo.listClinicalFacts(OWNER, scope, { kind: 'lab' })).toHaveLength(2);
  }
);
it('preserves structured prescription/actual use and only explicitly recorded missed/skipped events', async () => {
  await accept('medication', med());
  const medication = (await repo.listClinicalFacts(OWNER, scope, { kind: 'medication' }))[0];
  expect(medication.fact).toMatchObject(med());
  const event = {
    kind: 'medication_event',
    medication_id: medication.id,
    event: 'intentional_skip',
    event_date: { precision: 'day', value: '2026-02-03' },
    notes: 'Reported before a lab draw',
    provenance: { basis: 'patient_reported' },
  };
  await accept('explicit-skip', event);
  const events = await repo.listClinicalFacts(OWNER, scope, { kind: 'medication_event' });
  expect(events).toHaveLength(1);
  expect(events[0].fact).toMatchObject(event);
  insertDependent(ctx.sqlite, 'child', OWNER);
  await expect(
    repo.stageClinicalIntake(
      OWNER,
      { ownerId: OWNER, dependentId: 'child' },
      intake('wrong-med-event', event)
    )
  ).rejects.toThrow('medication');
  expect(
    await repo.listClinicalFacts(
      OWNER,
      { ownerId: OWNER, dependentId: 'child' },
      { kind: 'medication_event' }
    )
  ).toEqual([]);
});
it('creates audited legacy overlays, omits superseded current projection and surfaces later legacy conflicts', async () => {
  const { createMedication, listMedications, updateMedication } =
    await import('@/lib/repos/medications');
  const legacy = await createMedication(OWNER, scope, {
    name: 'Legacy medication',
    dosage: '5 mg',
    active: true,
    startDate: 'approx 2020',
  });
  const original = (await repo.listClinicalFacts(OWNER, scope, { kind: 'medication' }))[0];
  expect(original.legacy).toBe(true);
  expect(original.received_at).toBeNull();
  const result = await accept(
    'legacy-overlay',
    { ...med(), name: 'Legacy medication' },
    {
      action: 'correct',
      target_id: original.id,
      expected_revision: original.revision,
      reason: 'Preserve full prescription evidence',
    }
  );
  expect(result.counts.corrected).toBe(1);
  expect(await listMedications(OWNER, scope)).toEqual([]);
  const overlay = (await repo.listClinicalFacts(OWNER, scope, { kind: 'medication' }))[0];
  expect(overlay.supersedes_legacy?.id).toBe(legacy.id);
  expect(overlay.legacy_conflict).toBe(false);
  expect(
    ctx.sqlite.prepare('SELECT dosage,start_date FROM medications WHERE id=?').get(legacy.id)
  ).toEqual({ dosage: '5 mg', start_date: 'approx 2020' });
  await updateMedication(OWNER, legacy.id, { dosage: '10 mg' });
  const conflicted = await repo.listClinicalFacts(OWNER, scope, { kind: 'medication' });
  expect(conflicted).toHaveLength(2);
  expect(conflicted.find((r) => !r.legacy)?.legacy_conflict).toBe(true);
  expect(await listMedications(OWNER, scope)).toEqual([]);
  expect(
    (await repo.clinicalProjectionCoverage(OWNER, scope, 'medication')).superseded_legacy_omitted
  ).toBe(1);
  const current = conflicted.find((r) => !r.legacy)!;
  expect(current.revision).not.toBe(overlay.revision);
});
