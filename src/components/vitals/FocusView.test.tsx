/**
 * FocusPanelList — presentational goal panels: verdict badges, stat grids,
 * apnea evidence strip, inline chart expansion (one panel at a time), and
 * the no-device-data empty state. Plus the FocusView wrapper's fetch-error
 * state (error only — no empty state beneath it) and its goal wiring
 * (frequency-goal badge from fetched sessions; body target stat).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FocusView, { FocusPanelList } from './FocusView';
import { useVitals } from '@/hooks/useVitals';
import { useRecentWorkouts } from '@/hooks/useRecentWorkouts';
import { buildFocusPanels, type FocusGoalContext } from '@/lib/metrics/focus';
import type { Vital } from '@/lib/types';

vi.mock('@/hooks/useVitals', () => ({ useVitals: vi.fn() }));
vi.mock('@/hooks/useRecentWorkouts', () => ({ useRecentWorkouts: vi.fn() }));

const NOW = new Date('2026-07-10T12:00:00Z');

let idCounter = 0;
function vital(metric_key: string, value: number, day: string): Vital {
  idCounter += 1;
  const recorded_at = `${day}T00:00:00.000Z`;
  return {
    id: `v${idCounter}`,
    user_id: 'u1',
    metric_key,
    value,
    unit: null,
    source: 'manual',
    recorded_at,
    metadata: {},
    created_at: recorded_at,
  };
}

function fixture(): Vital[] {
  return [
    // Apnea: 6 used nights, AHI avg 3 → Well controlled
    ...['01', '03', '05', '07', '09', '10'].flatMap((d) => [
      vital('cpap_usage', 7, `2026-07-${d}`),
      vital('ahi', 3, `2026-07-${d}`),
    ]),
    // Recovery: readiness 88 → Primed
    vital('readiness_score', 88, '2026-07-10'),
    // Activity
    vital('steps', 8000, '2026-07-10'),
    vital('steps', 9000, '2026-07-09'),
  ];
}

function renderPanels(
  vitals: Vital[],
  onAddManual?: () => void,
  goals?: FocusGoalContext,
) {
  const panels = buildFocusPanels(vitals, NOW, goals);
  render(
    <FocusPanelList
      panels={panels}
      vitals={vitals}
      userAge={35}
      userSex="male"
      onAddManual={onAddManual}
    />,
  );
  return panels;
}

describe('FocusPanelList', () => {
  it('renders one panel per data-gated goal with its verdict badge', () => {
    renderPanels(fixture());
    expect(screen.getByText('Sleep apnea therapy')).toBeInTheDocument();
    expect(screen.getByText('Well controlled')).toBeInTheDocument();
    expect(screen.getByText('Recovery today')).toBeInTheDocument();
    expect(screen.getByText('Primed')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    // No weight data → no body panel.
    expect(screen.queryByText('Body composition')).not.toBeInTheDocument();
  });

  it('renders stats with their delta sub lines and the apnea evidence strip', () => {
    renderPanels(fixture());
    expect(screen.getByText('AHI (30d avg)')).toBeInTheDocument();
    expect(screen.getByText('goal <5')).toBeInTheDocument();
    expect(screen.getByText('Adherence')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Nightly AHI, last 14 nights' }),
    ).toBeInTheDocument();
  });

  it('expands charts inline, one panel at a time, and collapses again', () => {
    renderPanels(fixture());
    const buttons = screen.getAllByRole('button', { name: 'View charts' });
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(buttons[0]); // apnea
    expect(
      screen.getByRole('region', { name: 'Sleep apnea therapy charts' }),
    ).toBeInTheDocument();

    // Expanding another panel closes the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'View charts' })[1]);
    expect(
      screen.queryByRole('region', { name: 'Sleep apnea therapy charts' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Activity charts' }),
    ).toBeInTheDocument();

    // Hide affordance collapses the open panel.
    fireEvent.click(screen.getByRole('button', { name: 'Hide charts' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('renders frequency-goal week progress in the activity badge', () => {
    renderPanels(fixture(), undefined, {
      frequencyGoals: [
        { sessionType: 'strength', perWeek: 3 },
        { sessionType: 'cardio', perWeek: 2 },
      ],
      weekSessions: [
        { type: 'strength', startedAt: '2026-07-07T17:00:00Z' },
        { type: 'strength', startedAt: '2026-07-09T17:00:00Z' },
        { type: 'cardio', startedAt: '2026-07-08T17:00:00Z' },
      ],
      timeZone: 'UTC',
    });
    expect(screen.getByText('2/3 lifts · 1/2 cardio this week')).toBeInTheDocument();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('renders the body target-progress stat for a weight goal with a target', () => {
    const weights = [
      vital('weight', 210, '2026-07-08'),
      vital('weight', 210, '2026-07-01'),
    ];
    renderPanels(weights, undefined, {
      metricGoals: [{ metricKey: 'weight', direction: 'decrease', targetValue: 200 }],
    });
    expect(screen.getByText('Goal')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('10 lbs to go')).toBeInTheDocument();
  });

  it('shows only the error state when the fetch fails — no empty state below', () => {
    vi.mocked(useVitals).mockReturnValue({
      vitals: [],
      loading: false,
      error: 'Failed to load vitals',
    } as unknown as ReturnType<typeof useVitals>);
    vi.mocked(useRecentWorkouts).mockReturnValue({ sessions: [], loading: false });
    render(<FocusView userAge={35} userSex="male" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load vitals');
    expect(screen.queryByText('No device data yet')).not.toBeInTheDocument();
  });

  it('FocusView threads goals and fetched sessions into the panel build', () => {
    vi.mocked(useVitals).mockReturnValue({
      vitals: fixture(),
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useVitals>);
    vi.mocked(useRecentWorkouts).mockReturnValue({
      sessions: [{ type: 'strength', startedAt: new Date().toISOString() }],
      loading: false,
    });
    render(
      <FocusView
        userAge={35}
        userSex="male"
        frequencyGoals={[{ sessionType: 'strength', perWeek: 3 }]}
      />,
    );
    // Today's session always lands in the current week, whatever the runner
    // timezone — the badge shows real progress instead of the static label.
    expect(screen.getByText('1/3 lifts this week')).toBeInTheDocument();
    // The workouts fetch was enabled by the active frequency goal.
    expect(vi.mocked(useRecentWorkouts)).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('shows the empty state with API docs pointer and manual-entry action', () => {
    let added = false;
    renderPanels([], () => {
      added = true;
    });
    expect(screen.getByText('No device data yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'HealthTrack API' })).toHaveAttribute(
      'href',
      '/docs/api',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add Vital' }));
    expect(added).toBe(true);
  });
});
