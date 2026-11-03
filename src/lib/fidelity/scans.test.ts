// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertDelegate,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { ScanInput } from './contracts';
let ctx: RepoTestDb;
let repo: typeof import('./scans');
const scope = { ownerId: OWNER, dependentId: null };
function fixture(id = 'report-1', source = 'Fictional BIA'): ScanInput {
  return {
    external_id: id,
    source,
    manufacturer: 'Fictional',
    model: '570',
    method: 'bia',
    measured_at: { precision: 'day', value: '2026-10-30' },
    conditions: { workout_status: 'unknown', fasting_status: 'unknown' },
    provenance: {
      basis: 'source_reported',
      verification: 'unconfirmed',
      sources: [{ reference: 'Fictional report', page: 2 }],
    },
    measurements: [
      { metric_key: 'skeletal_muscle_mass', value: 31.1234, unit: 'kg', raw_text: '31.1234 kg' },
      { metric_key: 'ecw_ratio', value: 37.2, unit: '%' },
    ],
  };
}
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-scans-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  repo = await import('./scans');
});
afterEach(() => ctx.restore());
it('retains authorized legacy supplement references without inferring current use', async () => {
  ctx.sqlite
    .prepare(
      "INSERT INTO medications(id,user_id,name,category,active,created_at,updated_at)VALUES('old-supplement',?,'Fictional creatine','supplement',0,'legacy','legacy')"
    )
    .run(OWNER);
  const input = { ...fixture(), supplement_record_ids: ['legacy:medication:old-supplement'] };
  const result = await repo.createBodyScan(OWNER, scope, input);
  expect(result.scan.scan.supplement_record_ids).toEqual(['legacy:medication:old-supplement']);
  await expect(
    repo.createBodyScan(VIEWER, { ownerId: VIEWER, dependentId: null }, input)
  ).rejects.toMatchObject({ status: 400 });
});
it('stores unrounded canonical mass, raw source evidence and server receipt without changing legacy vitals', async () => {
  const result = await repo.createBodyScan(OWNER, scope, fixture());
  expect(result.scan.measurements[0]).toMatchObject({
    source_value: 31.1234,
    source_unit: 'kg',
    raw_text: '31.1234 kg',
    estimated: true,
  });
  expect(result.scan.measurements[0].value).toBe(31.1234 * 2.2046226218487757);
  expect(result.scan.measurements[1].value).toBe(0.37200000000000005);
  expect(result.scan.scan.measured_at).toEqual({ precision: 'day', value: '2026-10-30' });
  expect(result.scan.received_at).toMatch(/T/);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM vitals').get()).toEqual({ n: 0 });
  expect(await repo.getBodyScan(OWNER, scope, result.scan.id)).toEqual(result.scan);
});
it('replays one identity, rejects changed content and preserves distinct same-day scans', async () => {
  const first = await repo.createBodyScan(OWNER, scope, fixture());
  expect((await repo.createBodyScan(OWNER, scope, fixture())).scan.id).toBe(first.scan.id);
  await expect(
    repo.createBodyScan(OWNER, scope, { ...fixture(), model: 'Changed' })
  ).rejects.toMatchObject({ status: 409 });
  await repo.createBodyScan(OWNER, scope, fixture('report-2'));
  expect(await repo.listBodyScans(OWNER, scope)).toHaveLength(2);
  expect(repo.selectCoherentScan(await repo.listBodyScans(OWNER, scope)).scan).toBeNull();
});
it('round-trips ten regional outputs, vendor evidence and separate ratios through replay and selection', async () => {
  const regional = ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'trunk'].flatMap((region) => [
    {
      metric_key: `lean_mass_${region}`,
      value: 3.123456,
      unit: 'kg',
      definition: 'Regional lean soft tissue, not skeletal muscle',
    },
    { metric_key: `fat_mass_${region}`, value: 0, unit: 'kg', raw_text: '0.000 kg' },
  ]);
  const input = {
    ...fixture('regional'),
    measurements: [
      ...regional,
      { metric_key: 'weight', value: 80, unit: 'kg' },
      { metric_key: 'body_fat_mass', value: 20, unit: 'kg' },
      { metric_key: 'total_body_water', value: 40, unit: 'kg' },
      { metric_key: 'extracellular_water', value: 16, unit: 'kg' },
      { metric_key: 'ecw_ratio', value: 0.39, unit: 'fraction' },
    ],
    vendor_results: {
      scores: [{ key: 'score', name: 'Vendor score', value: 0, reference: { low: 0, high: 100 } }],
      body_age: { value: 'Below reference', unit: 'years' },
      reference_bands: [],
      recommendations: [
        { name: 'Weight control', text: 'Source recommendation', value: 0, unit: 'kg' },
      ],
    },
  };
  const created = await repo.createBodyScan(OWNER, scope, input);
  expect(created.scan.scan.vendor_results).toEqual(input.vendor_results);
  expect(
    created.scan.measurements.slice(0, 10).map((measurement) => measurement.metric_key)
  ).toEqual(regional.map((measurement) => measurement.metric_key));
  expect(created.scan.measurements[0].definition).toBe(regional[0].definition);
  expect(
    created.scan.measurements.find((measurement) => measurement.metric_key === 'ecw_ratio')?.value
  ).toBe(0.39);
  expect(
    created.scan.derived_measurements?.map((measurement) => [
      measurement.metric_key,
      measurement.value,
    ])
  ).toEqual([
    ['ecw_ratio', 0.4],
    ['body_fat_pct', 25],
    ['body_water_pct', 50],
  ]);
  expect((await repo.createBodyScan(OWNER, scope, input)).scan).toEqual(created.scan);
  const rows = await repo.listBodyScans(OWNER, scope);
  expect(repo.selectCoherentScan(rows).scan).toEqual(created.scan);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM vitals').get()).toEqual({ n: 0 });
  const changed = { ...input, vendor_results: { ...input.vendor_results, scores: [] } };
  await expect(repo.createBodyScan(OWNER, scope, changed)).rejects.toMatchObject({ status: 409 });
  await expect(
    repo.createBodyScan(OWNER, scope, {
      ...input,
      derived_measurements: created.scan.derived_measurements,
    })
  ).rejects.toThrow();
});
it('fences owner/dependent/share references and keeps legacy delegate permissions', async () => {
  insertDependent(ctx.sqlite, 'child', OWNER);
  await repo.createBodyScan(OWNER, { ownerId: OWNER, dependentId: 'child' }, fixture());
  expect(await repo.listBodyScans(OWNER, scope)).toEqual([]);
  await expect(
    repo.listBodyScans(VIEWER, { ownerId: OWNER, dependentId: 'child' })
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    repo.createBodyScan(VIEWER, { ownerId: VIEWER, dependentId: 'child' }, fixture())
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    repo.createBodyScan(OWNER, scope, { ...fixture(), supplement_record_ids: ['other-person'] })
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    repo.createBodyScan(OWNER, scope, {
      ...fixture(),
      provenance: {
        ...fixture().provenance,
        sources: [{ reference: 'Protected other document', document_id: 'other-person' }],
      },
    })
  ).rejects.toMatchObject({ status: 400 });
  insertDelegate(ctx.sqlite, {
    ownerId: OWNER,
    delegateUserId: VIEWER,
    permissionLevel: 'read_only',
  });
  await expect(repo.createBodyScan(VIEWER, scope, fixture())).rejects.toMatchObject({
    status: 404,
  });
});
it('rejects unsupported units/metrics, duplicate fields and fake numerics while preserving zero', async () => {
  for (const measurement of [
    { metric_key: 'total_body_water', value: 40, unit: 'L' },
    { metric_key: 'ecw_ratio', value: 37, unit: 'fraction' },
    { metric_key: 'unsupported_metric', value: 7, unit: 'degrees' },
  ])
    await expect(
      repo.createBodyScan(OWNER, scope, { ...fixture(), measurements: [measurement] })
    ).rejects.toMatchObject({ status: 400 });
  const result = await repo.createBodyScan(OWNER, scope, {
    ...fixture(),
    measurements: [{ metric_key: 'visceral_fat_area', value: 0, unit: 'cm2' }],
  });
  expect(result.scan.measurements[0]).toMatchObject({ value: 0, unit: 'cm²' });
});
it('honors source preferences and never uses late receipt/unknown dates as latest', async () => {
  await repo.createBodyScan(OWNER, scope, {
    ...fixture('older'),
    measured_at: { precision: 'instant', value: '2026-09-01T10:00:00-07:00' },
  });
  const recent = await repo.createBodyScan(OWNER, scope, {
    ...fixture('recent'),
    measured_at: { precision: 'instant', value: '2026-10-01T10:00:00-07:00' },
  });
  await repo.createBodyScan(OWNER, scope, {
    ...fixture('late-historical'),
    measured_at: { precision: 'day', value: '2020-01-01' },
  });
  await repo.createBodyScan(OWNER, scope, {
    ...fixture('unknown'),
    measured_at: { precision: 'unknown', value: null, original_text: 'Autumn' },
  });
  await repo.createBodyScan(OWNER, scope, fixture('device-two', 'Other BIA'));
  const rows = await repo.listBodyScans(OWNER, scope);
  expect(repo.selectCoherentScan(rows).scan).toBeNull();
  expect(repo.selectCoherentScan(rows, { skeletal_muscle_mass: 'Fictional BIA' }).scan?.id).toBe(
    recent.scan.id
  );
  expect(repo.selectCoherentScan(rows, { skeletal_muscle_mass: 'Missing device' }).scan).toBeNull();
  expect(repo.selectCoherentScan(rows, {}, 'Fictional BIA').warnings.join(' ')).toContain(
    'unknown'
  );
});
it('does not make approximate dates exact or sort offset timestamps lexically', async () => {
  const older = await repo.createBodyScan(OWNER, scope, {
    ...fixture('older'),
    measured_at: { precision: 'instant', value: '2026-10-30T23:00:00+10:00' },
  });
  const later = await repo.createBodyScan(OWNER, scope, {
    ...fixture('later'),
    measured_at: { precision: 'instant', value: '2026-10-30T15:00:00Z' },
  });
  await repo.createBodyScan(OWNER, scope, {
    ...fixture('approx'),
    measured_at: { precision: 'day', value: '2027-12-31', approximate: true },
  });
  const rows = await repo.listBodyScans(OWNER, scope);
  expect(rows.findIndex((row) => row.id === later.scan.id)).toBeLessThan(
    rows.findIndex((row) => row.id === older.scan.id)
  );
  expect(repo.selectCoherentScan(rows).scan?.id).toBe(later.scan.id);
});
