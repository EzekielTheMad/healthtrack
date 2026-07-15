/**
 * Pure unit tests for mergeExtractions — no DB, no I/O, so the default jsdom
 * environment is fine.
 */
import { describe, expect, it } from 'vitest';
import type {
  ExtractedAllergy,
  ExtractedCondition,
  ExtractedLabResult,
  ExtractedMedication,
  ExtractedProcedure,
  ExtractedVaccine,
  ParsedMedicalHistory,
} from '@/lib/claude/parse-medical-history';
import { mergeExtractions } from './merge-extractions';

// ---------------------------------------------------------------------------
// Factories (all optional fields default to null)
// ---------------------------------------------------------------------------

function medication(
  name: string,
  overrides: Partial<ExtractedMedication> = {},
): ExtractedMedication {
  return {
    name,
    dosage: null,
    frequency: null,
    start_date: null,
    end_date: null,
    active: null,
    notes: null,
    ...overrides,
  };
}

function condition(
  name: string,
  overrides: Partial<ExtractedCondition> = {},
): ExtractedCondition {
  return { name, status: null, diagnosed_date: null, notes: null, ...overrides };
}

function allergy(
  name: string,
  overrides: Partial<ExtractedAllergy> = {},
): ExtractedAllergy {
  return {
    name,
    severity: null,
    reaction: null,
    diagnosed_date: null,
    notes: null,
    ...overrides,
  };
}

function procedure(
  name: string,
  procedureDate: string | null,
  overrides: Partial<ExtractedProcedure> = {},
): ExtractedProcedure {
  return { name, procedure_date: procedureDate, notes: null, ...overrides };
}

function vaccine(
  name: string,
  vaccineDate: string | null,
  overrides: Partial<ExtractedVaccine> = {},
): ExtractedVaccine {
  return {
    name,
    vaccine_date: vaccineDate,
    dose_number: null,
    series_doses: null,
    manufacturer: null,
    lot_number: null,
    notes: null,
    ...overrides,
  };
}

function labResult(
  testName: string,
  value: number,
  overrides: Partial<ExtractedLabResult> = {},
): ExtractedLabResult {
  return {
    test_name: testName,
    value,
    unit: null,
    reference_range_text: null,
    flag: null,
    ...overrides,
  };
}

