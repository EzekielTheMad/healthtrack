/**
 * SessionList / SessionCard — the History tab's presentational core:
 * expandable rows with per-set breakdowns, cardio fields, delete confirm,
 * and the empty state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionList, entrySetsDisplay } from './HistoryView';
import type { EntryWire, WorkoutWire } from '@/lib/fitness/api-types';

let idCounter = 0;

function makeEntry(overrides: Partial<EntryWire> = {}): EntryWire {
  idCounter += 1;
  return {
    id: `entry-${idCounter}`,
    session_id: 'session-1',
    exercise_id: 'ex-1',
    position: 0,
    sets: [
      { weight: 330, reps: 12 },
      { weight: 330, reps: 8 },
    ],
    raw_sets: '330x12 / 330x8',
    notes: null,
    working_weight: 330,
    top_reps: 12,
    top_seconds: null,
    exercise: {
      id: 'ex-1',
      name: 'Leg press',
      variant: null,
      mode: 'weight',
      review_status: 'confirmed',
    },
    ...overrides,
  };
}

function makeSession(overrides: Partial<WorkoutWire> = {}): WorkoutWire {
  idCounter += 1;
  return {
    id: `session-${idCounter}`,
    user_id: 'user-1',
    dependent_id: null,
    type: 'strength',
    label: 'Day A',
    started_at: '2026-07-07T17:00:00.000Z',
    duration_min: 45,
    energy: 4,
    notes: 'Felt strong',
    distance_mi: null,
    avg_hr: null,
    calories: null,
    steps: null,
    machine: null,
    perceived_effort: null,
    entries: [makeEntry()],
    ...overrides,
  };
}

const noop = async () => {};

describe('entrySetsDisplay', () => {
  it('formats structured sets and falls back to raw for parse gaps', () => {
    expect(entrySetsDisplay(makeEntry())).toBe('330x12 / 330x8');
    expect(
      entrySetsDisplay(makeEntry({ sets: [], raw_sets: '3 laps of something' })),
    ).toBe('3 laps of something');
    expect(entrySetsDisplay(makeEntry({ sets: [], raw_sets: null }))).toBe('—');
  });
});

describe('SessionList', () => {
  it('shows the empty state when no sessions match', () => {
    render(<SessionList sessions={[]} onSave={noop} onDelete={noop} />);
    expect(screen.getByText('No sessions found')).toBeInTheDocument();
  });

  it('renders collapsed session headers with type, label and count', () => {
    render(<SessionList sessions={[makeSession()]} onSave={noop} onDelete={noop} />);
    expect(screen.getByText('strength')).toBeInTheDocument();
    expect(screen.getByText('Day A')).toBeInTheDocument();
    expect(screen.getByText('1 exercise')).toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
    // Detail is collapsed
    expect(screen.queryByText('Leg press')).not.toBeInTheDocument();
  });

  it('expands to entries with per-set breakdown, energy and notes', () => {
    render(<SessionList sessions={[makeSession()]} onSave={noop} onDelete={noop} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('Leg press')).toBeInTheDocument();
    expect(screen.getByText('330x12 / 330x8')).toBeInTheDocument();
    expect(screen.getByText('working 330 lb × 12')).toBeInTheDocument();
    expect(screen.getByText('Energy 4/5')).toBeInTheDocument();
    expect(screen.getByText('Felt strong')).toBeInTheDocument();
  });

  it('shows cardio fields for cardio sessions', () => {
    render(
      <SessionList
        sessions={[
          makeSession({
            type: 'cardio',
            label: 'Treadmill',
            entries: [],
            distance_mi: 2.2,
            avg_hr: 128,
            calories: 320,
            steps: 4200,
            machine: 'Treadmill 3',
            perceived_effort: 3,
          }),
        ]}
        onSave={noop}
        onDelete={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('2.2 mi')).toBeInTheDocument();
    expect(screen.getByText('128 bpm avg')).toBeInTheDocument();
    expect(screen.getByText('320 cal')).toBeInTheDocument();
    expect(screen.getByText('4,200 steps')).toBeInTheDocument();
    expect(screen.getByText('Treadmill 3')).toBeInTheDocument();
    expect(screen.getByText('effort 3/5')).toBeInTheDocument();
  });

  it('deletes only after an explicit confirm', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const session = makeSession();
    render(<SessionList sessions={[session]} onSave={noop} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(session.id));
  });

  it('opens the edit form inline', () => {
    render(<SessionList sessions={[makeSession()]} onSave={noop} onDelete={noop} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('form', { name: 'Edit session' })).toBeInTheDocument();
  });
});
