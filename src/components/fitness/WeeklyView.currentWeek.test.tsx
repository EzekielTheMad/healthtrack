import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WeeklyView from './WeeklyView';
import { useWeekRollup } from '@/hooks/useWeekRollup';
import { apiFetch } from '@/lib/api/client';
import { shiftDayKey } from '@/lib/dates';
import type { CheckinWire, WeekRollupWire } from '@/lib/fitness/api-types';

vi.mock('@/hooks/useWeekRollup', () => ({ useWeekRollup: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
beforeEach(() => {
  vi.mocked(useWeekRollup).mockReturnValue({
    rollup: null,
    loading: false,
    error: null,
    saveCheckin: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('Weekly instance calendar', () => {
  it('keeps one save confirmation visible through refresh loading and a new saved-record remount', async () => {
    const week = '2026-07-06';
    const saved: CheckinWire = {
      id: 'synthetic-saved-checkin',
      user_id: 'synthetic-owner',
      week_start: week,
      working: 'Synthetic notes',
      not_working: null,
      days_logged: null,
      avg_calories: null,
      avg_protein_g: null,
      avg_carbs_g: null,
      avg_fat_g: null,
      avg_fiber_g: null,
    };
    const rollup: WeekRollupWire = {
      week_start: week,
      week_end: '2026-07-12',
      timezone: 'America/Phoenix',
      sessions: {
        total: 0,
        by_type: {
          strength: { count: 0, labels: [] },
          cardio: { count: 0, labels: [] },
          mobility: { count: 0, labels: [] },
          other: { count: 0, labels: [] },
        },
      },
      body: {
        weight_avg: null,
        weight_min: null,
        days_weighed: 0,
        body_fat_pct_avg: null,
        fat_free_mass_avg: null,
        neck_latest: null,
        waist_latest: null,
        measurements_latest: {},
      },
      recovery: {
        hrv_rmssd_avg: null,
        readiness_score_avg: null,
        sleep_score_avg: null,
        sleep_duration_avg: null,
      },
      frequency_goals: [],
      checkin: null,
      prior_week_deltas: {
        weight_avg: null,
        weight_min: null,
        days_weighed: null,
        body_fat_pct_avg: null,
        fat_free_mass_avg: null,
        hrv_rmssd_avg: null,
        readiness_score_avg: null,
        sleep_score_avg: null,
        sleep_duration_avg: null,
        sessions_total: null,
      },
    };
    const state = {
      rollup,
      loading: false,
      error: null as string | null,
      saveCheckin: vi.fn(async () => {
        state.loading = true;
        return saved;
      }),
    };
    vi.mocked(useWeekRollup).mockImplementation(() => ({ ...state }));
    vi.mocked(apiFetch).mockResolvedValue({ current_week_start: week });
    const { rerender } = render(<WeeklyView />);
    await waitFor(() => expect(vi.mocked(useWeekRollup).mock.lastCall?.[0]).toBe(week));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText("What's working"), {
      target: { value: 'Synthetic notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(state.saveCheckin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    expect(await screen.findByText('Check-in saved.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('form', { name: 'Weekly check-in' })).not.toBeInTheDocument();
    state.loading = false;
    state.rollup = { ...rollup, checkin: saved };
    rerender(<WeeklyView />);
    expect(screen.getAllByText('Check-in saved.')).toHaveLength(1);
    expect(screen.getByRole('form', { name: 'Weekly check-in' })).toBeInTheDocument();
    expect(state.saveCheckin).toHaveBeenCalledTimes(1);
  });

  it('uses the configured instance week instead of a different browser calendar', async () => {
    let resolve!: (config: { current_week_start: string }) => void;
    vi.mocked(apiFetch).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<WeeklyView />);
    const browserWeek = vi.mocked(useWeekRollup).mock.calls[0][0];
    const instanceWeek = shiftDayKey(browserWeek, 7);
    await act(async () => {
      resolve({ current_week_start: instanceWeek });
    });
    expect(vi.mocked(useWeekRollup).mock.lastCall?.[0]).toBe(instanceWeek);
    expect(apiFetch).toHaveBeenCalledWith('/api/build');
  });

  it('does not replace the week the user navigated to while config was loading', async () => {
    let resolve!: (config: { current_week_start: string }) => void;
    vi.mocked(apiFetch).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<WeeklyView />);
    const browserWeek = vi.mocked(useWeekRollup).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    const selectedWeek = shiftDayKey(browserWeek, -7);
    await act(async () => {
      resolve({ current_week_start: shiftDayKey(browserWeek, 7) });
    });
    expect(vi.mocked(useWeekRollup).mock.lastCall?.[0]).toBe(selectedWeek);
  });
});
