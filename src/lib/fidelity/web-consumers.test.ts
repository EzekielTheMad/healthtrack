// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  mintApiToken,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import { clinicalFactSchema, type ClinicalFact, type FidelityRecord } from './contracts';
import { clinicalRecordIntersectsWindow, clinicalSummaryRow, scanSummaryRow } from './presentation';
import { encounterObservationSeries } from './web-clinical-presentation';
let ctx: RepoTestDb;
const scope = { ownerId: OWNER, dependentId: null };
const unknown = { precision: 'unknown', value: null } as const;
const day = (value: string) => ({ precision: 'day' as const, value });
const provenance = {
  basis: 'source_reported',
  sources: [{ reference: 'Fictional source', page: 2 }],
};
const clinicalFacts = () =>
  [
    {
      kind: 'encounter',
      name: 'Office encounter',
      encounter_date: day('2026-10-20'),
      observations: [
        {
          observation_key: 'hr',
          metric: 'heart_rate',
          quantity: { value: 83, unit: 'bpm' },
          context: 'office_spot',
        },
      ],
    },
    {
      kind: 'sleep_study',
      name: 'Diagnostic study',
      study_type: 'home_sleep_apnea_test',
      study_date: day('2026-10-21'),
      indices: [
        {
          key: 'ahi3',
          label: 'AHI 3%',
          value: 0,
          unit: 'events/h',
          definition: 'Source 3% definition',
        },
      ],
    },
    {
      kind: 'pap_report',
      name: 'Cross-window report',
      window_start: day('2026-09-01'),
      window_end: day('2026-11-15'),
      statistics: [
        { key: 'ahi', label: 'Residual AHI', value: 0, unit: 'events/h', statistic: 'mean' },
      ],
      adherence: [{ label: '4h nights', numerator: 0, denominator: null, count_unit: 'days' }],
    },
    {
      kind: 'screening',
      instrument: { name: 'Fictional survey', version: 'v1' },
      administration_date: unknown,
      record_type: 'administration',
      reported_total: 0,
      item_responses: [{ key: 'first', value: 0 }],
      functional_responses: [{ key: 'impact', value: 'Some difficulty' }],
      completeness: 'partial',
    },
    {
      kind: 'condition',
      name: 'Same name',
      certainty: 'suspected',
      activity: 'active',
      temporal_scope: 'historical',
    },
    {
      kind: 'procedure',
      name: 'Planned procedure',
      status: 'planned',
      events: [{ status: 'ordered', event_date: day('2026-10-22') }],
    },
    {
      kind: 'allergy_review',
      review_status: 'unknown',
      scope: 'Medication allergies',
      review_date: unknown,
    },
    {
      kind: 'genetic_report',
      name: 'Counseling',
      report_type: 'counseling',
      event_date: unknown,
      counseling_summary: 'Qualitative source discussion',
    },
  ].map((fact) => clinicalFactSchema.parse({ ...fact, provenance }));
