/**
 * Goal-direction resolver + delta toning — goal overrides registry default;
 * maintain inverts the band (steady = good, movement = warn); the full
 * direction x delta-sign matrix from the spec's testing section.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveGoalDirection,
  deltaTone,
  type ActiveMetricGoal,
} from './goal-direction';

const goals: ActiveMetricGoal[] = [
  { metricKey: 'weight', direction: 'decrease' },
  { metricKey: 'hrv_rmssd', direction: 'increase' },
  { metricKey: 'ffm', direction: 'maintain' },
];

describe('resolveGoalDirection', () => {
  it('falls back to the registry default without an active goal', () => {
    expect(resolveGoalDirection('sleep_score', 'higher', goals)).toBe('higher');
    expect(resolveGoalDirection('ahi', 'lower', goals)).toBe('lower');
    expect(resolveGoalDirection('body_temp', undefined, goals)).toBeUndefined();
  });

  it('lets an active goal override the registry default', () => {
    // Registry says weight is directionless / whatever — goal says decrease.
    expect(resolveGoalDirection('weight', undefined, goals)).toBe('lower');
    // Goal can flip a registry default outright.
    expect(resolveGoalDirection('hrv_rmssd', 'lower', goals)).toBe('higher');
  });

  it('maps goal vocabulary to effective directions', () => {
    expect(resolveGoalDirection('weight', undefined, goals)).toBe('lower');
    expect(resolveGoalDirection('hrv_rmssd', undefined, goals)).toBe('higher');
    expect(resolveGoalDirection('ffm', 'higher', goals)).toBe('maintain');
  });

  it('ignores goals for other metrics and handles empty goal lists', () => {
    expect(resolveGoalDirection('spo2', 'higher', goals)).toBe('higher');
    expect(resolveGoalDirection('weight', 'lower', [])).toBe('lower');
    expect(resolveGoalDirection('weight', undefined, [])).toBeUndefined();
  });
});

describe('deltaTone', () => {
  const BAND = 0.5; // e.g. 0 decimals -> 0.5 * 10 ** -0

  it('is neutral without a direction, regardless of delta', () => {
    expect(deltaTone(5, undefined, BAND)).toBe('neutral');
    expect(deltaTone(-5, undefined, BAND)).toBe('neutral');
    expect(deltaTone(0, undefined, BAND)).toBe('neutral');
  });

  it('higher: up is good, down is bad, in-band is neutral', () => {
    expect(deltaTone(2, 'higher', BAND)).toBe('good');
    expect(deltaTone(-2, 'higher', BAND)).toBe('bad');
    expect(deltaTone(0.3, 'higher', BAND)).toBe('neutral');
    expect(deltaTone(-0.3, 'higher', BAND)).toBe('neutral');
  });

  it('lower: down is good, up is bad, in-band is neutral', () => {
    expect(deltaTone(-2, 'lower', BAND)).toBe('good');
    expect(deltaTone(2, 'lower', BAND)).toBe('bad');
    expect(deltaTone(0.3, 'lower', BAND)).toBe('neutral');
  });

  it('maintain: holding steady is good, movement either way warns', () => {
    expect(deltaTone(0.3, 'maintain', BAND)).toBe('good');
    expect(deltaTone(-0.3, 'maintain', BAND)).toBe('good');
    expect(deltaTone(0, 'maintain', BAND)).toBe('good');
    expect(deltaTone(2, 'maintain', BAND)).toBe('bad');
    expect(deltaTone(-2, 'maintain', BAND)).toBe('bad');
  });

  it('treats the band as exclusive (display half-step convention)', () => {
    // |delta| === flatBand rounds to a visible change -> out of band.
    expect(deltaTone(0.5, 'higher', BAND)).toBe('good');
    expect(deltaTone(-0.5, 'lower', BAND)).toBe('good');
    expect(deltaTone(0.5, 'maintain', BAND)).toBe('bad');
  });

  it('always treats a zero delta as in-band, even with a zero band', () => {
    expect(deltaTone(0, 'maintain', 0)).toBe('good');
    expect(deltaTone(0, 'higher', 0)).toBe('neutral');
    expect(deltaTone(0.1, 'maintain', 0)).toBe('bad');
  });
});
