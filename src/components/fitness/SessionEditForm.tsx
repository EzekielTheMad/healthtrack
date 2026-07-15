'use client';

import React, { useMemo, useState } from 'react';
import { parseSets } from '@/lib/fitness/set-parser';
import {
  parsedSetsFromWire,
  wireSetsFromParsed,
  SESSION_TYPE_OPTIONS,
  type WorkoutWire,
} from '@/lib/fitness/api-types';
import { formatSets } from '@/lib/fitness/set-parser';

// ---------------------------------------------------------------------------
// Inline form for one workout session: session fields plus FULL entry
// replacement (the PATCH contract — the entries array sent replaces all
// existing entries in order). Sets are edited as the owner's shorthand
// ("330x12 / 330x8"); parseSets structures what it can and the raw string is
// preserved verbatim as ground truth, so unparsed tokens warn but never block.
//
// Two modes: `session` present = edit (prefilled, PATCH body); absent =
// create (blank defaults, today, one starter entry row — the same body shape
// works as the POST /api/workouts payload).
// ---------------------------------------------------------------------------

interface EntryDraft {
  exerciseName: string;
  setsText: string;
  notes: string;
}

export interface SessionEditFormProps {
  /** Session to edit; omit to log a new one (create mode). */
  session?: WorkoutWire;
  /** Receives the wire-shaped (snake_case) PATCH/POST body. Must throw on failure. */
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

/** ISO timestamp → value for <input type="datetime-local"> (local clock). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function draftFromEntry(entry: WorkoutWire['entries'][number]): EntryDraft {
  const parsed = parsedSetsFromWire(entry.sets);
  return {
    exerciseName: entry.exercise.name,
    // Prefer the structured sets (canonical display); fall back to the raw
    // string for parse-gap entries imported with sets: [].
    setsText: parsed.length > 0 ? formatSets(parsed) : (entry.raw_sets ?? ''),
    notes: entry.notes ?? '',
  };
}

/** '' → null, otherwise the parsed number (for nullable numeric fields). */
function numOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};

const labelClass = 'text-xs font-medium';
const labelStyle: React.CSSProperties = { color: 'var(--color-text-muted)' };
const fieldClass = 'w-full rounded-lg border px-2.5 py-1.5 text-sm';

