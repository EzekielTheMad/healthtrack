/**
 * ExerciseTrendPanel — the Trends tab's presentational core: stat strip
 * (latest/best/PR count), the no-parsed-sets empty message, and tonnage
 * gating (weight mode only). Series math itself is covered by
 * src/lib/fitness/trends.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseTrendPanel, exerciseDisplayName } from './TrendsView';
import type { TrendPoint } from '@/lib/fitness/trends';

const points: TrendPoint[] = [
  { date: '2026-07-01T17:00:00Z', value: 300, e1rm: 400, isPr: false },
  { date: '2026-07-08T17:00:00Z', value: 330, e1rm: 440, isPr: true },
];

describe('exerciseDisplayName', () => {
  it('appends the variant when present', () => {
    expect(exerciseDisplayName({ name: 'Row', variant: 'Hammer high' })).toBe(
      'Row (Hammer high)',
    );
    expect(exerciseDisplayName({ name: 'Row', variant: null })).toBe('Row');
  });
});

describe('ExerciseTrendPanel', () => {
  it('shows the empty message when no points chart', () => {
    render(<ExerciseTrendPanel mode="weight" points={[]} tonnage={[]} />);
    expect(screen.getByText(/No parsed sets for this exercise yet/)).toBeInTheDocument();
  });

  it('renders latest/best/PR stats and the weekly tonnage section', () => {
    render(
      <ExerciseTrendPanel
        mode="weight"
        points={points}
        tonnage={[{ weekStart: '2026-07-06', tonnage: 8000 }]}
      />,
    );
    expect(screen.getByText('Latest')).toBeInTheDocument();
    expect(screen.getAllByText('330 lb')).toHaveLength(2); // latest + best
    expect(screen.getByText('PRs in window')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Weekly tonnage (lb, working sets)')).toBeInTheDocument();
  });

  it('omits tonnage for time-mode exercises', () => {
    render(
      <ExerciseTrendPanel
        mode="time"
        points={[{ date: '2026-07-01T17:00:00Z', value: 75, e1rm: null, isPr: false }]}
        tonnage={[]}
      />,
    );
    expect(screen.getAllByText('75 sec')).toHaveLength(2); // latest + best
    expect(screen.queryByText(/Weekly tonnage/)).not.toBeInTheDocument();
  });
});
