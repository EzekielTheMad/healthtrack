'use client';

import React, { useMemo, useState } from 'react';
import { useGoalManager } from '@/hooks/useGoalManager';
import { useExerciseCatalog } from '@/hooks/useExerciseCatalog';
import { METRICS, getMetric } from '@/lib/metrics/registry';
import {
  GOAL_DIRECTION_OPTIONS,
  SESSION_TYPE_OPTIONS,
  type ExerciseWire,
  type GoalWire,
} from '@/lib/fitness/api-types';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

// ---------------------------------------------------------------------------
// Goals & catalog tab — goals CRUD (create form with kind-specific fields,
// per-goal active toggles; the one-active-per-slot 409 surfaces as an inline
// error) plus the unreviewed-exercises cleanup card (rename / alias /
// confirm → PATCH /api/exercises/{id}; resolution collisions surface inline).
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};
const fieldClass = 'w-full rounded-lg border px-2.5 py-1.5 text-sm';
const labelClass = 'text-xs font-medium';
const labelStyle: React.CSSProperties = { color: 'var(--color-text-muted)' };
const cardClass = 'rounded-xl border p-5';
const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  borderColor: 'var(--border-card)',
};

/** Human description of a goal row: "Decrease Weight → 210 lb by 2026-10-01". */
export function describeGoal(goal: GoalWire): string {
  if (goal.kind === 'frequency') {
    return `${goal.per_week}× ${goal.session_type} per week`;
  }
  const metric = goal.metric_key ? getMetric(goal.metric_key) : undefined;
  const name = metric?.label ?? goal.metric_key ?? 'metric';
  const direction = goal.direction
    ? goal.direction.charAt(0).toUpperCase() + goal.direction.slice(1)
    : '';
  let out = `${direction} ${name}`.trim();
  if (goal.target_value !== null) {
    out += ` → ${goal.target_value}${metric?.unit ? ` ${metric.unit}` : ''}`;
  }
  if (goal.target_date !== null) out += ` by ${goal.target_date}`;
  return out;
}

// ---------------------------------------------------------------------------
// Goal creation form
// ---------------------------------------------------------------------------

export interface GoalFormProps {
  /** Receives the wire-shaped (snake_case) POST body. Must throw on failure
      (409 duplicate-slot conflicts render inline). */
  onCreate: (body: Record<string, unknown>) => Promise<void>;
}

