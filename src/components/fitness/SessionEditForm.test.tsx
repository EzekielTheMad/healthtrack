/**
 * SessionEditForm — prefill from the wire session, shorthand set parsing on
 * save (raw preserved verbatim), non-blocking unparsed-token warnings, and
 * inline server-error surfacing (409 dedupe etc.). Create mode (no session
 * prop): blank defaults, POST-shaped wire body, blank starter row dropped.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SessionEditForm from './SessionEditForm';
import type { WorkoutWire } from '@/lib/fitness/api-types';

const session: WorkoutWire = {
  id: 'session-1',
  user_id: 'user-1',
  dependent_id: null,
  type: 'strength',
  label: 'Day A',
  started_at: '2026-07-07T17:00:00.000Z',
  duration_min: 45,
  energy: 4,
  notes: null,
  distance_mi: null,
  avg_hr: null,
  calories: null,
  steps: null,
  machine: null,
  perceived_effort: null,
  entries: [
    {
      id: 'entry-1',
      session_id: 'session-1',
      exercise_id: 'ex-1',
      position: 0,
      sets: [{ weight: 330, reps: 12 }],
      raw_sets: '330x12',
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
    },
  ],
};

describe('SessionEditForm', () => {
  it('prefills session fields and entry shorthand', () => {
    render(<SessionEditForm session={session} onSave={async () => {}} onCancel={() => {}} />);
    expect(screen.getByDisplayValue('Day A')).toBeInTheDocument();
    expect(screen.getByLabelText('Entry 1 exercise name')).toHaveValue('Leg press');
    expect(screen.getByLabelText('Entry 1 sets')).toHaveValue('330x12');
  });

  it('parses edited shorthand into structured sets and preserves the raw string', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SessionEditForm session={session} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('Entry 1 sets'), {
      target: { value: '340x10 / 340x8 warmup' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const body = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(body.label).toBe('Day A');
    expect(body.entries).toEqual([
      {
        exercise_name: 'Leg press',
        sets: [
          { weight: 340, reps: 10 },
          { weight: 340, reps: 8, warmup: true },
        ],
        raw_sets: '340x10 / 340x8 warmup',
        notes: null,
      },
    ]);
  });

  it('warns about unparsed tokens without blocking the save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SessionEditForm session={session} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('Entry 1 sets'), {
      target: { value: '330x12 / a few extra' },
    });
    expect(screen.getByText(/Unrecognized set tokens/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const body = onSave.mock.calls[0][0] as Record<string, unknown>;
    const entries = body.entries as Array<Record<string, unknown>>;
    // Parsable tokens structured; the full raw string stays ground truth.
    expect(entries[0].sets).toEqual([{ weight: 330, reps: 12 }]);
    expect(entries[0].raw_sets).toBe('330x12 / a few extra');
  });

  it('surfaces onSave failures inline', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('A workout session already exists'));
    render(<SessionEditForm session={session} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A workout session already exists',
    );
  });

  it('adds and removes entries', () => {
    render(<SessionEditForm session={session} onSave={async () => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add entry' }));
    expect(screen.getByLabelText('Entry 2 exercise name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove entry 2' }));
    expect(screen.queryByLabelText('Entry 2 exercise name')).not.toBeInTheDocument();
  });
});

describe('SessionEditForm (create mode)', () => {
  it('renders blank defaults with a starter entry row', () => {
    render(<SessionEditForm onSave={async () => {}} onCancel={() => {}} />);
    expect(screen.getByRole('form', { name: 'Log session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log session' })).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toHaveValue('strength');
    expect(screen.getByLabelText('Entry 1 exercise name')).toHaveValue('');
    expect(screen.getByLabelText('Entry 1 sets')).toHaveValue('');
  });

  it('submits the wire-shaped POST body with parsed shorthand sets', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SessionEditForm onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Day B' } });
    fireEvent.change(screen.getByLabelText('Started at'), {
      target: { value: '2026-07-10T08:30' },
    });
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Entry 1 exercise name'), {
      target: { value: 'Bench press' },
    });
    fireEvent.change(screen.getByLabelText('Entry 1 sets'), {
      target: { value: '185x5 x3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log session' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const body = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(body.type).toBe('strength');
    expect(body.label).toBe('Day B');
    expect(body.started_at).toBe(new Date('2026-07-10T08:30').toISOString());
    expect(body.duration_min).toBe(45);
    expect(body.notes).toBeNull();
    expect(body.entries).toEqual([
      {
        exercise_name: 'Bench press',
        sets: [
          { weight: 185, reps: 5 },
          { weight: 185, reps: 5 },
          { weight: 185, reps: 5 },
        ],
        raw_sets: '185x5 x3',
        notes: null,
      },
    ]);
  });

  it('drops the fully blank starter row so entry-less sessions submit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SessionEditForm onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Log session' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const body = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect(body.entries).toEqual([]);
  });

  it('surfaces server errors inline', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new Error("A workout session already exists at started_at '2026-07-10T15:30:00.000Z'."),
      );
    render(<SessionEditForm onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Log session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A workout session already exists',
    );
  });
});
