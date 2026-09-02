/**
 * Input-unit normalization — the shared table behind the vitals write path.
 *
 * The contract is keyed on the CANONICAL unit, never on a metric key or a
 * source, so acceptance generalizes across every metric stored in that unit.
 * Converted values are stored as-is; rounding belongs to the display layer.
 */
import { describe, it, expect } from 'vitest';
import { acceptedUnitsFor, convertToCanonicalUnit } from './units';
import { getMetric, METRICS } from './registry';
import { formatMetricValue } from './format';
import { cmToInches } from '@/lib/units';

describe('convertToCanonicalUnit', () => {
  it('passes the canonical unit through untouched', () => {
    expect(convertToCanonicalUnit('in', 'in', 38.125)).toBe(38.125);
    expect(convertToCanonicalUnit('lbs', 'lbs', 181.24)).toBe(181.24);
    expect(convertToCanonicalUnit('steps', 'steps', 8200)).toBe(8200);
  });

  it('converts centimetres to inches at full double precision, unrounded', () => {
    // The exact quotient is what gets stored — no display rounding, and no
    // intermediate quantization to a fixed number of decimals either.
    expect(convertToCanonicalUnit('in', 'cm', 96.8)).toBe(96.8 / 2.54);
    expect(convertToCanonicalUnit('in', 'cm', 96.8)).toBe(cmToInches(96.8));
    // 96.8 cm = 38.11023622047244 in — every one of those digits survives.
    expect(convertToCanonicalUnit('in', 'cm', 96.8)).toBe(38.11023622047244);
    expect(convertToCanonicalUnit('in', 'cm', 2.54)).toBe(1);
  });

  it('does not quantize the converted inch value to four decimals', () => {
    for (const cm of [96.8, 36.3, 29.5, 55, 101.6001]) {
      const converted = convertToCanonicalUnit('in', 'cm', cm)!;
      expect(converted, `${cm} cm`).toBe(cm / 2.54);
      // A four-decimal guard round would have collapsed these; it must not.
      const rounded4 = Math.round(converted * 1e4) / 1e4;
      expect(rounded4, `${cm} cm is a meaningful case`).not.toBe(converted);
      expect(converted, `${cm} cm must not be pre-rounded`).not.toBe(rounded4);
    }
  });

  it('keeps the established kg → lbs behaviour', () => {
    expect(convertToCanonicalUnit('lbs', 'kg', 80)).toBeCloseTo(176.4, 5);
  });

  it('accepts kg for every lbs metric, not just weight', () => {
    // The table is keyed on the canonical unit, so fat_free_mass — the other
    // metric stored in lbs — normalizes identically, with no per-metric branch.
    expect(getMetric('fat_free_mass')!.unit).toBe('lbs');
    expect(acceptedUnitsFor('lbs')).toContain('kg');
    expect(convertToCanonicalUnit('lbs', 'kg', 68)).toBeCloseTo(149.9, 5);
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

describe('display precision is applied at render time, not at write time', () => {
  it("renders a full-precision stored inch value at the metric's one decimal", () => {
    const stored = convertToCanonicalUnit('in', 'cm', 96.8)!;
    expect(stored).toBe(38.11023622047244);
    // The registry owns display precision; the stored value stays exact.
    const decimals = getMetric('waist')!.decimals!;
    expect(decimals).toBe(1);
    expect(formatMetricValue(stored, decimals)).toBe('38.1');
  });

  it('rounds each circumference for display without touching the stored value', () => {
    for (const [cm, display] of [
      [96.8, '38.1'],
      [36.3, '14.3'],
      [29.5, '11.6'],
      [55, '21.7'],
    ] as [number, string][]) {
      const stored = convertToCanonicalUnit('in', 'cm', cm)!;
      expect(formatMetricValue(stored, 1), `${cm} cm display`).toBe(display);
      expect(stored, `${cm} cm stored`).not.toBe(Number(display));
    }
  });

  it('renders a kg-normalized fat_free_mass at its registry precision', () => {
    // weightToLbs quantizes to a tenth of a pound on the way in — pre-existing
    // stored-value behaviour, deliberately unchanged — and the display layer
    // then formats it at the metric's own precision.
    const stored = convertToCanonicalUnit('lbs', 'kg', 68)!;
    expect(formatMetricValue(stored, getMetric('fat_free_mass')!.decimals!)).toBe('149.9');
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
