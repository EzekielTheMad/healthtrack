// @vitest-environment node
import { expect, it } from 'vitest';
import {
  clinicalSummaryRow,
  clinicalDoctorRecords,
  dateIntersectsWindow,
  scanSummaryRow,
} from './presentation';
import {
  labFactSchema,
  medicationFactSchema,
  unknownClinicalDate,
  type FidelityRecord,
  type BodyScan,
} from './contracts';
const base = {
  id: 'fixture',
  user_id: 'owner',
  dependent_id: null,
  revision: 'r1',
  received_at: '2026-10-31T00:00:00Z',
  updated_at: '2026-10-31T00:00:00Z',
};
it('selects latest typed lab draw dates despite historical records imported later', () => {
  const fact = (date: string) =>
    labFactSchema.parse({
      kind: 'lab',
      test_name: 'Fictional',
      outcome: { kind: 'numeric', value: 0 },
      collection_date: { precision: 'day', value: date },
      provenance: { basis: 'source_reported' },
    });
  const old = {
    ...base,
    id: 'late-import-old-draw',
    kind: 'lab',
    fact: fact('2020-01-02'),
    received_at: '2026-10-31T00:00:00Z',
  } as FidelityRecord;
  const recent = {
    ...base,
    id: 'recent-draw',
    kind: 'lab',
    fact: fact('2026-10-30'),
    received_at: '2026-10-30T00:00:00Z',
  } as FidelityRecord;
  expect(
    clinicalDoctorRecords([old, recent], 'America/Phoenix').records.map((row) => row.id)
  ).toEqual(['recent-draw']);
});
it('ranks legacy and typed lab dates together without collapsing same-day draws or uncertain history', () => {
  const typed = (id: string, day: string, approximate = false): FidelityRecord => ({
    ...base,
    id,
    kind: 'lab',
    fact: labFactSchema.parse({
      kind: 'lab',
      test_name: 'Fictional',
      source_unit: 'mg/L',
      outcome: { kind: 'censored', value: 5, comparator: '<' },
      collection_date: { precision: 'day', value: day, approximate },
      provenance: { basis: 'source_reported' },
    }),
  });
  const latest = typed('latest', '2026-10-01');
  const sameDay = typed('another-draw', '2026-10-01');
  const old = typed('old', '2026-01-01');
  const approximate = typed('uncertain', '2027-01-01', true);
  const legacy = (visitDate: string) => ({ testName: 'Fictional', unit: 'mg/L', visitDate });
  const recentTyped = clinicalDoctorRecords(
    [old, latest, sameDay, approximate],
    'America/Phoenix',
    [legacy('2026-01-01')]
  );
  expect(recentTyped.records.map((r) => r.id)).toEqual(['latest', 'another-draw', 'uncertain']);
  expect(recentTyped.latestLabDates.get('fictional@@mg/L')).toBe('2026-10-01');
  const recentLegacy = clinicalDoctorRecords([latest, approximate], 'America/Phoenix', [
    legacy('2026-10-02'),
  ]);
  expect(recentLegacy.records.map((r) => r.id)).toEqual(['uncertain']);
  expect(recentLegacy.warnings.join(' ')).toContain('uncertain history');
});
it('retains censored source evidence, textual ranges and printed/derived differences in summaries', () => {
  const fact = labFactSchema.parse({
    kind: 'lab',
    test_name: 'Fictional result',
    outcome: { kind: 'censored', value: 5, comparator: '<' },
    raw_result: '<5.00',
    source_unit: 'unit',
    collection_date: { precision: 'month', value: '2020-02' },
    reference: { text: 'Not established' },
    printed_flags: ['H'],
    derived_flag: 'unknown',
    provenance: { basis: 'source_reported', sources: [{ reference: 'Fictional report', page: 2 }] },
  });
  const row = clinicalSummaryRow({ ...base, kind: 'lab', fact });
  expect(row.title).toContain('<5');
  expect(row.date).toBe('2020-02');
  expect(row.lines.join('\n')).toContain('Not established');
  expect(row.lines.join('\n')).toContain('Printed flags: H');
  expect(row.lines.join('\n')).toContain('Derived interpretation (not a printed flag): unknown');
  expect(row.lines.join('\n')).toContain('<5.00');
});
it('keeps split instructions, strength, amount and reported actual use independently visible', () => {
  const fact = medicationFactSchema.parse({
    kind: 'medication',
    name: 'Fictional',
    supplement: true,
    status: 'unconfirmed',
    product_strength: { value: 10, unit: 'mg/mL' },
    administered_amount: { value: 0.2, unit: 'mL' },
    prescribed_directions: 'Twice weekly',
    patient_reported_use: 'Once weekly',
    schedule: [
      { weekday: 1, amount: { value: 0.2, unit: 'mL' } },
      { weekday: 4, amount: { value: 0.1, unit: 'mL' } },
    ],
    start_date: unknownClinicalDate('Around 2020'),
    provenance: { basis: 'patient_reported' },
  });
  const row = clinicalSummaryRow({ ...base, kind: 'medication', fact } as FidelityRecord);
  const text = row.lines.join('\n');
  expect(text).toContain('Product strength: 10 mg/mL');
  expect(text).toContain('Reported amount: 0.2 mL');
  expect(text).toContain('Twice weekly');
  expect(text).toContain('Once weekly');
  expect(text).toContain('Monday');
  expect(text).toContain('Thursday');
  expect(row.date).toContain('precision unknown');
});
it('filters partial dates at their own precision and preserves unknown uncertainty', () => {
  expect(
    dateIntersectsWindow(
      { precision: 'year', value: '2026' },
      '2026-09-01',
      '2026-10-31',
      'America/Phoenix'
    )
  ).toBe(true);
  expect(
    dateIntersectsWindow(
      { precision: 'month', value: '2025-11' },
      '2026-09-01',
      '2026-10-31',
      'America/Phoenix'
    )
  ).toBe(false);
  expect(
    dateIntersectsWindow(unknownClinicalDate(), '2026-09-01', '2026-10-31', 'America/Phoenix')
  ).toBe(true);
});
it('retains coherent source/device/raw units and estimate/overlap warnings in scan summaries', () => {
  const scan = {
    ...base,
    scan: {
      source: 'Fictional BIA',
      external_id: 'scan1',
      method: 'bia',
      model: 'Synthetic',
      measured_at: unknownClinicalDate(),
      measurements: [],
      provenance: { basis: 'source_reported', verification: 'unconfirmed', sources: [] },
    },
    measurements: [
      {
        metric_key: 'ecw_ratio',
        value: 0.372,
        unit: 'fraction',
        source_value: 37.2,
        source_unit: '%',
        estimated: true,
      },
    ],
  } as BodyScan;
  const row = scanSummaryRow(scan);
  expect(row.title).toContain('estimates');
  expect(row.date).toBe('Date unknown');
  expect(row.lines.join('\n')).toContain('37.2 %');
  expect(row.lines.join('\n')).toContain('0.372 fraction');
  expect(row.lines.join('\n')).toContain('must not be added together');
});
