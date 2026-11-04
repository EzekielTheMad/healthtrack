// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  mintApiToken,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from './repos/repo-test-harness';
let ctx: RepoTestDb;
const dep = 'dependent-context-fixture';
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v2-context-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  insertDependent(ctx.sqlite, dep, OWNER);
});
afterEach(() => {
  ctx.restore();
  vi.unstubAllEnvs();
});

describe('shared health facts and doctor summary', () => {
  it('uses the latest draw across legacy and typed-only labs in doctor summaries', async () => {
    const labs = await import('./repos/labs');
    const clinical = await import('./fidelity/clinical');
    const scope = { ownerId: OWNER, dependentId: null };
    await labs.createLabVisitWithResults(OWNER, scope, {
      visitDate: '2026-01-01',
      results: [{ testName: 'Fictional mixed analyte', value: 7, unit: 'mg/L' }],
    });
    const preview = await clinical.stageClinicalIntake(OWNER, scope, {
      external_id: 'mixed-latest',
      items: [
        {
          item_key: 'one',
          action: 'add',
          reason: 'Separate fictional October draw',
          fact: {
            kind: 'lab',
            test_name: 'Fictional mixed analyte',
            source_unit: 'mg/L',
            outcome: { kind: 'censored', value: 5, comparator: '<' },
            raw_result: '<5',
            collection_date: { precision: 'day', value: '2026-10-01' },
            provenance: { basis: 'source_reported' },
          },
        },
      ],
    });
    const result = await clinical.approveClinicalIntake(OWNER, preview.id, {
      version: preview.version,
      digest: preview.digest,
    });
    expect(result.counts.created).toBe(1);
    const { buildDoctorSummary } = await import('./doctor-summary');
    const summary = await buildDoctorSummary(OWNER);
    expect(summary.labResults).toHaveLength(0);
    expect(summary.typedClinical?.filter((r) => r.fact.kind === 'lab')).toHaveLength(1);
    await labs.createLabVisitWithResults(OWNER, scope, {
      visitDate: '2026-10-01',
      results: [{ testName: 'Fictional mixed analyte', value: 6, unit: 'mg/L' }],
    });
    expect((await buildDoctorSummary(OWNER)).labResults?.map((r) => r.value)).toEqual([6]);
    await labs.createLabVisitWithResults(OWNER, scope, {
      visitDate: '2026-10-02',
      results: [{ testName: 'Fictional mixed analyte', value: 4, unit: 'mg/L' }],
    });
    const newest = await buildDoctorSummary(OWNER);
    expect(newest.labResults?.map((r) => r.value)).toEqual([4]);
    expect(newest.typedClinical?.filter((r) => r.fact.kind === 'lab')).toHaveLength(0);
  });
  it('never exposes a superseded legacy numeric result as current and retains explicit conflict evidence', async () => {
    const labs = await import('./repos/labs');
    const clinical = await import('./fidelity/clinical');
    const visit = await labs.createLabVisitWithResults(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      {
        visitDate: '2026-10-30',
        results: [{ testName: 'Fictional overlay analyte', value: 7, unit: 'mg/L' }],
      }
    );
    const before = (
      await clinical.listClinicalFacts(
        OWNER,
        { ownerId: OWNER, dependentId: null },
        { kind: 'lab' }
      )
    ).find((r) => r.legacy)!;
    const fact = {
      kind: 'lab',
      test_name: 'Fictional overlay analyte',
      outcome: { kind: 'censored', value: 5, comparator: '<' },
      raw_result: '<5.00',
      source_unit: 'mg/L',
      collection_date: { precision: 'day', value: '2026-10-30' },
      reference: { text: 'Not established' },
      printed_flags: [],
      provenance: { basis: 'source_reported' },
    };
    const preview = await clinical.stageClinicalIntake(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      {
        external_id: 'overlay-summary',
        items: [
          {
            item_key: 'one',
            action: 'correct',
            target_id: before.id,
            expected_revision: before.revision,
            reason: 'Fictional source correction',
            fact,
          },
        ],
      }
    );
    await clinical.approveClinicalIntake(OWNER, preview.id, {
      version: preview.version,
      digest: preview.digest,
    });
    const { buildHealthContext, contextForPrompt } = await import('./health-context');
    const { buildDoctorSummary } = await import('./doctor-summary');
    const snapshot = await buildHealthContext(OWNER, null, 30, new Date('2026-10-31T19:00:00Z'));
    expect(snapshot.facts.labs).toHaveLength(0);
    expect(snapshot.facts.clinical_records).toHaveLength(1);
    expect(contextForPrompt(snapshot).lab_results_data).toContain('"comparator":"<"');
    const summary = await buildDoctorSummary(OWNER);
    expect(summary.labResults).toHaveLength(0);
    expect(summary.typedClinical?.[0].fact).toMatchObject({
      raw_result: '<5.00',
      reference: { text: 'Not established' },
    });
    await labs.updateLabVisit(OWNER, visit.id, {
      results: [{ id: visit.labResults[0].id, value: 9 }],
      reason: 'Fictional changed original evidence',
    });
    const changed = await buildHealthContext(OWNER, null, 30, new Date('2026-10-31T19:00:00Z'));
    expect(changed.fingerprint).not.toBe(snapshot.fingerprint);
    expect(changed.facts.labs).toHaveLength(0);
    expect(changed.facts.clinical_records).toHaveLength(2);
    expect(changed.coverage.warnings.join(' ')).toContain('require review');
  });
  it('keeps scan source/precision/evidence consistent and changes cache fingerprints after new scans', async () => {
    const { createBodyScan } = await import('./fidelity/scans');
    const { buildHealthContext, contextForPrompt } = await import('./health-context');
    const scope = { ownerId: OWNER, dependentId: null };
    const input = {
      external_id: 'one',
      source: 'Fictional A',
      manufacturer: 'Synthetic',
      model: 'BIA-A',
      method: 'bia',
      measured_at: { precision: 'day', value: '2026-10-30' },
      measurements: [{ metric_key: 'skeletal_muscle_mass', value: 31.2345, unit: 'kg' }],
      provenance: { basis: 'source_reported', sources: [{ reference: 'Fictional report' }] },
    };
    await createBodyScan(OWNER, scope, input);
    const before = await buildHealthContext(OWNER, null, 30, new Date('2026-10-31T19:00:00Z'));
    await createBodyScan(OWNER, scope, { ...input, external_id: 'two', source: 'Fictional B' });
    await createBodyScan(
      OWNER,
      { ownerId: OWNER, dependentId: dep },
      { ...input, external_id: 'child', source: 'Child-only source' }
    );
    const after = await buildHealthContext(OWNER, null, 30, new Date('2026-10-31T19:00:00Z'));
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.facts.body_scans).toHaveLength(2);
    expect(JSON.stringify(after)).not.toContain('Child-only source');
    expect(after.facts.scan_selection.policy).toBe('choice_required');
    expect(after.evidence.filter((e) => e.domain === 'scans')).toHaveLength(2);
    expect(contextForPrompt(after).vitals_data).toContain('source_value');
    const { setVitalSourcePreference } = await import('./repos/vitals');
    await setVitalSourcePreference(OWNER, 'skeletal_muscle_mass', 'Fictional A');
    const { buildDoctorSummary } = await import('./doctor-summary');
    const summary = await buildDoctorSummary(OWNER);
    expect(summary.bodyScans).toHaveLength(1);
    expect(summary.bodyScans![0].scan.source).toBe('Fictional A');
  });
  it('keeps native source identity and a readable package in app/API facts, evidence and doctor summaries', async () => {
    const source = 'hc:oXVka5w7YY-FL02zOl40n0VlJa6EoQFoRj6bZIpcjh0';
    const { createVital } = await import('./repos/vitals');
    await createVital(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      {
        metricKey: 'weight',
        value: 180,
        unit: 'lbs',
        source,
        recordedAt: '2026-10-22T00:00:00Z',
        metadata: { health_connect: true, source_package: 'com.example.scale' },
      }
    );
    const { buildHealthContext, contextForPrompt } = await import('./health-context');
    const snapshot = await buildHealthContext(OWNER, null, 30, new Date('2026-10-23T20:00:00Z'));
    expect(snapshot.facts.vitals[0]).toMatchObject({
      source,
      source_label: 'Health Connect · com.example.scale',
    });
    expect(snapshot.evidence.find((item) => item.domain === 'vitals')).toMatchObject({
      source,
      source_label: 'Health Connect · com.example.scale',
    });
    expect(contextForPrompt(snapshot, 'weight').vitals_data).toContain(
      'Health Connect · com.example.scale'
    );
    const { buildDoctorSummary } = await import('./doctor-summary');
    expect((await buildDoctorSummary(OWNER)).vitals?.[0]).toMatchObject({
      source,
      source_label: 'Health Connect · com.example.scale',
    });
  });
  it('uses the configured local day for true intraday observations and validates references', async () => {
    vi.stubEnv('TZ', 'America/Phoenix');
    const { createVital } = await import('./repos/vitals');
    const scope = { ownerId: OWNER, dependentId: null };
    await createVital(OWNER, scope, {
      metricKey: 'blood_glucose',
      value: 101,
      unit: 'mg/dL',
      source: 'manual',
      recordedAt: '2026-10-24T05:00:00Z',
    });
    await createVital(OWNER, scope, {
      metricKey: 'blood_glucose',
      value: 202,
      unit: 'mg/dL',
      source: 'manual',
      recordedAt: '2026-10-24T08:00:00Z',
    });
    const { buildHealthContext, contextForPrompt, validateAnswerReferences } =
      await import('./health-context');
    const snapshot = await buildHealthContext(OWNER, null, 30, new Date('2026-10-23T20:00:00Z'));
    expect(snapshot.facts.vitals.map((row) => row.value)).toEqual([101]);
    const source = snapshot.evidence.find((item) => item.domain === 'vitals')!;
    expect(contextForPrompt(snapshot, 'blood glucose').vitals_data).toContain(source.record_id);
    expect(
      validateAnswerReferences(`[${source.key}] [vitals:invented]`, snapshot.evidence)
    ).toContain('[reference unavailable]');
    expect(validateAnswerReferences(`[${source.key}]`, snapshot.evidence)).toContain('](/vitals)');
  });
  it('keeps patient medication history separate, preserves dates, and changes fingerprint after corrections', async () => {
    const meds = await import('./repos/medications');
    const ownerMed = await meds.createMedication(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      { name: 'Example course', active: false, startDate: '2020-01-02', endDate: '2021-02-03' }
    );
    await meds.createMedication(
      OWNER,
      { ownerId: OWNER, dependentId: dep },
      { name: 'Dependent-only medication', startDate: '2026-01-01' }
    );
    const { buildHealthContext } = await import('./health-context');
    const now = new Date('2026-10-23T12:00:00Z');
    const first = await buildHealthContext(OWNER, null, 90, now);
    expect(first.facts.medications.map((m) => m.name)).toEqual(['Example course']);
    expect(first.facts.medications[0]).toMatchObject({ start_date: '2020-01-02', active: false });
    const child = await buildHealthContext(OWNER, dep, 90, now);
    expect(child.facts.medications.map((m) => m.name)).toEqual(['Dependent-only medication']);
    expect(child.coverage.unavailable_domains).toContain('nutrition');
    await expect(buildHealthContext(STRANGER, dep, 90, now)).rejects.toMatchObject({ status: 404 });
    await meds.updateMedication(OWNER, ownerMed.id, { startDate: '2020-02-02' });
    expect((await buildHealthContext(OWNER, null, 90, now)).fingerprint).not.toBe(
      first.fingerprint
    );
    await expect(buildHealthContext(OWNER, null, 500, now)).rejects.toThrow();
  });

  it('selects one daily source and cites real records; document import time does not change latest draw', async () => {
    const { createVital } = await import('./repos/vitals');
    const scope = { ownerId: OWNER, dependentId: null };
    await createVital(OWNER, scope, {
      metricKey: 'steps',
      value: 6000,
      recordedAt: '2026-10-20T00:00:00Z',
      source: 'oura',
    });
    const accepted = await createVital(OWNER, scope, {
      metricKey: 'steps',
      value: 7000,
      recordedAt: '2026-10-20T00:00:00Z',
      source: 'health_connect_daily',
    });
    const visit = (
      date: string,
      value: number,
      created: string,
      dependentId: string | null = null
    ) => {
      const id = randomUUID();
      ctx.sqlite
        .prepare(
          'insert into lab_visits(id,user_id,dependent_id,visit_date,created_at) values(?,?,?,?,?)'
        )
        .run(id, OWNER, dependentId, date, created);
      ctx.sqlite
        .prepare(
          'insert into lab_results(id,user_id,dependent_id,lab_visit_id,test_name,value,unit,created_at) values(?,?,?,?,?,?,?,?)'
        )
        .run(randomUUID(), OWNER, dependentId, id, 'Example analyte', value, 'unit', created);
    };
    visit('2026-10-20', 20, '2026-10-20');
    visit('2025-01-01', 10, '2026-10-23');
    visit('2026-10-22', 999, '2026-10-22', dep);
    const { buildHealthContext } = await import('./health-context');
    const snapshot = await buildHealthContext(OWNER, null, 90, new Date('2026-10-23T12:00:00Z'));
    expect(snapshot.facts.vitals.map((r) => r.value)).toEqual([7000]);
    expect(snapshot.evidence.find((e) => e.record_id === accepted.id)).toMatchObject({
      source: 'health_connect_daily',
      href: '/vitals',
    });
    const { buildDoctorSummary } = await import('./doctor-summary');
    const report = await buildDoctorSummary(OWNER);
    expect(report.labResults).toHaveLength(1);
    expect(report.labResults?.[0]).toMatchObject({
      value: 20,
      visit_date: '2026-10-20',
      flag: 'unknown',
    });
    expect((await buildDoctorSummary(OWNER, dep)).labResults?.[0].value).toBe(999);
  });

  it('new PAT context endpoint requires read:all and cannot select a different patient', async () => {
    const { GET } = await import('@/app/api/v1/context/route');
    const request = (token?: string, suffix = '') =>
      new NextRequest(`http://localhost/api/v1/context${suffix}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request(mintApiToken(ctx.sqlite, OWNER, ['read:vitals'])))).status).toBe(403);
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:all']);
    const response = await GET(request(token, `?days=90&dependent_id=${dep}&owner_id=${STRANGER}`));
    expect(response.status).toBe(200);
    expect((await response.json()).dependent_id).toBeNull();
    expect((await GET(request(token, '?days=7'))).status).toBe(400);
  });
});
