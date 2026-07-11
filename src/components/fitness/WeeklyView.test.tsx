/**
 * WeekSummary + CheckinForm — the Weekly tab's presentational core: rollup
 * display with prior-week deltas and frequency-goal bars; check-in prefill
 * and full-replacement PUT bodies (neck/waist only when entered).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WeekSummary } from './WeeklyView';
import CheckinForm from './CheckinForm';
import type { CheckinWire, WeekRollupWire } from '@/lib/fitness/api-types';

function makeRollup(overrides: Partial<WeekRollupWire> = {}): WeekRollupWire {
  return {
    week_start: '2026-07-06',
    week_end: '2026-07-12',
    timezone: 'America/Phoenix',
    sessions: {
      total: 3,
      by_type: {
        strength: { count: 2, labels: ['Day A', 'Day B'] },
        cardio: { count: 1, labels: [] },
        mobility: { count: 0, labels: [] },
        other: { count: 0, labels: [] },
      },
    },
    body: {
      weight_avg: 212.4,
      weight_min: 211.0,
      days_weighed: 5,
      body_fat_pct_avg: 28.1,
      fat_free_mass_avg: 152.6,
      neck_latest: { value: 16.5, recorded_at: '2026-07-01T00:00:00Z', source: 'manual' },
      waist_latest: null,
    },
    recovery: {
      hrv_rmssd_avg: 42,
      readiness_score_avg: 78,
      sleep_score_avg: null,
      sleep_duration_avg: 7.2,
    },
    frequency_goals: [
      {
        goal_id: 'goal-1',
        session_type: 'strength',
        per_week: 3,
        completed: 2,
        met: false,
      },
    ],
    checkin: null,
    prior_week_deltas: {
      weight_avg: -1.2,
      weight_min: null,
      days_weighed: 1,
      body_fat_pct_avg: null,
      fat_free_mass_avg: null,
      hrv_rmssd_avg: 3,
      readiness_score_avg: null,
      sleep_score_avg: null,
      sleep_duration_avg: null,
      sessions_total: 1,
    },
    ...overrides,
  };
}

describe('WeekSummary', () => {
  it('renders session counts by type with labels', () => {
    render(<WeekSummary rollup={makeRollup()} />);
    expect(screen.getByText('3')).toBeInTheDocument(); // total
    expect(screen.getByText('2×')).toBeInTheDocument();
    expect(screen.getByText('Day A, Day B')).toBeInTheDocument();
    expect(screen.getByText('cardio')).toBeInTheDocument();
    // Zero-count types stay hidden
    expect(screen.queryByText('mobility')).not.toBeInTheDocument();
  });

  it('renders frequency-goal progress bars', () => {
    render(<WeekSummary rollup={makeRollup()} />);
    expect(screen.getByText('strength — 2/3 this week')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', {
      name: 'strength sessions: 2 of 3',
    });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByText('Met ✓')).not.toBeInTheDocument();
  });

  it('shows body/recovery averages with prior-week deltas and dashes for gaps', () => {
    render(<WeekSummary rollup={makeRollup()} />);
    expect(screen.getByText('212.4 lb')).toBeInTheDocument();
    expect(screen.getByText('-1.2 vs prior week')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    expect(screen.getByText('7.2 hrs')).toBeInTheDocument();
    // sleep_score_avg is null → em dash
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Latest tape reading carries its as-of date
    expect(screen.getByText(/Neck 16.5 in \(as of Jul 1\)/)).toBeInTheDocument();
  });

  it('reads an empty week honestly', () => {
    render(
      <WeekSummary
        rollup={makeRollup({
          sessions: {
            total: 0,
            by_type: {
              strength: { count: 0, labels: [] },
              cardio: { count: 0, labels: [] },
              mobility: { count: 0, labels: [] },
              other: { count: 0, labels: [] },
            },
          },
          frequency_goals: [],
        })}
      />,
    );
    expect(screen.getByText('No sessions logged this week.')).toBeInTheDocument();
  });
});

describe('CheckinForm', () => {
  const existing: CheckinWire = {
    id: 'checkin-1',
    user_id: 'user-1',
    week_start: '2026-07-06',
    working: 'progressive overload',
    not_working: null,
    days_logged: 6,
    avg_calories: 2200,
    avg_protein_g: 180,
    avg_carbs_g: null,
    avg_fat_g: null,
    avg_fiber_g: null,
  };

  it('prefills manual fields from the existing row but never neck/waist', () => {
    render(
      <CheckinForm
        weekStart="2026-07-06"
        initial={existing}
        neckLatest={{ value: 16.5, recorded_at: '2026-07-01T00:00:00Z', source: 'manual' }}
        waistLatest={null}
        onSave={async () => {}}
      />,
    );
    expect(screen.getByLabelText("What's working")).toHaveValue('progressive overload');
    expect(screen.getByLabelText('Days logged (0–7)')).toHaveValue(6);
    const neck = screen.getByLabelText('Neck (in) — recorded today');
    expect(neck).toHaveValue(null);
    expect(neck).toHaveAttribute('placeholder', 'latest 16.5');
  });

  it('submits a full-replacement body, including neck only when entered', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <CheckinForm
        weekStart="2026-07-06"
        initial={existing}
        neckLatest={null}
        waistLatest={null}
        onSave={onSave}
      />,
    );

    // Clear a prefilled field — full replacement must null it server-side.
    fireEvent.change(screen.getByLabelText('Avg calories'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Neck (in) — recorded today'), {
      target: { value: '16.25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update check-in' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const body = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({
      working: 'progressive overload',
      days_logged: 6,
      avg_calories: null,
      neck_in: 16.25,
    });
    expect(body).not.toHaveProperty('waist_in');
    expect(await screen.findByRole('status')).toHaveTextContent('Check-in saved.');
  });

  it('surfaces onSave failures inline', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('week_start is not a Monday'));
    render(
      <CheckinForm
        weekStart="2026-07-06"
        initial={null}
        neckLatest={null}
        waistLatest={null}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a Monday');
  });
});
