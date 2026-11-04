// @vitest-environment node
import { beforeEach, afterEach, it, expect } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertShare,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import { clinicalFactSchema, type ClinicalFact } from './contracts';
import { clinicalFactDate, webClinicalSummaryRow } from './web-clinical-presentation';
import { encounterObservationSeries } from './web-clinical-presentation';
import { CLINICAL_KIND_SECTIONS } from './web-clinical-contracts';
let ctx: RepoTestDb;
let repo: typeof import('./clinical');
const scope = { ownerId: OWNER, dependentId: null };
const day = { precision: 'day', value: '2026-01-02' } as const;
const unknown = { precision: 'unknown', value: null } as const;
const provenance = {
  basis: 'source_reported',
  verification: 'unconfirmed',
  sources: [{ reference: 'Fictional report' }],
} as const;
const facts = () =>
  [
    {
      kind: 'encounter',
      name: 'Fictional encounter',
      encounter_date: day,
      encounter_id: 'visit-one',
      observations: [
        {
          observation_key: 'hr-first',
          metric: 'heart_rate',
          quantity: { value: 0, unit: 'bpm' },
          context: 'office_spot',
        },
        {
          observation_key: 'hr-repeat',
          metric: 'heart_rate',
          quantity: { value: 82, unit: 'bpm' },
          context: 'office_spot',
        },
        {
          observation_key: 'height',
          metric: 'height',
          quantity: { value: 180, unit: 'cm' },
          context: 'office_spot',
        },
      ],
      provenance,
    },
    {
      kind: 'sleep_study',
      name: 'Fictional sleep study',
      study_type: 'polysomnography',
      study_date: day,
      study_id: 'study-one',
      indices: [
        {
          key: 'ahi-3',
          label: 'AHI (3%)',
          value: 0,
          unit: 'events/h',
          statistic: 'reported',
          definition: 'Printed 3% desaturation definition',
        },
      ],
      oxygen_statistics: [{ label: 'Oxygen nadir', statistic: 'minimum', value: 82, unit: '%' }],
      time_below_thresholds: [
        {
          label: 'Time below 88%',
          comparator: '<',
          threshold_percent: 88,
          duration: { value: 0, unit: 'min' },
        },
      ],
      provenance,
    },
    {
      kind: 'pap_report',
      name: 'Fictional PAP report',
      window_start: day,
      window_end: { precision: 'month', value: '2026-02' },
      report_id: 'pap-one',
      therapy: 'apap',
      statistics: [
        {
          key: 'ahi',
          label: 'Residual AHI',
          value: 0,
          unit: 'events/h',
          statistic: 'mean',
          averaging_denominator: { label: 'Therapy hours', value: null, unit: 'h' },
        },
      ],
      adherence: [
        {
          label: 'At least 4h',
          numerator: 0,
          denominator: null,
          count_unit: 'days',
          threshold: { value: 4, unit: 'h' },
          threshold_comparator: '>=',
        },
      ],
      provenance,
    },
    {
      kind: 'screening',
      instrument: { name: 'Fictional screening', version: 'source-v1' },
      administration_date: unknown,
      record_type: 'administration',
      reported_total: 0,
      item_responses: [{ key: 'one', value: 0 }],
      functional_responses: [{ key: 'impact', value: 'Some difficulty' }],
      completeness: 'partial',
      qualitative_result: 'As reported',
      provenance,
    },
    {
      kind: 'condition',
      name: 'Fictional condition',
      certainty: 'suspected',
      activity: 'active',
      temporal_scope: 'historical',
      onset_date: { precision: 'year', value: '2020', approximate: true },
      codes: [{ system: 'ICD-10', code: 'TEST' }],
      provenance,
    },
    {
      kind: 'procedure',
      name: 'Fictional procedure',
      status: 'planned',
      events: [{ status: 'ordered', event_date: day }],
      codes: [{ system: 'Source system', code: 'ORDER' }],
      provenance,
    },
    {
      kind: 'allergy_review',
      review_status: 'unknown',
      review_date: unknown,
      scope: 'Medication allergies',
      provenance,
    },
    {
      kind: 'genetic_report',
      name: 'Fictional counseling',
      report_type: 'counseling',
      event_date: unknown,
      findings: [
        {
          label: 'Source finding',
          qualitative_result: 'Uncertain significance',
          gene: 'TEST',
          variant: 'source text',
          reported_classification: 'as printed',
        },
      ],
      counseling_summary: 'Source discussion',
      provenance,
    },
  ].map((f) => clinicalFactSchema.parse(f));