function part(overrides: Partial<ParsedMedicalHistory> = {}): ParsedMedicalHistory {
  return {
    medications: [],
    conditions: [],
    allergies: [],
    procedures: [],
    vaccines: [],
    lab_visits: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

describe('mergeExtractions basics', () => {
  it('returns an all-empty extraction for no parts', () => {
    expect(mergeExtractions([])).toEqual({
      medications: [],
      conditions: [],
      allergies: [],
      procedures: [],
      vaccines: [],
      lab_visits: [],
    });
  });

  it('passes a single part with distinct items through unchanged', () => {
    const single = part({
      medications: [medication('Lisinopril'), medication('Metformin')],
      conditions: [condition('Asthma')],
      allergies: [allergy('Penicillin')],
      procedures: [procedure('Tonsillectomy', '2023-06-01')],
      vaccines: [vaccine('MMR', '2020-09-15')],
      lab_visits: [
        { visit_date: '2024-02-10', results: [labResult('Hemoglobin', 13.5)] },
      ],
    });
    expect(mergeExtractions([single])).toEqual(single);
  });

  it('concatenates non-overlapping domains across parts', () => {
    const merged = mergeExtractions([
      part({ medications: [medication('Lisinopril')] }),
      part({ medications: [medication('Metformin')], conditions: [condition('Asthma')] }),
      part({ vaccines: [vaccine('Tdap', '2024-05-05')] }),
    ]);
    expect(merged.medications.map((m) => m.name)).toEqual(['Lisinopril', 'Metformin']);
    expect(merged.conditions.map((c) => c.name)).toEqual(['Asthma']);
    expect(merged.vaccines.map((v) => v.name)).toEqual(['Tdap']);
    expect(merged.allergies).toEqual([]);
    expect(merged.procedures).toEqual([]);
    expect(merged.lab_visits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Name-keyed domains (medications, conditions, allergies)
// ---------------------------------------------------------------------------

describe('mergeExtractions name-keyed domains', () => {
  it('collapses cross-chunk medication repeats by normalized name', () => {
    const merged = mergeExtractions([
      part({ medications: [medication('Lisinopril')] }),
      part({ medications: [medication('  LISINOPRIL ')] }),
      part({ medications: [medication('lisinopril')] }),
    ]);
    expect(merged.medications).toHaveLength(1);
  });

  it('normalizes internal whitespace when matching names', () => {
    const merged = mergeExtractions([
      part({ conditions: [condition('Type 2   Diabetes')] }),
      part({ conditions: [condition('type 2 diabetes')] }),
    ]);
    expect(merged.conditions).toHaveLength(1);
  });

  it('keeps the repeat with more non-null fields (later richer entry wins)', () => {
    const sparse = medication('Lisinopril');
    const rich = medication('Lisinopril', { dosage: '10mg', frequency: 'once daily' });
    const merged = mergeExtractions([
      part({ medications: [sparse] }),
      part({ medications: [rich] }),
    ]);
    expect(merged.medications).toEqual([rich]);
  });

  it('keeps the repeat with more non-null fields (earlier richer entry wins)', () => {
    const rich = allergy('Penicillin', { severity: 'severe', reaction: 'hives' });
    const sparse = allergy('penicillin');
    const merged = mergeExtractions([
      part({ allergies: [rich] }),
      part({ allergies: [sparse] }),
    ]);
    expect(merged.allergies).toEqual([rich]);
  });

  it('keeps the first entry on a field-count tie', () => {
    const first = condition('Asthma', { status: 'active' });
    const second = condition('asthma', { notes: 'seen 2021' });
    const merged = mergeExtractions([
      part({ conditions: [first] }),
      part({ conditions: [second] }),
    ]);
    expect(merged.conditions).toEqual([first]);
  });

  it('does not collapse distinct names (no substring matching)', () => {
    const merged = mergeExtractions([
      part({ medications: [medication('Lisinopril')] }),
      part({ medications: [medication('Lisinopril 10mg')] }),
    ]);
    expect(merged.medications).toHaveLength(2);
  });

  it('preserves first-seen order even when a later richer repeat replaces an entry', () => {
    const merged = mergeExtractions([
      part({ medications: [medication('Lisinopril'), medication('Metformin')] }),
      part({ medications: [medication('Lisinopril', { dosage: '10mg' })] }),
    ]);
    expect(merged.medications.map((m) => m.name)).toEqual(['Lisinopril', 'Metformin']);
    expect(merged.medications[0].dosage).toBe('10mg');
  });

  it('collapses repeats within a single part too', () => {
    const merged = mergeExtractions([
      part({ allergies: [allergy('Peanuts'), allergy('peanuts')] }),
    ]);
    expect(merged.allergies).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Name + date domains (procedures, vaccines)
// ---------------------------------------------------------------------------

describe('mergeExtractions name+date domains', () => {
  it('collapses procedures with the same name and date', () => {
    const merged = mergeExtractions([
      part({ procedures: [procedure('Tonsillectomy', '2023-06-01')] }),
      part({ procedures: [procedure('  tonsillectomy ', ' 2023-06-01 ')] }),
    ]);
    expect(merged.procedures).toHaveLength(1);
  });

  it('keeps same-name procedures with different dates as separate entries', () => {
    const merged = mergeExtractions([
      part({ procedures: [procedure('Colonoscopy', '2019-04-01')] }),
      part({ procedures: [procedure('Colonoscopy', '2024-04-01')] }),
    ]);
    expect(merged.procedures).toHaveLength(2);
  });

  it('keeps an undated entry separate from a dated entry with the same name', () => {
    const merged = mergeExtractions([
      part({ vaccines: [vaccine('Tdap', '2024-05-05')] }),
      part({ vaccines: [vaccine('Tdap', null)] }),
    ]);
    expect(merged.vaccines).toHaveLength(2);
  });

  it('treats a blank date like a missing date', () => {
    const merged = mergeExtractions([
      part({ procedures: [procedure('Colonoscopy', null)] }),
      part({ procedures: [procedure('Colonoscopy', '   ')] }),
    ]);
    expect(merged.procedures).toHaveLength(1);
  });

  it('collapses identical undated repeats', () => {
    const merged = mergeExtractions([
      part({ procedures: [procedure('Appendectomy', null)] }),
      part({ procedures: [procedure('appendectomy', null)] }),
    ]);
    expect(merged.procedures).toHaveLength(1);
  });

  it('keeps the vaccine repeat with more non-null fields', () => {
    const sparse = vaccine('MMR', '2020-09-15');
    const rich = vaccine('MMR', '2020-09-15', { dose_number: 1, manufacturer: 'Merck' });
    const merged = mergeExtractions([
      part({ vaccines: [sparse] }),
      part({ vaccines: [rich] }),
    ]);
    expect(merged.vaccines).toEqual([rich]);
  });

  it('keeps separate booster doses (same name, different dates) intact', () => {
    const merged = mergeExtractions([
      part({
        vaccines: [
          vaccine('COVID-19', '2021-01-15', { dose_number: 1 }),
          vaccine('COVID-19', '2021-02-15', { dose_number: 2 }),
        ],
      }),
      part({ vaccines: [vaccine('COVID-19', '2021-02-15', { dose_number: 2 })] }),
    ]);
    expect(merged.vaccines).toHaveLength(2);
    expect(merged.vaccines.map((v) => v.dose_number)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Lab visits
// ---------------------------------------------------------------------------

describe('mergeExtractions lab visits', () => {
  it('merges visits with the same date across chunks', () => {
    const merged = mergeExtractions([
      part({
        lab_visits: [
          { visit_date: '2024-02-10', results: [labResult('Hemoglobin', 13.5)] },
        ],
      }),
      part({
        lab_visits: [
          { visit_date: '2024-02-10', results: [labResult('Glucose', 92)] },
        ],
      }),
    ]);
    expect(merged.lab_visits).toHaveLength(1);
    expect(merged.lab_visits[0].visit_date).toBe('2024-02-10');
    expect(merged.lab_visits[0].results.map((r) => r.test_name)).toEqual([
      'Hemoglobin',
      'Glucose',
    ]);
  });

  it('merges visits whose dates differ only by surrounding whitespace', () => {
    const merged = mergeExtractions([
      part({
        lab_visits: [
          { visit_date: '2024-02-10', results: [labResult('Hemoglobin', 13.5)] },
        ],
      }),
      part({
        lab_visits: [
          { visit_date: ' 2024-02-10 ', results: [labResult('Glucose', 92)] },
        ],
      }),
    ]);
    expect(merged.lab_visits).toHaveLength(1);
  });

  it('keeps visits with different dates separate, in first-seen order', () => {
    const merged = mergeExtractions([
      part({
        lab_visits: [
          { visit_date: '2024-02-10', results: [labResult('Hemoglobin', 13.5)] },
        ],
      }),
      part({
        lab_visits: [
          { visit_date: '2023-11-01', results: [labResult('Hemoglobin', 12.9)] },
        ],
      }),
    ]);
    expect(merged.lab_visits.map((v) => v.visit_date)).toEqual([
      '2024-02-10',
      '2023-11-01',
    ]);
  });

  it('dedupes results within a merged visit by normalized test name, first wins', () => {
    const first = labResult('Hemoglobin', 13.5, { unit: 'g/dL' });
    const repeat = labResult('  HEMOGLOBIN ', 13.6);
    const merged = mergeExtractions([
      part({ lab_visits: [{ visit_date: '2024-02-10', results: [first] }] }),
      part({ lab_visits: [{ visit_date: '2024-02-10', results: [repeat] }] }),
    ]);
    expect(merged.lab_visits[0].results).toEqual([first]);
  });

  it('keeps the same test on different visit dates', () => {
    const merged = mergeExtractions([
      part({
        lab_visits: [
          { visit_date: '2024-02-10', results: [labResult('Hemoglobin', 13.5)] },
          { visit_date: '2023-11-01', results: [labResult('Hemoglobin', 12.9)] },
        ],
      }),
    ]);
    expect(merged.lab_visits).toHaveLength(2);
    expect(merged.lab_visits[0].results[0].value).toBe(13.5);
    expect(merged.lab_visits[1].results[0].value).toBe(12.9);
  });

  it('dedupes repeated results within a single visit', () => {
    const merged = mergeExtractions([
      part({
        lab_visits: [
          {
            visit_date: '2024-02-10',
            results: [labResult('Glucose', 92), labResult('glucose', 92)],
          },
        ],
      }),
    ]);
    expect(merged.lab_visits[0].results).toHaveLength(1);
  });
});
