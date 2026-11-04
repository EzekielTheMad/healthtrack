// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clinicalFactSchema, CLINICAL_KINDS, scanInputSchema, WEB_SCAN_METRICS } from './contracts';
const day = { precision: 'day', value: '2026-01-02' } as const;
const unknown = { precision: 'unknown', value: null } as const;
const provenance = { basis: 'source_reported', verification: 'unconfirmed', sources: [] } as const;
describe('WC1 shared contracts', () => {
  it('retains distinct encounter pulse and historical height with same-day repeats', () => {
    const fact = clinicalFactSchema.parse({
      kind: 'encounter',
      name: 'Fictional visit',
      encounter_date: day,
      observations: [
        {
          observation_key: 'a',
          metric: 'heart_rate',
          quantity: { value: 0, unit: 'bpm' },
          context: 'office_spot',
        },
        {
          observation_key: 'b',
          metric: 'heart_rate',
          quantity: { value: 82, unit: 'bpm' },
          context: 'office_spot',
        },
        {
          observation_key: 'c',
          metric: 'height',
          quantity: { value: 180.25, unit: 'cm' },
          context: 'office_spot',
        },
      ],
      provenance,
    });
    expect(fact.kind).toBe('encounter');
    expect(JSON.stringify(fact)).not.toContain('resting_hr');
    expect(
      clinicalFactSchema.safeParse({
        ...fact,
        observations: [
          { observation_key: 'a', metric: 'heart_rate', quantity: { value: 82, unit: 'kg' } },
        ],
      }).success
    ).toBe(false);
  });
  it('keeps PAP windows, zeros and unknown denominators distinct', () => {
    const fact = clinicalFactSchema.parse({
      kind: 'pap_report',
      name: 'Fictional report',
      window_start: day,
      window_end: day,
      statistics: [
        {
          key: 'ahi-3',
          label: 'AHI, reported 3% definition',
          value: 0,
          unit: 'events/h',
          statistic: 'mean',
          averaging_denominator: { label: 'therapy time', value: null, unit: 'h' },
        },
      ],
      adherence: [
        { label: 'Reported threshold', numerator: 0, denominator: null, count_unit: 'days' },
      ],
      provenance,
    });
    expect(fact.kind === 'pap_report' && fact.adherence[0].denominator).toBeNull();
    expect(
      clinicalFactSchema.safeParse({
        ...fact,
        window_start: { precision: 'day', value: '2026-02-01' },
      }).success
    ).toBe(false);
  });
  it('accepts qualitative partial screenings and keeps copied history explicit', () => {
    const fact = clinicalFactSchema.parse({
      kind: 'screening',
      instrument: { name: 'Fictional instrument', version: 'source version' },
      administration_date: unknown,
      record_type: 'copied_history',
      qualitative_result: 'Result transcribed; score unavailable',
      completeness: 'partial',
      functional_responses: [{ key: 'impact', value: 'Some difficulty' }],
      provenance,
    });
    expect(fact.kind === 'screening' && fact.reported_total).toBeUndefined();
    expect(
      clinicalFactSchema.safeParse({
        ...fact,
        record_type: 'administration',
        copied_from_record_id: 'source',
      }).success
    ).toBe(false);
  });
  it('does not infer completed procedures, condition certainty or a negative allergy review', () => {
    expect(
      clinicalFactSchema.parse({
        kind: 'procedure',
        name: 'Fictional order',
        status: 'ordered',
        events: [{ status: 'ordered', event_date: day }],
        codes: [{ system: 'source code system', code: 'TEST' }],
        provenance,
      })
    ).not.toHaveProperty('procedure_date');
    expect(
      clinicalFactSchema.parse({
        kind: 'condition',
        name: 'Fictional history',
        certainty: 'unknown',
        activity: 'active',
        temporal_scope: 'historical',
        provenance,
      })
    ).toMatchObject({ certainty: 'unknown' });
    expect(
      clinicalFactSchema.parse({
        kind: 'allergy_review',
        review_status: 'unknown',
        review_date: unknown,
        scope: 'Medication allergy review',
        provenance,
      })
    ).toMatchObject({ review_status: 'unknown' });
  });
  it('preserves qualitative genetic/counseling findings without interpretation', () => {
    expect(
      clinicalFactSchema.parse({
        kind: 'genetic_report',
        name: 'Fictional counseling',
        report_type: 'counseling',
        event_date: unknown,
        counseling_summary: 'Source discussion only',
        findings: [
          {
            label: 'Source finding',
            qualitative_result: 'Uncertain significance',
            reported_classification: 'As printed',
          },
        ],
        provenance,
      })
    ).toMatchObject({ report_type: 'counseling' });
  });
  it('covers all eleven kinds and twenty-four report-only numeric scan keys', () => {
    expect(CLINICAL_KINDS).toHaveLength(11);
    expect(WEB_SCAN_METRICS).toHaveLength(24);
    const scan = scanInputSchema.parse({
      external_id: 'fictional',
      source: 'Fictional device',
      method: 'bia',
      measured_at: day,
      measurements: [
        {
          metric_key: 'skeletal_muscle_index',
          value: 7.25,
          unit: 'kg/m²',
          definition: 'Source-reported SMI; not inferred from lean segments',
        },
      ],
      vendor_results: {
        scores: [
          { key: 'vendor-a', name: 'Device score', value: 0, definition: 'Source-specific scale' },
        ],
        recommendations: [
          {
            name: 'Source recommendation',
            text: 'Archived report text only',
            value: 1800,
            unit: 'kcal/day',
          },
        ],
      },
      provenance,
    });
    expect(scan.vendor_results?.scores[0].value).toBe(0);
    expect(scan).not.toHaveProperty('derived_measurements');
    expect(scanInputSchema.safeParse({ ...scan, derived_measurements: [] }).success).toBe(false);
  });
});
