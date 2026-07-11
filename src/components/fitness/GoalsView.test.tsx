/**
 * Goals & catalog tab presentational core — describeGoal, the kind-switching
 * GoalForm (409 inline), the GoalList active toggles, and the
 * unreviewed-exercises cleanup card (rename/alias/confirm → PATCH body).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describeGoal, GoalForm, GoalList, UnreviewedExercisesCard } from './GoalsView';
import type { ExerciseWire, GoalWire } from '@/lib/fitness/api-types';

function makeGoal(overrides: Partial<GoalWire> = {}): GoalWire {
  return {
    id: 'goal-1',
    user_id: 'user-1',
    kind: 'metric',
    active: true,
    metric_key: 'weight',
    direction: 'decrease',
    target_value: 210,
    target_date: '2026-10-01',
    session_type: null,
    per_week: null,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('describeGoal', () => {
  it('describes metric goals with target and date', () => {
    expect(describeGoal(makeGoal())).toBe('Decrease Weight → 210 lbs by 2026-10-01');
  });

  it('describes frequency goals', () => {
    expect(
      describeGoal(
        makeGoal({
          kind: 'frequency',
          metric_key: null,
          direction: null,
          target_value: null,
          target_date: null,
          session_type: 'strength',
          per_week: 3,
        }),
      ),
    ).toBe('3× strength per week');
  });
});

describe('GoalForm', () => {
  it('switches fields by kind and submits a frequency goal', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<GoalForm onCreate={onCreate} />);

    // Metric fields visible by default
    expect(screen.getByLabelText('Metric')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'frequency' } });
    expect(screen.queryByLabelText('Metric')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Session type'), { target: { value: 'cardio' } });
    fireEvent.change(screen.getByLabelText('Per week'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toEqual({
      kind: 'frequency',
      session_type: 'cardio',
      per_week: 2,
    });
  });

  it('submits a metric goal with optional target fields', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<GoalForm onCreate={onCreate} />);
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'maintain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    // No target entered → keys omitted entirely
    expect(onCreate.mock.calls[0][0]).toEqual({
      kind: 'metric',
      metric_key: 'weight',
      direction: 'maintain',
    });
  });

  it('surfaces a 409 conflict inline', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValue(new Error('An active metric goal for weight already exists'));
    render(<GoalForm onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create goal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});

describe('GoalList', () => {
  it('toggles active state and surfaces conflicts inline per row', async () => {
    const onToggle = vi
      .fn()
      .mockRejectedValue(new Error('An active frequency goal for strength sessions already exists'));
    render(
      <GoalList
        goals={[
          makeGoal({
            id: 'goal-2',
            kind: 'frequency',
            active: false,
            metric_key: null,
            direction: null,
            target_value: null,
            target_date: null,
            session_type: 'strength',
            per_week: 3,
          }),
        ]}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('goal-2', true));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('marks active goals', () => {
    const goals = [makeGoal(), makeGoal({ id: 'goal-3', active: false, metric_key: 'hrv_rmssd' })];
    render(<GoalList goals={goals} onToggle={async () => {}} />);
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
  });
});

describe('UnreviewedExercisesCard', () => {
  const unreviewed: ExerciseWire = {
    id: 'ex-9',
    user_id: 'user-1',
    name: 'legpress',
    variant: null,
    mode: 'weight',
    aliases: [],
    review_status: 'unreviewed',
  };

  it('shows the clean state when nothing needs review', () => {
    render(<UnreviewedExercisesCard exercises={[]} onConfirm={async () => {}} />);
    expect(screen.getByText('Catalog is clean — nothing to review.')).toBeInTheDocument();
  });

  it('confirms with rename + aliases in the PATCH body', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<UnreviewedExercisesCard exercises={[unreviewed]} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByLabelText('Rename legpress'), {
      target: { value: 'Leg press' },
    });
    fireEvent.change(screen.getByLabelText('Aliases for legpress'), {
      target: { value: 'legpress, LP machine' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & confirm' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith('ex-9', {
      name: 'Leg press',
      variant: null,
      aliases: ['legpress', 'LP machine'],
      mode: 'weight',
      review_status: 'confirmed',
    });
  });

  it('surfaces resolution collisions inline', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new Error("Name/alias 'Leg press' collides with existing exercise"));
    render(<UnreviewedExercisesCard exercises={[unreviewed]} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save & confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('collides');
  });
});