async function commit(fact: ClinicalFact, external_id: string, dependentId: string | null = null) {
  const repo = await import('./clinical');
  const preview = await repo.stageClinicalIntake(
    OWNER,
    { ownerId: OWNER, dependentId },
    { external_id, items: [{ item_key: 'one', action: 'add', fact }] }
  );
  const result = await repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  expect(result.counts.created).toBe(1);
  return result;
}
const request = (path: string, token: string, body?: unknown) =>
  new NextRequest('http://localhost' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: 'Bearer ' + token,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(async () => {
  ctx = await setupRepoDb('wc-shared-consumers-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  insertDependent(ctx.sqlite, 'child', OWNER);
});
afterEach(() => ctx.restore());
it('retains explicitly conflicting encounters in labelled history while withholding their plotted points', () => {
  const fact = clinicalFactSchema.parse({
    ...clinicalFacts()[0],
    observations: [
      {
        observation_key: 'hr',
        metric: 'heart_rate',
        quantity: { value: 83, unit: 'bpm' },
        context: 'office_spot',
        statistic: 'spot',
      },
    ],
    provenance: { ...provenance, verification: 'conflict' },
  });
  const record = { id: 'conflict-encounter', kind: 'encounter', fact } as FidelityRecord;
  expect(encounterObservationSeries([record])).toEqual([]);
  expect(clinicalSummaryRow(record).lines.join(' ')).toContain('CONFLICT');
});
it('keeps all eight report kinds in their correct prompt domains, summaries, exports and patient scope', async () => {
  const facts = clinicalFacts();
  for (const fact of facts) await commit(fact, 'self-' + fact.kind);
  await commit(
    clinicalFactSchema.parse({ ...facts[4], name: 'Same name', notes: 'child-only evidence' }),
    'child-condition',
    'child'
  );
  const { buildHealthContext, contextForPrompt } = await import('@/lib/health-context');
  const snapshot = await buildHealthContext(OWNER, null, 30, new Date('2026-10-31T19:00:00Z'));
  expect(snapshot.context_version).toBe(4);
  expect(snapshot.facts.clinical_records).toHaveLength(8);
  expect(snapshot.facts.vitals).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain('child-only evidence');
  const prompt = contextForPrompt(snapshot);
  expect(prompt.medications_data).not.toContain('Cross-window report');
  expect(prompt.vitals_data).toContain('Cross-window report');
  expect(prompt.conditions_data).toContain('Fictional survey');
  expect(prompt.conditions_data).toContain('Some difficulty');
  expect(prompt.conditions_data).toContain('suspected');
  const papRef = snapshot.evidence.find(
    (r) => r.record_id === snapshot.facts.clinical_records.find((r) => r.kind === 'pap_report')?.id
  )!;
  expect(papRef.date).toBeNull(); // A window is not a daily measurement.
  const { buildDoctorSummary } = await import('@/lib/doctor-summary');
  const summary = await buildDoctorSummary(OWNER);
  expect(summary.sections).toContain('procedures');
  expect(summary.typedClinical).toHaveLength(8);
  const text = summary
    .typedClinical!.map(clinicalSummaryRow)
    .map((r) => JSON.stringify(r))
    .join('\n');
  expect(text).toContain('Aggregate report window');
  expect(text).toContain('not reported'); // Unknown denominator stays unknown.
  expect(text).toContain('Reported total: 0');
  const { exportFidelityData } = await import('./export');
  const exported = exportFidelityData(OWNER);
  expect(exported.clinical_records).toHaveLength(9); // Full owner export includes owned child.
  expect(exported.clinical_records.every((r) => r.user_id === OWNER)).toBe(true);
  const child = await buildHealthContext(OWNER, 'child', 30, new Date('2026-10-31T19:00:00Z'));
  expect(child.facts.clinical_records).toHaveLength(1);
  expect(JSON.stringify(child)).toContain('child-only evidence');
});
it('requires report opt-in on staging and readback while existing domain read scopes remain exact', async () => {
  const batchRoute = await import('@/app/api/v1/clinical-intake/route');
  const previewRoute = await import('@/app/api/v1/clinical-intake/[id]/route');
  const readRoute = await import('@/app/api/v1/clinical-records/route');
  const old = mintApiToken(ctx.sqlite, OWNER, ['write:clinical_intake']);
  const extended = mintApiToken(ctx.sqlite, OWNER, [
    'write:clinical_intake',
    'write:clinical_reports',
  ]);
  const input = {
    external_id: 'new-report',
    items: [{ item_key: 'one', action: 'add', fact: clinicalFacts()[3] }],
  };
  expect((await batchRoute.POST(request('/api/v1/clinical-intake', old, input))).status).toBe(403);
  const response = await batchRoute.POST(request('/api/v1/clinical-intake', extended, input));
  expect(response.status).toBe(201);
  const preview = await response.json();
  expect(
    (
      await previewRoute.GET(request('/api/v1/clinical-intake/' + preview.id, old), {
        params: Promise.resolve({ id: preview.id }),
      })
    ).status
  ).toBe(403);
  expect(
    (await (await batchRoute.GET(request('/api/v1/clinical-intake', old))).json()).batches
  ).toEqual([]);
  const repo = await import('./clinical');
  await repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  const target = (await repo.listClinicalFacts(OWNER, scope, { kind: 'screening' }))[0];
  const disguised = await repo.stageClinicalIntake(OWNER, scope, {
    external_id: 'owner-selected-target',
    items: [
      {
        item_key: 'old-kind-new-target',
        action: 'correct',
        target_id: target.id,
        expected_revision: target.revision,
        fact: clinicalFactSchema.parse({
          kind: 'lab',
          test_name: 'Fictional old kind',
          outcome: { kind: 'text', text: 'Not established' },
          collection_date: unknown,
          provenance,
        }),
      },
    ],
  });
  expect(disguised.items[0].matches.some((m) => m.id === target.id)).toBe(true);
  expect(
    (
      await previewRoute.GET(request('/api/v1/clinical-intake/' + disguised.id, old), {
        params: Promise.resolve({ id: disguised.id }),
      })
    ).status
  ).toBe(403);
  const listed = await (await batchRoute.GET(request('/api/v1/clinical-intake', old))).json();
  expect(listed.batches).toEqual([]);
  await commit(clinicalFacts()[0], 'encounter');
  const conditions = mintApiToken(ctx.sqlite, OWNER, ['read:conditions']);
  const result = await (
    await readRoute.GET(request('/api/v1/clinical-records', conditions))
  ).json();
  expect(result.records.map((r: FidelityRecord) => r.kind)).toEqual(['screening']);
  expect(result.coverage.unavailable_kinds).toContain('encounter');
  expect(
    (await readRoute.GET(request('/api/v1/clinical-records?kind=encounter', conditions))).status
  ).toBe(403);
});
it('keeps corrected legacy conditions and procedures out of current projections, retaining conflicts and original export evidence', async () => {
  const repos = {
    condition: await import('@/lib/repos/conditions'),
    procedure: await import('@/lib/repos/procedures'),
  };
  await repos.condition.createCondition(OWNER, scope, { name: 'Old condition' });
  await repos.procedure.createProcedure(OWNER, scope, {
    name: 'Old procedure',
    procedureDate: '2026-01-01',
  });
  const repo = await import('./clinical');
  for (const kind of ['condition', 'procedure'] as const) {
    const original = (await repo.listClinicalFacts(OWNER, scope, { kind }))[0];
    const fact = clinicalFactSchema.parse({
      ...original.fact,
      name: 'Corrected ' + kind,
      ...(kind === 'condition' ? { certainty: 'suspected' } : { status: 'cancelled' }),
    });
    const preview = await repo.stageClinicalIntake(OWNER, scope, {
      external_id: kind + '-correction',
      items: [
        {
          item_key: 'one',
          action: 'correct',
          target_id: original.id,
          expected_revision: original.revision,
          reason: 'Fictional source correction',
          fact,
        },
      ],
    });
    await repo.approveClinicalIntake(OWNER, preview.id, {
      version: preview.version,
      digest: preview.digest,
    });
  }
  expect(await repos.condition.listConditions(OWNER, scope)).toEqual([]);
  expect(await repos.procedure.listProcedures(OWNER, scope)).toEqual([]);
  const conditionRoute = await import('@/app/api/v1/conditions/route');
  const procedureRoute = await import('@/app/api/v1/procedures/route');
  const token = mintApiToken(ctx.sqlite, OWNER, ['read:conditions', 'read:procedures']);
  for (const [route, path] of [
    [conditionRoute, '/api/v1/conditions'],
    [procedureRoute, '/api/v1/procedures'],
  ] as const) {
    const response = await route.GET(request(path, token));
    expect(await response.json()).toEqual([]);
    expect(JSON.parse(response.headers.get('X-HealthTrack-Clinical-Coverage')!)).toMatchObject({
      superseded_legacy_omitted: 1,
      typed_records: 1,
    });
    expect(response.headers.get('Link')).toContain('/api/v1/clinical-records?kind=');
  }
  const { exportFidelityData } = await import('./export');
  expect(
    exportFidelityData(OWNER)
      .historical_source_rows.map((r) => r.table)
      .sort()
  ).toEqual(['conditions', 'procedures']);
  ctx.sqlite.prepare("UPDATE conditions SET notes='Changed source' WHERE user_id=?").run(OWNER);
  const { buildHealthContext } = await import('@/lib/health-context');
  const snapshot = await buildHealthContext(OWNER);
  expect(snapshot.facts.conditions).toEqual([]);
  expect(snapshot.facts.clinical_records.filter((r) => r.kind === 'condition')).toHaveLength(2);
  expect(snapshot.coverage.warnings.join(' ')).toContain('require review');
});
it('retains source vendor output and separate same-scan derivations in context, doctor summaries and exports', async () => {
  const { createBodyScan } = await import('./scans');
  const created = await createBodyScan(OWNER, scope, {
    external_id: 'extended',
    source: 'Fictional BIA',
    method: 'bia',
    measured_at: day('2026-10-30'),
    measurements: [
      { metric_key: 'weight', value: 80, unit: 'kg' },
      { metric_key: 'body_fat_mass', value: 20, unit: 'kg' },
      { metric_key: 'body_fat_pct', value: 24, unit: '%' },
      {
        metric_key: 'lean_mass_left_arm',
        value: 0,
        unit: 'kg',
        definition: 'Source regional lean',
      },
    ],
    vendor_results: {
      scores: [{ key: 'source', name: 'Vendor score', value: 0 }],
      recommendations: [
        { name: 'Vendor suggestion', text: 'Archived source advice', value: 0, unit: 'kg' },
      ],
    },
    provenance,
  });
  const { buildHealthContext, contextForPrompt } = await import('@/lib/health-context');
  const snapshot = await buildHealthContext(OWNER, null, 30, new Date('2026-10-31T19:00:00Z'));
  expect(
    snapshot.facts.body_scans[0].measurements.find((m) => m.metric_key === 'body_fat_pct')
      ?.source_value
  ).toBe(24);
  expect(
    snapshot.facts.body_scans[0].derived_measurements?.find((m) => m.metric_key === 'body_fat_pct')
      ?.value
  ).toBeCloseTo(25);
  expect(contextForPrompt(snapshot).vitals_data).toContain('not an adopted target');
  expect(scanSummaryRow(created.scan).lines.join(' ')).toContain('Vendor score');
  const { exportFidelityData } = await import('./export');
  expect(exportFidelityData(OWNER).body_scans[0].derived_measurements[0]).toMatchObject({
    basis: 'derived',
    value: 25,
  });
});
it('intersects report windows without requiring either endpoint to lie inside the query', () => {
  const record = (start: string, end: string) =>
    ({
      fact: {
        ...clinicalFacts()[2],
        kind: 'pap_report',
        window_start: day(start),
        window_end: day(end),
      },
    }) as FidelityRecord;
  expect(
    clinicalRecordIntersectsWindow(
      record('2026-09-01', '2026-11-15'),
      '2026-10-01',
      '2026-10-31',
      'America/Phoenix'
    )
  ).toBe(true);
  expect(
    clinicalRecordIntersectsWindow(
      record('2026-08-01', '2026-09-01'),
      '2026-10-01',
      '2026-10-31',
      'America/Phoenix'
    )
  ).toBe(false);
});
