/**
 * Pure unit tests for the medical-history import dedupe helpers — no DB, so
 * the default jsdom environment is fine.
 */
import { describe, expect, it } from 'vitest';
import {
  addNameDate,
  buildLabResultIndex,
  buildNameDateIndex,
  buildNameIndex,
  dedupeByName,
  dedupeByNameDate,
  dedupeLabResult,
  labResultKey,
  normalizeDate,
  normalizeName,
} from './dedupe';

describe('normalizeName', () => {
  it('lowercases', () => {
    expect(normalizeName('Lisinopril')).toBe('lisinopril');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeName('  Amoxicillin  ')).toBe('amoxicillin');
  });

  it('collapses internal whitespace runs (spaces and tabs) to single spaces', () => {
    expect(normalizeName('Vitamin   D\t\t3')).toBe('vitamin d 3');
  });

  it('is idempotent', () => {
    const once = normalizeName('  Complete   Blood  Count ');
    expect(normalizeName(once)).toBe(once);
  });
});

describe('normalizeDate', () => {
  it('trims a date string', () => {
    expect(normalizeDate(' 2024-01-15 ')).toBe('2024-01-15');
  });

  it('returns null for null, undefined, empty, and whitespace-only', () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Name-only domains (medications, conditions, allergies)
// ---------------------------------------------------------------------------

describe('dedupeByName', () => {
  const index = buildNameIndex(['Lisinopril', '  Peanut   Allergy ', 'Asthma']);

  it('marks an exact name match as duplicate', () => {
    expect(dedupeByName('Asthma', index)).toBe('duplicate');
  });

  it('matches case-insensitively', () => {
    expect(dedupeByName('LISINOPRIL', index)).toBe('duplicate');
  });

  it('matches with differing whitespace', () => {
    expect(dedupeByName('peanut allergy', index)).toBe('duplicate');
    expect(dedupeByName('Peanut\tAllergy', index)).toBe('duplicate');
  });

  it('marks an unseen name as new', () => {
    expect(dedupeByName('Metformin', index)).toBe('new');
  });

  it('does not treat substrings as matches', () => {
    expect(dedupeByName('Lisinopril 10mg', index)).toBe('new');
  });

  it('returns new against an empty index', () => {
    expect(dedupeByName('Anything', buildNameIndex([]))).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// Name + date domains (procedures, vaccines)
// ---------------------------------------------------------------------------

describe('dedupeByNameDate', () => {
  const index = buildNameDateIndex([
    { name: 'Tonsillectomy', date: '2023-06-01' },
    { name: 'MMR', date: '2020-09-15' },
    { name: 'MMR', date: '2021-03-02' },
  ]);

  it('marks exact name + date match as duplicate', () => {
    expect(dedupeByNameDate('Tonsillectomy', '2023-06-01', index)).toBe('duplicate');
  });

  it('matches names case- and whitespace-insensitively', () => {
    expect(dedupeByNameDate('  tonsillectomy ', '2023-06-01', index)).toBe('duplicate');
  });

  it('trims item dates before comparing', () => {
    expect(dedupeByNameDate('MMR', ' 2020-09-15 ', index)).toBe('duplicate');
  });

  it('matches any of several dated rows with the same name', () => {
    expect(dedupeByNameDate('mmr', '2021-03-02', index)).toBe('duplicate');
  });

  it('marks a name match with a different date as possible', () => {
    expect(dedupeByNameDate('MMR', '2024-01-01', index)).toBe('possible');
  });

  it('marks a name match with no date as possible', () => {
    expect(dedupeByNameDate('Tonsillectomy', null, index)).toBe('possible');
    expect(dedupeByNameDate('Tonsillectomy', undefined, index)).toBe('possible');
    expect(dedupeByNameDate('Tonsillectomy', '  ', index)).toBe('possible');
  });

  it('marks an unseen name as new regardless of date', () => {
    expect(dedupeByNameDate('Appendectomy', '2023-06-01', index)).toBe('new');
    expect(dedupeByNameDate('Appendectomy', null, index)).toBe('new');
  });

  it('handles existing rows without dates as name-only (possible) matches', () => {
    const withUndated = buildNameDateIndex([{ name: 'Flu shot', date: null }]);
    expect(dedupeByNameDate('Flu Shot', '2024-10-01', withUndated)).toBe('possible');
    expect(dedupeByNameDate('Flu Shot', null, withUndated)).toBe('possible');
  });

  it('returns new against an empty index', () => {
    expect(dedupeByNameDate('Anything', '2024-01-01', buildNameDateIndex([]))).toBe('new');
  });

  it('addNameDate makes later items dedupe against a just-created row', () => {
    const batch = buildNameDateIndex([]);
    expect(dedupeByNameDate('Tdap', '2024-05-05', batch)).toBe('new');
    addNameDate(batch, 'Tdap', '2024-05-05');
    expect(dedupeByNameDate('Tdap', '2024-05-05', batch)).toBe('duplicate');
    expect(dedupeByNameDate('Tdap', '2025-05-05', batch)).toBe('possible');
  });

  it('addNameDate with no date only records the name', () => {
    const batch = buildNameDateIndex([]);
    addNameDate(batch, 'Colonoscopy', null);
    expect(dedupeByNameDate('Colonoscopy', '2024-05-05', batch)).toBe('possible');
  });
});

// ---------------------------------------------------------------------------
// Lab results (visit_date + test_name)
// ---------------------------------------------------------------------------

describe('dedupeLabResult', () => {
  const index = buildLabResultIndex([
    { visitDate: '2024-02-10', testName: 'Hemoglobin' },
    { visitDate: '2024-02-10', testName: 'WBC  Count' },
    { visitDate: '2023-11-01', testName: 'Hemoglobin' },
  ]);

  it('marks a visit_date + test_name match as duplicate', () => {
    expect(dedupeLabResult('2024-02-10', 'Hemoglobin', index)).toBe('duplicate');
  });

  it('matches test names case- and whitespace-insensitively', () => {
    expect(dedupeLabResult('2024-02-10', '  wbc count ', index)).toBe('duplicate');
  });

  it('trims the visit date before comparing', () => {
    expect(dedupeLabResult(' 2023-11-01 ', 'hemoglobin', index)).toBe('duplicate');
  });

  it('marks the same test on a different date as new', () => {
    expect(dedupeLabResult('2025-01-01', 'Hemoglobin', index)).toBe('new');
  });

  it('marks a different test on the same date as new', () => {
    expect(dedupeLabResult('2024-02-10', 'Glucose', index)).toBe('new');
  });

  it('marks results with no visit date as new (cannot be a confirmed duplicate)', () => {
    expect(dedupeLabResult(null, 'Hemoglobin', index)).toBe('new');
    expect(dedupeLabResult(undefined, 'Hemoglobin', index)).toBe('new');
    expect(dedupeLabResult('', 'Hemoglobin', index)).toBe('new');
  });

  it('returns new against an empty index', () => {
    expect(dedupeLabResult('2024-02-10', 'Hemoglobin', new Set())).toBe('new');
  });

  it('labResultKey supports in-batch dedupe via index.add', () => {
    const batch = buildLabResultIndex([]);
    expect(dedupeLabResult('2024-02-10', 'Glucose', batch)).toBe('new');
    batch.add(labResultKey('2024-02-10', 'Glucose'));
    expect(dedupeLabResult('2024-02-10', 'glucose', batch)).toBe('duplicate');
  });
});
