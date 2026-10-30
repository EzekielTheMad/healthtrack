import { describe, expect, it } from 'vitest';
import { mergeExtractions } from './merge-extractions';
import type { ParsedMedicalHistory } from '@/lib/claude/parse-medical-history';
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
describe('extraction merge preserves claims', () => {
  it('does not discard a different dose because a same-name record has more fields', () => {
    const base = {
      name: 'Example drug',
      dosage: '5 mg',
      frequency: null,
      start_date: null,
      end_date: null,
      active: null,
      notes: null,
    };
    const richer = { ...base, dosage: '10 mg', frequency: 'daily', notes: 'different episode' };
    expect(
      mergeExtractions([part({ medications: [base] }), part({ medications: [richer] })]).medications
    ).toEqual([base, richer]);
  });
  it('preserves conflicting and identical same-day labs for reconciliation, including unknown dates', () => {
    const a = {
      visit_date: '2026-01-01',
      results: [
        { test_name: 'Example', value: 5, unit: 'mg', reference_range_text: null, flag: null },
      ],
    };
    const b = { ...a, results: [{ ...a.results[0], value: 7 }] };
    const unknown = { ...a, visit_date: null };
    expect(
      mergeExtractions([part({ lab_visits: [a] }), part({ lab_visits: [b, a, unknown] })])
        .lab_visits
    ).toEqual([a, b, a, unknown]);
  });
  it('keeps partial dates and every domain in source order', () => {
    const a = part({
      procedures: [{ name: 'Example', procedure_date: '2025', notes: null }],
      conditions: [{ name: 'Example', status: null, diagnosed_date: '2025-03', notes: null }],
    });
    expect(mergeExtractions([a])).toEqual(a);
    expect(mergeExtractions([])).toEqual(part());
  });
});