async function stage(fact: ClinicalFact, external_id = crypto.randomUUID(), extra = {}) {
  return repo.stageClinicalIntake(OWNER, scope, {
    external_id,
    items: [{ item_key: 'one', action: 'add', fact, ...extra }],
  });
}
async function approve(preview: Awaited<ReturnType<typeof stage>>) {
  return repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
}
beforeEach(async () => {
  ctx = await setupRepoDb('wc-clinical-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  repo = await import('./clinical');
});
afterEach(() => ctx.restore());
it('previews, accepts, reloads and retries all eight new kinds without daily writes', async () => {
  for (const fact of facts()) {
    const preview = await stage(fact);
    const before = (
      ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get() as { n: number }
    ).n;
    expect(preview.counts.pending).toBe(1);
    const done = await approve(preview);
    expect(done.counts.created).toBe(1);
    const record = await repo.getClinicalFact(OWNER, scope, done.items[0].outcome!.record_id!);
    expect(record.fact).toEqual(fact);
    expect(record.received_at).toMatch(/^\d{4}-/);
    expect((await approve(preview)).counts.created).toBe(1);
    expect(
      (ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get() as { n: number }).n
    ).toBe(before + 1);
    expect(webClinicalSummaryRow(record).lines.join('\n')).toContain('Fictional report');
  }
  expect(await repo.listClinicalFacts(OWNER, scope)).toHaveLength(8);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM vitals').get()).toEqual({ n: 0 });
});
it('keeps same-day encounters separate without report identity and skips only equal identified reports', async () => {
  const encounter = facts()[0];
  await approve(await stage(encounter));
  expect((await approve(await stage(encounter))).counts.skipped).toBe(1);
  const unidentified = { ...encounter, encounter_id: undefined };
  const preview = await stage(unidentified);
  expect(preview.items[0].matches[0].classification).toBe('conflict');
  expect((await approve(preview)).counts.unresolved).toBe(1);
  expect(
    (await approve(await stage(unidentified, undefined, { reason: 'A separate same-day visit' })))
      .counts.created
  ).toBe(1);
});
it.each(['condition', 'procedure'] as const)(
  'adapts legacy %s honestly and audits selected overlays/conflicts',
  async (kind) => {
    if (kind === 'condition')
      ctx.sqlite
        .prepare(
          "INSERT INTO conditions(id,user_id,name,status,diagnosed_date,created_at,updated_at)VALUES('old',?,'Fictional legacy','monitoring','2020','2026-01-01','2026-01-01')"
        )
        .run(OWNER);
    else
      ctx.sqlite
        .prepare(
          "INSERT INTO procedures(id,user_id,name,procedure_date,created_at,updated_at)VALUES('old',?,'Fictional legacy','2020','2026-01-01','2026-01-01')"
        )
        .run(OWNER);
    const legacy = await repo.getClinicalFact(OWNER, scope, `legacy:${kind}:old`);
    expect(legacy.fact).toMatchObject(
      kind === 'condition'
        ? { certainty: 'unknown', activity: 'unknown', temporal_scope: 'unknown' }
        : { status: 'unknown' }
    );
    const corrected = clinicalFactSchema.parse({ ...legacy.fact, name: 'Corrected source title' });
    const done = await approve(
      await stage(corrected, undefined, {
        action: 'correct',
        target_id: legacy.id,
        expected_revision: legacy.revision,
        reason: 'Verified source correction',
      })
    );
    expect(done.counts.corrected).toBe(1);
    const id = done.items[0].outcome!.record_id!;
    expect((await repo.listClinicalFacts(OWNER, scope, { kind })).map((r) => r.id)).toEqual([id]);
    ctx.sqlite
      .prepare(
        `UPDATE ${kind === 'condition' ? 'conditions' : 'procedures'} SET notes='Source changed' WHERE id='old'`
      )
      .run();
    const current = await repo.getClinicalFact(OWNER, scope, id);
    expect(current.legacy_conflict).toBe(true);
    const preview = await stage(current.fact, undefined, {
      action: 'correct',
      target_id: id,
      expected_revision: current.revision,
      reason: 'Reconcile source change',
    });
    const rows = await repo.listClinicalFacts(OWNER, scope, { kind });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.legacy_conflict)).toBe(true);
    await approve(preview);
    expect((await repo.getClinicalFact(OWNER, scope, id)).legacy_conflict).toBe(false);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_corrections').get()).toEqual({
      n: 2,
    });
  }
);
it('protects copied screening/document references and rechecks target revision and kind', async () => {
  const dep = 'fictional-dependent';
  insertDependent(ctx.sqlite, dep, OWNER);
  const screening = facts().find((f) => f.kind === 'screening')!;
  const created = await approve(await stage(screening));
  const id = created.items[0].outcome!.record_id!;
  const copied = { ...screening, record_type: 'copied_history', copied_from_record_id: id };
  await expect(
    repo.stageClinicalIntake(
      OWNER,
      { ownerId: OWNER, dependentId: dep },
      { external_id: 'other-person', items: [{ item_key: 'one', action: 'add', fact: copied }] }
    )
  ).rejects.toThrow('not available for this person');
  await expect(
    stage({
      ...screening,
      provenance: { ...provenance, sources: [{ reference: 'Protected', document_id: 'missing' }] },
    } as ClinicalFact)
  ).rejects.toThrow('source document');
  const record = await repo.getClinicalFact(OWNER, scope, id);
  const preview = await stage(record.fact, undefined, {
    action: 'correct',
    target_id: id,
    expected_revision: record.revision,
    reason: 'Test correction',
  });
  ctx.sqlite.prepare('UPDATE clinical_records SET revision=revision+1 WHERE id=?').run(id);
  await expect(approve(preview)).rejects.toThrow('changed');
  const wrong = await stage(facts()[0], undefined, {
    action: 'correct',
    target_id: id,
    expected_revision: (await repo.getClinicalFact(OWNER, scope, id)).revision,
    reason: 'Wrong kind',
  });
  await expect(approve(wrong)).rejects.toThrow('not available');
});
it('authorizes each kind through its own section rather than medication permission', async () => {
  for (const f of facts()) await approve(await stage(f));
  insertShare(ctx.sqlite, { ownerId: OWNER, sharedWithId: VIEWER, sections: ['labs'] });
  const rows = await repo.listClinicalFacts(VIEWER, scope);
  expect(rows).toEqual([]);
});
it('keeps report dates separate from unknown clinical dates and PAP windows', () => {
  for (const f of facts()) {
    const clinical = clinicalFactDate(f);
    if (f.kind === 'pap_report') expect(clinical).toBeUndefined();
    if (f.kind === 'screening' || f.kind === 'genetic_report') expect(clinical).toEqual(unknown);
  }
});
it.each([
  'encounter',
  'sleep_study',
  'pap_report',
  'screening',
  'condition',
  'procedure',
  'allergy_review',
  'genetic_report',
] as const)(
  'requires the %s authorization section for both listing and direct read',
  async (kind) => {
    for (const fact of facts()) await approve(await stage(fact));
    const section = CLINICAL_KIND_SECTIONS[kind];
    insertShare(ctx.sqlite, { ownerId: OWNER, sharedWithId: VIEWER, sections: [section] });
    const rows = await repo.listClinicalFacts(VIEWER, scope);
    expect(rows.every((r) => CLINICAL_KIND_SECTIONS[r.kind] === section)).toBe(true);
    const record = rows.find((r) => r.kind === kind)!;
    expect((await repo.getClinicalFact(VIEWER, scope, record.id)).kind).toBe(kind);
    const forbidden = (await repo.listClinicalFacts(OWNER, scope)).find(
      (r) => CLINICAL_KIND_SECTIONS[r.kind] !== section
    )!;
    await expect(repo.getClinicalFact(VIEWER, scope, forbidden.id)).rejects.toThrow();
  }
);
it('keeps overlapping PAP windows independent and audits corrections for every new kind', async () => {
  for (const fact of facts()) {
    const done = await approve(await stage(fact));
    const original = await repo.getClinicalFact(OWNER, scope, done.items[0].outcome!.record_id!);
    const corrected = clinicalFactSchema.parse({
      ...original.fact,
      notes: 'Explicitly corrected source wording',
    });
    const changed = await approve(
      await stage(corrected, undefined, {
        action: 'correct',
        target_id: original.id,
        expected_revision: original.revision,
        reason: 'Owner selected source correction',
      })
    );
    expect(changed.counts.corrected).toBe(1);
    expect((await repo.getClinicalFact(OWNER, scope, original.id)).fact).toEqual(corrected);
  }
  const pap = facts().find((f) => f.kind === 'pap_report')!;
  const overlap = clinicalFactSchema.parse({
    ...pap,
    report_id: 'different-report',
    window_start: { precision: 'day', value: '2026-01-10' },
  });
  expect(
    (await approve(await stage(overlap, undefined, { reason: 'Separate overlapping report' })))
      .counts.created
  ).toBe(1);
  expect(await repo.listClinicalFacts(OWNER, scope, { kind: 'pap_report' })).toHaveLength(2);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_corrections').get()).toEqual({ n: 8 });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM vitals').get()).toEqual({ n: 0 });
});
it('uses exact subject matching and invalidates a preview when its protected source reference disappears', async () => {
  const dep = 'fictional-child';
  insertDependent(ctx.sqlite, dep, OWNER);
  const fact = facts()[0];
  await approve(await stage(fact));
  const preview = await repo.stageClinicalIntake(
    OWNER,
    { ownerId: OWNER, dependentId: dep },
    { external_id: 'same-name-child', items: [{ item_key: 'one', action: 'add', fact }] }
  );
  expect(preview.items[0].matches).toEqual([]);
  const child = await approve(preview);
  const childId = child.items[0].outcome!.record_id!;
  await expect(repo.getClinicalFact(OWNER, scope, childId)).rejects.toThrow();
  const target = await repo.getClinicalFact(OWNER, { ownerId: OWNER, dependentId: dep }, childId);
  const wrongSubject = await stage(fact, undefined, {
    action: 'correct',
    target_id: childId,
    expected_revision: target.revision,
    reason: 'Other subject target',
  });
  await expect(approve(wrongSubject)).rejects.toThrow('not available');
  const screening = facts().find((f) => f.kind === 'screening')!;
  const saved = await approve(await stage(screening));
  const sourceId = saved.items[0].outcome!.record_id!;
  const copied = clinicalFactSchema.parse({
    ...screening,
    record_type: 'copied_history',
    copied_from_record_id: sourceId,
  });
  const staged = await stage(copied, undefined, { reason: 'Copied history retained separately' });
  ctx.sqlite.prepare('DELETE FROM clinical_records WHERE id=?').run(sourceId);
  await expect(approve(staged)).rejects.toThrow('changed');
});
it('plots only comparable actual encounter observations, retaining same-day repeats and recorded zero', () => {
  const fact = facts()[0];
  if (fact.kind !== 'encounter') throw new Error('Fixture');
  const observed = clinicalFactSchema.parse({
    ...fact,
    observations: fact.observations.map((o) => ({ ...o, statistic: 'spot' })),
  });
  const record = {
    id: 'one',
    kind: 'encounter',
    fact: observed,
  } as import('./contracts').FidelityRecord;
  const series = encounterObservationSeries([record]);
  const pulse = series.find((s) => s.label === 'heart rate')!;
  expect(pulse.points.map((p) => p.value)).toEqual([0, 82]);
  expect(encounterObservationSeries([{ ...record, legacy_conflict: true }])).toEqual([]);
  const unknownDate = clinicalFactSchema.parse({
    ...observed,
    encounter_date: { precision: 'month', value: '2026-01' },
  });
  expect(encounterObservationSeries([{ ...record, fact: unknownDate }])).toEqual([]);
  const differentContext = clinicalFactSchema.parse({
    ...observed,
    observations: fact.observations.map((o) => ({ ...o, statistic: 'spot', context: 'home_spot' })),
  });
  expect(
    encounterObservationSeries([record, { ...record, id: 'two', fact: differentContext }])
  ).toHaveLength(4);
  const instantRecord = (id: string, instant: string) => ({
    ...record,
    id,
    fact: clinicalFactSchema.parse({
      ...observed,
      encounter_date: { precision: 'instant', value: instant },
    }),
  });
  const acrossOffsets = encounterObservationSeries([
    instantRecord('earlier', '2026-01-02T09:00:00+02:00'),
    instantRecord('later', '2026-01-02T08:00:00-07:00'),
  ]);
  expect(acrossOffsets[0].points.map((p) => p.record_id)).toEqual([
    'earlier',
    'earlier',
    'later',
    'later',
  ]);
});
