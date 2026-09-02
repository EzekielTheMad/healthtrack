/**
 * Input-unit normalization — the shared table behind the vitals write path.
 *
 * The contract is keyed on the CANONICAL unit, never on a metric key or a
 * source, so acceptance generalizes across every metric stored in that unit.
 */
import { describe, it, expect } from 'vitest';
import { acceptedUnitsFor, convertToCanonicalUnit } from './units';
import { METRICS } from './registry';

describe('convertToCanonicalUnit', () => {
  it('passes the canonical unit through untouched', () => {
    expect(convertToCanonicalUnit('in', 'in', 38.125)).toBe(38.125);
    expect(convertToCanonicalUnit('lbs', 'lbs', 181.24)).toBe(181.24);
    expect(convertToCanonicalUnit('steps', 'steps', 8200)).toBe(8200);
  });

  it('converts centimetres to inches without collapsing to display precision', () => {
    // 96.8 cm ≈ 38.1102 in — kept well past the 0.1 in display rounding.
    expect(convertToCanonicalUnit('in', 'cm', 96.8)).toBeCloseTo(38.1102, 4);
    expect(convertToCanonicalUnit('in', 'cm', 96.8)).not.toBe(38.1);
    expect(convertToCanonicalUnit('in', 'cm', 2.54)).toBe(1);
  });

  it('keeps the established kg → lbs behaviour', () => {
    expect(convertToCanonicalUnit('lbs', 'kg', 80)).toBeCloseTo(176.4, 5);
  });

  it('returns undefined for units it does not accept, rather than guessing', () => {
    for (const [canonical, unit] of [
      ['in', 'mm'],
      ['in', 'm'],
      ['in', 'IN'],
      ['in', 'kg'],
      ['lbs', 'stone'],
      ['steps', 'km'],
      ['%', 'pct'],
    ] as const) {
      expect(convertToCanonicalUnit(canonical, unit, 1), `${canonical}/${unit}`).toBeUndefined();
    }
  });
});

describe('acceptedUnitsFor', () => {
  it('lists the canonical unit first, then registered alternates', () => {
    expect(acceptedUnitsFor('in')).toEqual(['in', 'cm']);
    expect(acceptedUnitsFor('lbs')).toEqual(['lbs', 'kg']);
    // A unit with no alternates accepts only itself.
    expect(acceptedUnitsFor('steps')).toEqual(['steps']);
  });

  it('covers every body-measurement metric with in + cm, no per-metric branch', () => {
    const circumferences = METRICS.filter((m) => m.category === 'body_measurement');
    expect(circumferences.length).toBeGreaterThan(0);
    for (const m of circumferences) {
      expect(acceptedUnitsFor(m.unit!), m.key).toEqual(['in', 'cm']);
    }
  });
});