export default function SessionEditForm({ session, onSave, onCancel }: SessionEditFormProps) {
  const [type, setType] = useState<string>(session?.type ?? 'strength');
  const [label, setLabel] = useState(session?.label ?? '');
  const [startedAt, setStartedAt] = useState(() =>
    isoToLocalInput(session?.started_at ?? new Date().toISOString()),
  );
  const [durationMin, setDurationMin] = useState(session?.duration_min?.toString() ?? '');
  const [energy, setEnergy] = useState(session?.energy?.toString() ?? '');
  const [notes, setNotes] = useState(session?.notes ?? '');
  // Cardio fields
  const [distanceMi, setDistanceMi] = useState(session?.distance_mi?.toString() ?? '');
  const [avgHr, setAvgHr] = useState(session?.avg_hr?.toString() ?? '');
  const [calories, setCalories] = useState(session?.calories?.toString() ?? '');
  const [steps, setSteps] = useState(session?.steps?.toString() ?? '');
  const [machine, setMachine] = useState(session?.machine ?? '');
  const [perceivedEffort, setPerceivedEffort] = useState(
    session?.perceived_effort?.toString() ?? '',
  );
  const [entries, setEntries] = useState<EntryDraft[]>(() =>
    session
      ? session.entries.map(draftFromEntry)
      : [{ exerciseName: '', setsText: '', notes: '' }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Non-blocking parse feedback: which entry rows carry unparsed tokens.
  const parseWarnings = useMemo(
    () =>
      entries.map((e) => {
        const { unparsed } = parseSets(e.setsText);
        return unparsed;
      }),
    [entries],
  );

  function patchEntry(index: number, patch: Partial<EntryDraft>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function removeEntry(index: number) {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function moveEntry(index: number, dir: -1 | 1) {
    setEntries((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Create mode starts with a starter row; rows left fully blank are dropped
    // rather than blocking, so entry-less sessions (cardio) submit cleanly.
    const kept = session
      ? entries
      : entries.filter(
          (en) =>
            en.exerciseName.trim() !== '' || en.setsText.trim() !== '' || en.notes.trim() !== '',
        );
    if (kept.some((en) => en.exerciseName.trim() === '')) {
      setError('Every entry needs an exercise name.');
      return;
    }
    const started = new Date(startedAt);
    if (Number.isNaN(started.getTime())) {
      setError('Started-at must be a valid date and time.');
      return;
    }

    const body: Record<string, unknown> = {
      type,
      label: label.trim() === '' ? null : label.trim(),
      started_at: started.toISOString(),
      duration_min: numOrNull(durationMin),
      energy: numOrNull(energy),
      notes: notes.trim() === '' ? null : notes,
      distance_mi: numOrNull(distanceMi),
      avg_hr: numOrNull(avgHr),
      calories: numOrNull(calories),
      steps: numOrNull(steps),
      machine: machine.trim() === '' ? null : machine.trim(),
      perceived_effort: numOrNull(perceivedEffort),
      entries: kept.map((en) => {
        const { sets } = parseSets(en.setsText);
        return {
          exercise_name: en.exerciseName.trim(),
          sets: wireSetsFromParsed(sets),
          raw_sets: en.setsText.trim() === '' ? null : en.setsText,
          notes: en.notes.trim() === '' ? null : en.notes,
        };
      }),
    };

    setSaving(true);
    try {
      await onSave(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save session');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      // Edit renders inside an expanded SessionCard, so it separates itself
      // with a top border; create renders in its own panel.
      className={session ? 'mt-4 pt-4 space-y-4 border-t' : 'space-y-4'}
      style={{ borderColor: 'var(--border-card)' }}
      aria-label={session ? 'Edit session' : 'Log session'}
    >
      {/* Session fields */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={fieldClass}
            style={inputStyle}
          >
            {SESSION_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Day A"
            className={fieldClass}
            style={inputStyle}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Started at</span>
          <input
            type="datetime-local"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            className={fieldClass}
            style={inputStyle}
            required
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Duration (min)</span>
          <input
            type="number"
            min={1}
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            className={fieldClass}
            style={inputStyle}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Energy (1–5)</span>
          <input
            type="number"
            min={1}
            max={5}
            value={energy}
            onChange={(e) => setEnergy(e.target.value)}
            className={fieldClass}
            style={inputStyle}
          />
        </label>
      </div>

      {/* Cardio fields — only meaningful for cardio sessions */}
      {type === 'cardio' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(
            [
              ['Distance (mi)', distanceMi, setDistanceMi],
              ['Avg HR', avgHr, setAvgHr],
              ['Calories', calories, setCalories],
              ['Steps', steps, setSteps],
            ] as const
          ).map(([fieldLabel, value, setter]) => (
            <label key={fieldLabel} className="space-y-1">
              <span className={labelClass} style={labelStyle}>{fieldLabel}</span>
              <input
                type="number"
                min={0}
                step="any"
                value={value}
                onChange={(e) => setter(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              />
            </label>
          ))}
          <label className="space-y-1">
            <span className={labelClass} style={labelStyle}>Machine</span>
            <input
              type="text"
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
              className={fieldClass}
              style={inputStyle}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass} style={labelStyle}>Effort (1–5)</span>
            <input
              type="number"
              min={1}
              max={5}
              value={perceivedEffort}
              onChange={(e) => setPerceivedEffort(e.target.value)}
              className={fieldClass}
              style={inputStyle}
            />
          </label>
        </div>
      )}

      <label className="block space-y-1">
        <span className={labelClass} style={labelStyle}>Session notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={fieldClass}
          style={inputStyle}
        />
      </label>

      {/* Entries — full replacement */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            Entries
          </span>
          <button
            type="button"
            onClick={() =>
              setEntries((prev) => [...prev, { exerciseName: '', setsText: '', notes: '' }])
            }
            className="px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer"
            style={{ border: '1px solid var(--border-card)', color: 'var(--color-sage)' }}
          >
            + Add entry
          </button>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {session
            ? 'Saving replaces the session’s entries with this list, in order. '
            : ''}
          Sets use the shorthand grammar: <span className="font-mono">330x12 / 330x8</span>,{' '}
          <span className="font-mono">50/side x12</span>, <span className="font-mono">75s</span>,{' '}
          <span className="font-mono">130x10 x3</span>, trailing <span className="font-mono">warmup</span>.
        </p>
        {entries.map((entry, i) => (
          <div
            key={i}
            className="rounded-lg border p-3 space-y-2"
            style={{ borderColor: 'var(--border-card)' }}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={entry.exerciseName}
                onChange={(e) => patchEntry(i, { exerciseName: e.target.value })}
                placeholder="Exercise name"
                aria-label={`Entry ${i + 1} exercise name`}
                className={fieldClass}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => moveEntry(i, -1)}
                disabled={i === 0}
                aria-label={`Move entry ${i + 1} up`}
                className="px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-30"
                style={{ border: '1px solid var(--border-card)', color: 'var(--color-text-muted)' }}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveEntry(i, 1)}
                disabled={i === entries.length - 1}
                aria-label={`Move entry ${i + 1} down`}
                className="px-2 py-1 rounded text-xs cursor-pointer disabled:opacity-30"
                style={{ border: '1px solid var(--border-card)', color: 'var(--color-text-muted)' }}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeEntry(i)}
                aria-label={`Remove entry ${i + 1}`}
                className="px-2 py-1 rounded text-xs cursor-pointer"
                style={{ border: '1px solid var(--border-card)', color: 'var(--color-terracotta)' }}
              >
                Remove
              </button>
            </div>
            <input
              type="text"
              value={entry.setsText}
              onChange={(e) => patchEntry(i, { setsText: e.target.value })}
              placeholder="330x12 / 330x12 / 330x8"
              aria-label={`Entry ${i + 1} sets`}
              className={`${fieldClass} font-mono`}
              style={inputStyle}
            />
            {parseWarnings[i].length > 0 && (
              <p className="text-[11px]" style={{ color: 'var(--color-warning)' }}>
                Unrecognized set tokens (kept as raw text):{' '}
                {parseWarnings[i].join(', ')}
              </p>
            )}
            <input
              type="text"
              value={entry.notes}
              onChange={(e) => patchEntry(i, { notes: e.target.value })}
              placeholder="Entry notes"
              aria-label={`Entry ${i + 1} notes`}
              className={fieldClass}
              style={inputStyle}
            />
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
        >
          {saving ? 'Saving…' : session ? 'Save changes' : 'Log session'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
          style={{ backgroundColor: 'var(--border-card)', color: 'var(--color-text-primary)' }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
