import { describe, expect, it } from 'vitest';
import { reconcile, isFullDate, type Claim } from './reconcile';
const lab: Claim = {
  test_name: 'Synthetic marker',
  visit_date: '2026-01-02',
  value: 5,
  unit: 'mg',
};
describe('clinical identity evidence', () => {
  it('requires real calendar dates', () => {
    expect(isFullDate('2026-02-30')).toBe(false);
    expect(isFullDate('2026-02')).toBe(false);
    expect(isFullDate('2024-02-29')).toBe(true);
  });
  it('does not treat identical same-day lab values as exact without specimen evidence', () => {
    expect(reconcile('lab_results', lab, [{ id: 'one', values: lab }]).classification).toBe(
      'possible'
    );
    for (const collected_at of ['2026-01-02', null, 'unknown']) {
      const row = { ...lab, collected_at };
      expect(reconcile('lab_results', row, [{ id: 'one', values: row }]).classification).toBe(
        'possible'
      );
    }
  });
  it('recognizes a fully matching identified specimen, but multiple matching rows stay ambiguous', () => {
    const values = { ...lab, accession_id: 'printed-accession-123' };
    expect(reconcile('lab_results', values, [{ id: 'one', values }]).classification).toBe(
      'duplicate'
    );
    expect(
      reconcile('lab_results', values, [
        { id: 'one', values },
        { id: 'two', values },
      ]).classification
    ).toBe('possible');
  });
  it('rejects contradictory specimen identity even when accession and numeric values match', () => {
    const values = {
      ...lab,
      accession_id: 'shared-accession',
      specimen_id: 'tube-a',
      collected_at: '2026-01-02T10:00:00Z',
    };
    expect(
      reconcile('lab_results', { ...values, specimen_id: 'tube-b' }, [{ id: 'one', values }])
        .classification
    ).toBe('possible');
    expect(
      reconcile('lab_results', { ...values, collected_at: '2026-01-02T11:00:00Z' }, [
        { id: 'one', values },
      ]).classification
    ).toBe('possible');
  });
  it('keeps case-sensitive units distinct despite matching specimen identifiers', () => {
    const values = { ...lab, unit: 'mM', accession_id: 'printed-accession' };
    expect(
      reconcile('lab_results', { ...values, unit: 'mm' }, [{ id: 'one', values }]).classification
    ).toBe('conflict');
  });
  it('never confirms different printed LOINC codes from matching names and accessions', () => {
    const values = { ...lab, loinc_code: '718-7', accession_id: 'printed-accession' };
    expect(
      reconcile('lab_results', { ...values, loinc_code: '789-8' }, [{ id: 'one', values }])
        .classification
    ).toBe('conflict');
  });
  it('matches a renamed analyte by printed LOINC but still requires complete specimen/value/unit evidence', () => {
    const values = { ...lab, loinc_code: '718-7', accession_id: 'printed-accession' };
    const renamed = { ...values, test_name: 'A differently printed label' };
    expect(reconcile('lab_results', renamed, [{ id: 'one', values }]).classification).toBe(
      'duplicate'
    );
    expect(
      reconcile('lab_results', { ...renamed, accession_id: null }, [{ id: 'one', values }])
        .classification
    ).toBe('possible');
    expect(
      reconcile('lab_results', { ...renamed, unit: 'mG' }, [{ id: 'one', values }]).classification
    ).toBe('conflict');
    expect(
      reconcile('lab_results', { ...renamed, value: 8 }, [{ id: 'one', values }]).classification
    ).toBe('conflict');
  });
  it('holds differently named equal-value draws as possible alternatives without inferring identity', () => {
    const renamed = { ...lab, test_name: 'Another printed label' };
    expect(reconcile('lab_results', renamed, [{ id: 'one', values: lab }])).toMatchObject({
      classification: 'possible',
      matches: [{ id: 'one' }],
    });
    const identified = { ...lab, accession_id: 'printed-accession' };
    expect(
      reconcile('lab_results', { ...renamed, accession_id: 'printed-accession' }, [
        { id: 'one', values: identified },
      ]).classification
    ).toBe('possible');
    expect(
      reconcile('lab_results', { ...renamed, loinc_code: '789-8' }, [
        { id: 'one', values: { ...lab, loinc_code: '718-7' } },
      ]).classification
    ).toBe('new');
    expect(
      reconcile('lab_results', { ...renamed, specimen_id: 'tube-b' }, [
        { id: 'one', values: { ...lab, specimen_id: 'tube-a' } },
      ]).classification
    ).toBe('new');
  });
  it('same name and date alone cannot prove an event is a duplicate', () => {
    const values = { name: 'Synthetic procedure', procedure_date: '2026-01-02' };
    expect(reconcile('procedures', values, [{ id: 'one', values }]).classification).toBe(
      'possible'
    );
  });
  it('preserves changed medication doses and partial dates as review candidates', () => {
    const original = {
      name: 'Synthetic medication',
      start_date: '2026-01-02',
      dosage: '5 mg',
      active: true,
    };
    expect(
      reconcile('medications', { ...original, dosage: '10 mg' }, [{ id: 'one', values: original }])
        .classification
    ).toBe('conflict');
    expect(
      reconcile('medications', { ...original, start_date: '2026' }, [
        { id: 'one', values: original },
      ]).classification
    ).toBe('possible');
  });
});
