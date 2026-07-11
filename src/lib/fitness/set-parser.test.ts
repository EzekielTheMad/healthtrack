/**
 * Set-string parser — table of every shape observed in the Notion Gym
 * Tracker audit (observed real-world shorthand shapes
 * §5) plus round-trips through formatSets. parseSets must never throw;
 * unrecognizable tokens land in `unparsed`.
 */
import { describe, it, expect } from 'vitest';
import { parseSets, formatSets, type ParsedSet } from './set-parser';

const w = (weight: number, reps: number): ParsedSet => ({ weight, reps });

interface Case {
  name: string;
  raw: string;
  sets: ParsedSet[];
  unparsed?: string[];
}

const CASES: Case[] = [
  { name: 'single weight x reps', raw: '330x12', sets: [w(330, 12)] },
  {
    name: 'straight sets (slash-separated)',
    raw: '460x10 / 460x10 / 460x10',
    sets: [w(460, 10), w(460, 10), w(460, 10)],
  },
  {
    name: 'inline warmup flag',
    raw: '200x12 warmup / 330x12 / 330x12',
    sets: [{ weight: 200, reps: 12, warmup: true }, w(330, 12), w(330, 12)],
  },
  {
    name: 'four-set ramp with warmup',
    raw: '200x12 warmup / 330x12 / 330x12 / 330x12',
    sets: [
      { weight: 200, reps: 12, warmup: true },
      w(330, 12),
      w(330, 12),
      w(330, 12),
    ],
  },
  {
    name: 'per-side load',
    raw: '50/arm x12',
    sets: [{ weight: 50, reps: 12, perSide: true }],
  },
  {
    name: 'per-side straight sets',
    raw: '50/arm x12 / 50/arm x12 / 50/arm x12',
    sets: [
      { weight: 50, reps: 12, perSide: true },
      { weight: 50, reps: 12, perSide: true },
      { weight: 50, reps: 12, perSide: true },
    ],
  },
  {
    name: 'time-based sets (Ns)',
    raw: '75s / 75s / 75s',
    sets: [{ seconds: 75 }, { seconds: 75 }, { seconds: 75 }],
  },
  { name: 'time-based single "N sec"', raw: '75 sec', sets: [{ seconds: 75 }] },
  {
    name: 'multiplier expansion',
    raw: '130x10 x3',
    sets: [w(130, 10), w(130, 10), w(130, 10)],
  },
  {
    name: 'decimal weight with multiplier',
    raw: '47.5x15 x3',
    sets: [w(47.5, 15), w(47.5, 15), w(47.5, 15)],
  },
  {
    name: 'mixed ramp',
    raw: '40x12 / 65x12 / 65x12',
    sets: [w(40, 12), w(65, 12), w(65, 12)],
  },
  {
    name: 'ascending final set',
    raw: '60x12 / 60x12 / 80x12',
    sets: [w(60, 12), w(60, 12), w(80, 12)],
  },
  {
    name: 'third-set drop-off',
    raw: '130x12 / 130x12 / 130x8',
    sets: [w(130, 12), w(130, 12), w(130, 8)],
  },
  {
    name: 'high-rep accessory (reps = weight)',
    raw: '40x40 / 40x40 / 40x40',
    sets: [w(40, 40), w(40, 40), w(40, 40)],
  },
  {
    name: 'multiplier on time-based set',
    raw: '75s x3',
    sets: [{ seconds: 75 }, { seconds: 75 }, { seconds: 75 }],
  },
  {
    name: 'compact weight x reps x sets',
    raw: '460x10x3',
    sets: [w(460, 10), w(460, 10), w(460, 10)],
  },
  { name: 'decimal weight single set', raw: '187.5x8', sets: [w(187.5, 8)] },
  {
    name: 'per-side "/side" unit variant',
    raw: '35/side x10',
    sets: [{ weight: 35, reps: 10, perSide: true }],
  },
  {
    name: '"seconds" spelled out',
    raw: '90 seconds',
    sets: [{ seconds: 90 }],
  },
];

describe('parseSets', () => {
  it.each(CASES)('$name: $raw', ({ raw, sets, unparsed }) => {
    expect(parseSets(raw)).toEqual({ sets, unparsed: unparsed ?? [] });
  });

  it('returns empty results for empty/blank input', () => {
    expect(parseSets('')).toEqual({ sets: [], unparsed: [] });
    expect(parseSets('   ')).toEqual({ sets: [], unparsed: [] });
  });

  it('routes narrative text to unparsed without throwing', () => {
    expect(parseSets('felt strong today')).toEqual({
      sets: [],
      unparsed: ['felt strong today'],
    });
  });

  it('keeps parseable tokens when others fail', () => {
    expect(parseSets('330x12 / who knows / 330x12')).toEqual({
      sets: [w(330, 12), w(330, 12)],
      unparsed: ['who knows'],
    });
  });

  it('treats a bare number as unparseable (weight? seconds? ambiguous)', () => {
    expect(parseSets('330')).toEqual({ sets: [], unparsed: ['330'] });
  });

  it('rejects absurd multipliers instead of exploding', () => {
    expect(parseSets('100x10 x99')).toEqual({
      sets: [],
      unparsed: ['100x10 x99'],
    });
  });

  it('accepts warmup flag case-insensitively', () => {
    expect(parseSets('200x12 Warmup')).toEqual({
      sets: [{ weight: 200, reps: 12, warmup: true }],
      unparsed: [],
    });
  });

  it('expands multipliers into independent set objects', () => {
    const { sets } = parseSets('130x10 x3');
    expect(sets).toHaveLength(3);
    expect(sets[0]).not.toBe(sets[1]); // no shared references
  });
});

describe('formatSets', () => {
  it('renders straight sets', () => {
    expect(formatSets([w(330, 12), w(330, 12)])).toBe('330x12 / 330x12');
  });

  it('renders warmup, per-side, and time-based sets', () => {
    expect(
      formatSets([
        { weight: 200, reps: 12, warmup: true },
        { weight: 50, reps: 12, perSide: true },
        { seconds: 75 },
      ]),
    ).toBe('200x12 warmup / 50/side x12 / 75s');
  });

  it('renders decimal weights', () => {
    expect(formatSets([w(47.5, 15)])).toBe('47.5x15');
  });

  it('returns an empty string for no sets', () => {
    expect(formatSets([])).toBe('');
  });

  it.each(CASES)('round-trips: $name', ({ raw }) => {
    const first = parseSets(raw);
    const roundTripped = parseSets(formatSets(first.sets));
    expect(roundTripped.sets).toEqual(first.sets);
    expect(roundTripped.unparsed).toEqual([]);
  });
});
