/**
 * Epley e1RM + tonnage — warmup/time-only exclusion, per-side conventions
 * (e1RM stays per-side, tonnage doubles), and the lighter-set-can-win case.
 */
import { describe, it, expect } from 'vitest';
import { epleyE1rm, bestE1rm, tonnage } from './e1rm';
import { parseSets } from './set-parser';

describe('epleyE1rm', () => {
  it('applies weight * (1 + reps/30)', () => {
    expect(epleyE1rm(330, 12)).toBeCloseTo(462, 10);
    expect(epleyE1rm(100, 10)).toBeCloseTo(133.3333, 3);
    expect(epleyE1rm(47.5, 15)).toBeCloseTo(71.25, 10);
  });

  it('returns the weight itself for a true single', () => {
    expect(epleyE1rm(405, 1)).toBe(405);
  });
});

describe('bestE1rm', () => {
  it('picks the best estimate across straight sets', () => {
    const { sets } = parseSets('460x10 / 460x10 / 460x10');
    expect(bestE1rm(sets)).toBeCloseTo(460 * (1 + 10 / 30), 10);
  });

  it('can favor a lighter set with more reps over a heavier one', () => {
    // 100x10 -> 133.3 beats 105x5 -> 122.5.
    const { sets } = parseSets('105x5 / 100x10');
    expect(bestE1rm(sets)).toBeCloseTo(100 * (1 + 10 / 30), 10);
  });

  it('ignores warmup sets', () => {
    const { sets } = parseSets('200x12 warmup / 330x12 / 330x12');
    // 200x12 would estimate 280 — excluded; the 330x12 sets estimate 462.
    expect(bestE1rm(sets)).toBeCloseTo(462, 10);
  });

  it('ignores time-only sets and returns null when nothing qualifies', () => {
    expect(bestE1rm(parseSets('75s / 75s / 75s').sets)).toBeNull();
    expect(bestE1rm([])).toBeNull();
    expect(bestE1rm(parseSets('200x12 warmup').sets)).toBeNull();
  });

  it('uses the per-side weight without doubling', () => {
    const { sets } = parseSets('50/arm x12');
    expect(bestE1rm(sets)).toBeCloseTo(50 * (1 + 12 / 30), 10);
  });
});

describe('tonnage', () => {
  it('sums weight * reps over working sets', () => {
    const { sets } = parseSets('330x12 / 330x12 / 330x12');
    expect(tonnage(sets)).toBe(330 * 12 * 3);
  });

  it('doubles per-side sets', () => {
    const { sets } = parseSets('50/arm x12 / 50/arm x12 / 50/arm x12');
    expect(tonnage(sets)).toBe(2 * 50 * 12 * 3);
  });

  it('excludes warmups from volume', () => {
    const { sets } = parseSets('200x12 warmup / 330x12 / 330x12');
    expect(tonnage(sets)).toBe(330 * 12 * 2);
  });

  it('handles decimal weights and multiplier expansions', () => {
    const { sets } = parseSets('47.5x15 x3');
    expect(tonnage(sets)).toBeCloseTo(47.5 * 15 * 3, 10);
  });

  it('counts time-only sets as zero volume', () => {
    expect(tonnage(parseSets('75s / 75s / 75s').sets)).toBe(0);
    expect(tonnage([])).toBe(0);
  });
});
