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
  it('keeps native source identity and a readable package in app/API facts, evidence and doctor summaries', async () => {
    const source = 'hc:oXVka5w7YY-FL02zOl40n0VlJa6EoQFoRj6bZIpcjh0';
    const { createVital } = await import('./repos/vitals');
    await createVital(OWNER, { ownerId: OWNER, dependentId: null }, { metricKey: 'weight', value: 180, unit: 'lbs', source, recordedAt: '2026-10-22T00:00:00Z', metadata: { health_connect: true, source_package: 'com.example.scale' } });
    const { buildHealthContext, contextForPrompt } = await import('./health-context');
    const snapshot = await buildHealthContext(OWNER, null, 30, new Date('2026-10-23T20:00:00Z'));
    expect(snapshot.facts.vitals[0]).toMatchObject({ source, source_label: 'Health Connect · com.example.scale' });
    expect(snapshot.evidence.find((item) => item.domain === 'vitals')).toMatchObject({ source, source_label: 'Health Connect · com.example.scale' });
    expect(contextForPrompt(snapshot, 'weight').vitals_data).toContain('Health Connect · com.example.scale');
    const { buildDoctorSummary } = await import('./doctor-summary');
    expect((await buildDoctorSummary(OWNER)).vitals?.[0]).toMatchObject({ source, source_label: 'Health Connect · com.example.scale' });
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
