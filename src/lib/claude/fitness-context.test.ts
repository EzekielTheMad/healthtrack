import { describe, it, expect } from 'vitest';
import {
  formatGoalsForPrompt,
  formatRecentTrainingForPrompt,
  type PromptGoal,
  type PromptWorkoutSession,
} from './fitness-context';

// Fixed clock for deterministic 7/14-day windows.
const NOW = new Date('2026-07-10T12:00:00Z');

const weightGoal: PromptGoal = {
  kind: 'metric',
  metricKey: 'weight',
  direction: 'decrease',
  targetValue: 175,
  targetDate: '2026-12-31',
};
const liftGoal: PromptGoal = { kind: 'frequency', sessionType: 'strength', perWeek: 3 };

describe('formatGoalsForPrompt', () => {
  it('formats metric goals with registry label, unit, target and date', () => {
    const block = formatGoalsForPrompt([weightGoal]);
    expect(block).toContain('Active goals:');
    expect(block).toContain('- Weight: decrease (target 175 lbs by 2026-12-31)');
  });

  it('formats a maintain goal without target details', () => {
    const block = formatGoalsForPrompt([
      { kind: 'metric', metricKey: 'body_fat_pct', direction: 'maintain' },
    ]);
    expect(block).toContain('maintain');
    expect(block).not.toContain('target');
    expect(block).not.toContain('()');
  });

  it('formats frequency goals as sessions per week', () => {
    expect(formatGoalsForPrompt([liftGoal])).toContain('- strength sessions: 3x/week');
  });

  it('returns empty string for no goals (prompt reads like today)', () => {
    expect(formatGoalsForPrompt([])).toBe('');
  });
});

describe('formatRecentTrainingForPrompt', () => {
  const sessions: PromptWorkoutSession[] = [
    { type: 'strength', label: 'Upper A', startedAt: '2026-07-01T17:00:00Z' },
    { type: 'strength', label: 'Lower B', startedAt: '2026-07-03T17:00:00Z' },
    { type: 'strength', label: 'Upper A', startedAt: '2026-07-08T17:00:00Z' },
    { type: 'cardio', label: 'Treadmill', startedAt: '2026-07-09T07:00:00Z' },
  ];

  it('groups sessions by type with labels and dates', () => {
    const block = formatRecentTrainingForPrompt(sessions, [], NOW);
    expect(block).toContain('Recent training (last 14 days, 4 sessions):');
    expect(block).toContain('- strength: 3 (Upper A — Jul 1, Jul 8; Lower B — Jul 3)');
    expect(block).toContain('- cardio: 1 (Treadmill — Jul 9)');
  });

  it('annotates frequency-goal types with goal and last-7-day count', () => {
    const block = formatRecentTrainingForPrompt(sessions, [liftGoal, weightGoal], NOW);
    // Jul 3 17:00 and Jul 8 fall inside the trailing 7 days from Jul 10 12:00.
    expect(block).toContain(
      '- strength: 3 (Upper A — Jul 1, Jul 8; Lower B — Jul 3) | goal 3x/week, last 7 days: 2',
    );
    // No frequency goal for cardio → no annotation on its line.
    const cardioLine = block.split('\n').find((l) => l.startsWith('- cardio'));
    expect(cardioLine).toBe('- cardio: 1 (Treadmill — Jul 9)');
  });

  it('excludes sessions outside the 14-day window', () => {
    const block = formatRecentTrainingForPrompt(
      [
        ...sessions,
        { type: 'strength', label: 'Old', startedAt: '2026-06-20T17:00:00Z' },
      ],
      [],
      NOW,
    );
    expect(block).not.toContain('Old');
    expect(block).toContain('4 sessions');
  });

  it('labels unlabeled sessions and handles a single session', () => {
    const block = formatRecentTrainingForPrompt(
      [{ type: 'mobility', label: null, startedAt: '2026-07-05T08:00:00Z' }],
      [],
      NOW,
    );
    expect(block).toContain('(last 14 days, 1 session):');
    expect(block).toContain('- mobility: 1 (unlabeled — Jul 5)');
  });

  it('returns empty string when no sessions fall in the window', () => {
    expect(formatRecentTrainingForPrompt([], [], NOW)).toBe('');
    expect(
      formatRecentTrainingForPrompt(
        [{ type: 'strength', label: 'Old', startedAt: '2026-06-01T00:00:00Z' }],
        [liftGoal],
        NOW,
      ),
    ).toBe('');
  });
});
