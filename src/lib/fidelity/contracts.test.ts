// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  clinicalDateSchema,
  labOutcomeSchema,
  formatLabOutcome,
  formatClinicalDate,
  unknownClinicalDate,
  intakeSchema,
  scanInputSchema,
} from './contracts';
import { approvalDigest, contentRevision, requireIntakeOwner } from './security';
describe('HF fidelity contract boundaries', () => {
  it.each(['2026-02-30', '2026-00-04', '2026-10'])('rejects an invented exact day %s', (value) =>
    expect(clinicalDateSchema.safeParse({ precision: 'day', value }).success).toBe(false)
  );
  it('preserves month/year/unknown evidence without a midnight', () => {
    for (const date of [
      { precision: 'year', value: '2026' },
      { precision: 'month', value: '2026-02' },
      unknownClinicalDate('Winter 2026'),
    ])
      expect(formatClinicalDate(clinicalDateSchema.parse(date))).not.toContain('T00');
    expect(formatClinicalDate(unknownClinicalDate('Winter 2026'))).toContain('precision unknown');
    expect(
      clinicalDateSchema.safeParse({ precision: 'instant', value: '2026-10-30T12:00:00' }).success
    ).toBe(false);
  });
  it('keeps censored, qualitative, canceled and genuine zero separate', () => {
    expect(
      formatLabOutcome(labOutcomeSchema.parse({ kind: 'censored', value: 5, comparator: '<' }))
    ).toBe('<5');
    expect(formatLabOutcome(labOutcomeSchema.parse({ kind: 'numeric', value: 0 }))).toBe('0');
    expect(formatLabOutcome(labOutcomeSchema.parse({ kind: 'text', text: 'Negative' }))).toBe(
      'Negative'
    );
    expect(
      formatLabOutcome(labOutcomeSchema.parse({ kind: 'canceled', reason: 'Specimen lost' }))
    ).toContain('Canceled');
    expect(labOutcomeSchema.safeParse({ kind: 'numeric', value: 5, comparator: '<' }).success).toBe(
      false
    );
  });
  it('binds approvals to exact content, subject, batch and version', () => {
    const baseline = approvalDigest('owner', null, 'batch', 1, [{ value: 0 }]);
    for (const [owner, subject, batch, version, items] of [
      ['owner', 'child', 'batch', 1, [{ value: 0 }]],
      ['owner', null, 'other', 1, [{ value: 0 }]],
      ['owner', null, 'batch', 2, [{ value: 0 }]],
      ['owner', null, 'batch', 1, [{ value: 5 }]],
    ] as const)
      expect(approvalDigest(owner, subject, batch, version, items)).not.toBe(baseline);
    expect(contentRevision({ b: 2, a: 1 })).toBe(contentRevision({ a: 1, b: 2 }));
    expect(() => requireIntakeOwner('delegate', 'owner')).toThrow('Owner approval');
  });
  it('requires selected correction revision and stable item keys', () => {
    const fact = {
      kind: 'lab',
      test_name: 'Fictional',
      outcome: { kind: 'text', text: 'Negative' },
      collection_date: unknownClinicalDate(),
      provenance: { basis: 'source_reported' },
    };
    expect(
      intakeSchema.safeParse({
        external_id: 'one',
        items: [{ item_key: 'a', action: 'correct', fact }],
      }).success
    ).toBe(false);
    expect(
      intakeSchema.safeParse({
        external_id: 'one',
        items: [
          { item_key: 'a', action: 'add', fact },
          { item_key: 'a', action: 'add', fact },
        ],
      }).success
    ).toBe(false);
  });
  it('requires explicit units and rejects duplicate metrics within one scan', () => {
    const scan = {
      external_id: 'same-day-repeat',
      source: 'Fictional BIA',
      method: 'bia',
      measured_at: { precision: 'day', value: '2026-10-30' },
      provenance: { basis: 'source_reported' },
      measurements: [{ metric_key: 'ecw_ratio', value: 0.37, unit: 'fraction' }],
    };
    expect(scanInputSchema.safeParse(scan).success).toBe(true);
    expect(
      scanInputSchema.safeParse({
        ...scan,
        measurements: [scan.measurements[0], scan.measurements[0]],
      }).success
    ).toBe(false);
  });
});