export function GoalForm({ onCreate }: GoalFormProps) {
  const [kind, setKind] = useState<'metric' | 'frequency'>('metric');
  const [metricKey, setMetricKey] = useState('weight');
  const [direction, setDirection] = useState<string>('decrease');
  const [targetValue, setTargetValue] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [sessionType, setSessionType] = useState<string>('strength');
  const [perWeek, setPerWeek] = useState('3');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const body: Record<string, unknown> =
      kind === 'metric'
        ? {
            kind,
            metric_key: metricKey,
            direction,
            ...(targetValue.trim() !== '' ? { target_value: Number(targetValue) } : {}),
            ...(targetDate !== '' ? { target_date: targetDate } : {}),
          }
        : {
            kind,
            session_type: sessionType,
            per_week: Number(perWeek),
          };

    setSaving(true);
    try {
      await onCreate(body);
      setTargetValue('');
      setTargetDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create goal');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" aria-label="New goal">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        New goal
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'metric' | 'frequency')}
            className={fieldClass}
            style={inputStyle}
          >
            <option value="metric">Metric target</option>
            <option value="frequency">Session frequency</option>
          </select>
        </label>

        {kind === 'metric' ? (
          <>
            <label className="space-y-1">
              <span className={labelClass} style={labelStyle}>Metric</span>
              <select
                value={metricKey}
                onChange={(e) => setMetricKey(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              >
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass} style={labelStyle}>Direction</span>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              >
                {GOAL_DIRECTION_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass} style={labelStyle}>Target value (optional)</span>
              <input
                type="number"
                step="any"
                min={0}
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass} style={labelStyle}>Target date (optional)</span>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              />
            </label>
          </>
        ) : (
          <>
            <label className="space-y-1">
              <span className={labelClass} style={labelStyle}>Session type</span>
              <select
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              >
                {SESSION_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass} style={labelStyle}>Per week</span>
              <input
                type="number"
                min={1}
                max={21}
                required
                value={perWeek}
                onChange={(e) => setPerWeek(e.target.value)}
                className={fieldClass}
                style={inputStyle}
              />
            </label>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer disabled:opacity-60"
        style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
      >
        {saving ? 'Creating…' : 'Create goal'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Goal list with active toggles
// ---------------------------------------------------------------------------

export interface GoalListProps {
  goals: GoalWire[];
  /** PATCH {active}. Must throw on failure (409 re-activation conflicts). */
  onToggle: (id: string, active: boolean) => Promise<void>;
}

export function GoalList({ goals, onToggle }: GoalListProps) {
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  if (goals.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        No goals yet — create one above. Active goals drive trend coloring and the
        weekly frequency bars.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {goals.map((goal) => (
        <li
          key={goal.id}
          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--border-card)' }}
        >
          <span className="min-w-0">
            <span
              className="text-sm block truncate"
              style={{
                color: goal.active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              {describeGoal(goal)}
            </span>
            {rowError?.id === goal.id && (
              <span role="alert" className="text-xs block" style={{ color: 'var(--color-terracotta)' }}>
                {rowError.message}
              </span>
            )}
          </span>
          <span className="flex items-center gap-2 shrink-0">
            {goal.active && (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ color: 'var(--color-sage)', backgroundColor: 'rgba(129, 178, 154, 0.12)' }}
              >
                active
              </span>
            )}
            <button
              type="button"
              onClick={async () => {
                setRowError(null);
                try {
                  await onToggle(goal.id, !goal.active);
                } catch (err) {
                  setRowError({
                    id: goal.id,
                    message: err instanceof Error ? err.message : 'Failed to update goal',
                  });
                }
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{
                border: '1px solid var(--border-card)',
                color: goal.active ? 'var(--color-text-muted)' : 'var(--color-sage)',
              }}
            >
              {goal.active ? 'Deactivate' : 'Activate'}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Unreviewed-exercises cleanup card
// ---------------------------------------------------------------------------

interface CleanupRowProps {
  exercise: ExerciseWire;
  /** PATCH body (snake_case). Must throw on failure (400 collisions). */
  onConfirm: (id: string, body: Record<string, unknown>) => Promise<void>;
}

function CleanupRow({ exercise, onConfirm }: CleanupRowProps) {
  const [name, setName] = useState(exercise.name);
  const [variant, setVariant] = useState(exercise.variant ?? '');
  const [aliases, setAliases] = useState(exercise.aliases.join(', '));
  const [mode, setMode] = useState<string>(exercise.mode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    if (name.trim() === '') {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    try {
      await onConfirm(exercise.id, {
        name: name.trim(),
        variant: variant.trim() === '' ? null : variant.trim(),
        aliases: aliases
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a !== ''),
        mode,
        review_status: 'confirmed',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update exercise');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-card)' }}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`Rename ${exercise.name}`}
            className={fieldClass}
            style={inputStyle}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Variant</span>
          <input
            type="text"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            placeholder="Hammer high"
            className={fieldClass}
            style={inputStyle}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Aliases (comma-separated)</span>
          <input
            type="text"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            aria-label={`Aliases for ${exercise.name}`}
            className={fieldClass}
            style={inputStyle}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass} style={labelStyle}>Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className={fieldClass}
            style={inputStyle}
          >
            <option value="weight">weight</option>
            <option value="time">time</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--color-terracotta)' }}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={saving}
        className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-60"
        style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
      >
        {saving ? 'Saving…' : 'Save & confirm'}
      </button>
    </div>
  );
}

export interface UnreviewedExercisesCardProps {
  exercises: ExerciseWire[];
  onConfirm: (id: string, body: Record<string, unknown>) => Promise<void>;
}

export function UnreviewedExercisesCard({ exercises, onConfirm }: UnreviewedExercisesCardProps) {
  return (
    <section className={cardClass} style={cardStyle} aria-label="Unreviewed exercises">
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
        Unreviewed exercises
        <span className="ml-2 font-mono" style={{ color: 'var(--color-warning)' }}>
          {exercises.length}
        </span>
      </h3>
      <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
        Names that arrived in workout logs without a catalog match. Fix the canonical
        name, keep the drifted spelling as an alias, and confirm.
      </p>
      {exercises.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-sage)' }}>
          Catalog is clean — nothing to review.
        </p>
      ) : (
        <div className="space-y-2">
          {exercises.map((e) => (
            <CleanupRow key={e.id} exercise={e} onConfirm={onConfirm} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Data-fetching tab
// ---------------------------------------------------------------------------

export default function GoalsView() {
  const { goals, loading: goalsLoading, error: goalsError, createGoal, updateGoal } =
    useGoalManager();
  const {
    exercises,
    loading: catalogLoading,
    error: catalogError,
    updateExercise,
  } = useExerciseCatalog();

  const unreviewed = useMemo(
    () => exercises.filter((e) => e.review_status === 'unreviewed'),
    [exercises],
  );

  const loading = goalsLoading || catalogLoading;
  const error = goalsError ?? catalogError;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(224, 122, 95, 0.12)',
            borderColor: 'var(--color-terracotta)',
            color: 'var(--color-terracotta)',
          }}
        >
          {error}
        </div>
      )}

      <section className={cardClass} style={cardStyle} aria-label="Goals">
        <GoalForm
          onCreate={async (body) => {
            await createGoal(body);
          }}
        />
        <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border-card)' }}>
          {goals.length === 0 ? (
            <EmptyState
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-10 w-10"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="5" />
                  <circle cx="12" cy="12" r="1" />
                </svg>
              }
              title="No goals yet"
              description="Set a metric target (weight, HRV, …) or a weekly session frequency. Active goals drive trend coloring and the weekly progress bars."
            />
          ) : (
            <GoalList
              goals={goals}
              onToggle={async (id, active) => {
                await updateGoal(id, { active });
              }}
            />
          )}
        </div>
      </section>

      <UnreviewedExercisesCard
        exercises={unreviewed}
        onConfirm={async (id, body) => {
          await updateExercise(id, body);
        }}
      />
    </div>
  );
}
