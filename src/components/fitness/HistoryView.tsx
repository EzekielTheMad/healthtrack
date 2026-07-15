'use client';

import React, { useMemo, useState } from 'react';
import { useWorkoutSessions } from '@/hooks/useWorkoutSessions';
import { formatSets } from '@/lib/fitness/set-parser';
import {
  parsedSetsFromWire,
  SESSION_TYPE_OPTIONS,
  type EntryWire,
  type WorkoutWire,
} from '@/lib/fitness/api-types';
import { formatDuration, formatMetricValue } from '@/lib/metrics/format';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import SessionEditForm from './SessionEditForm';

// ---------------------------------------------------------------------------
// History tab — filterable session list (type / label / date range) with
// expandable rows: ordered entries with per-set breakdowns (formatSets),
// notes, energy, and cardio fields for cardio sessions; inline edit
// (SessionEditForm → PATCH with full entry replacement), delete with a
// two-step confirm, and manual logging ("Log session" → SessionEditForm in
// create mode → POST /api/workouts, panel above the list like the
// medications page's add form).
// ---------------------------------------------------------------------------

// Session-type badge tints (muted rgba of the app palette, see FocusView).
const TYPE_BADGE: Record<string, { color: string; bg: string }> = {
  strength: { color: 'var(--color-sage)', bg: 'rgba(129, 178, 154, 0.12)' },
  cardio: { color: 'var(--color-warning)', bg: 'rgba(233, 196, 106, 0.15)' },
  mobility: { color: 'var(--color-text-muted)', bg: 'rgba(155, 155, 155, 0.12)' },
  other: { color: 'var(--color-text-muted)', bg: 'rgba(155, 155, 155, 0.12)' },
};

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Per-set breakdown text: structured sets when parsed, raw string otherwise. */
export function entrySetsDisplay(entry: EntryWire): string {
  const parsed = parsedSetsFromWire(entry.sets);
  if (parsed.length > 0) return formatSets(parsed);
  return entry.raw_sets ?? '—';
}

/** Derived working summary: "330 lb × 12" / "75s" for time-mode entries. */
function entryDerivedSummary(entry: EntryWire): string | null {
  if (entry.exercise.mode === 'time') {
    return entry.top_seconds !== null ? `top ${entry.top_seconds}s` : null;
  }
  if (entry.working_weight === null) return null;
  const reps = entry.top_reps !== null ? ` × ${entry.top_reps}` : '';
  return `working ${formatMetricValue(entry.working_weight, 1)} lb${reps}`;
}

interface SessionCardProps {
  session: WorkoutWire;
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function SessionCard({ session, onSave, onDelete }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const badge = TYPE_BADGE[session.type] ?? TYPE_BADGE.other;

  async function handleDelete() {
    setDeleteError(null);
    try {
      await onDelete(session.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete session');
      setConfirmingDelete(false);
    }
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      {/* Header row — expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"
      >
        <span className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ color: badge.color, backgroundColor: badge.bg }}
          >
            {session.type}
          </span>
          {session.label && (
            <span
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {session.label}
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {formatSessionDate(session.started_at)}
          </span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          {session.duration_min !== null && (
            <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
              {formatDuration(session.duration_min)}
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {session.entries.length > 0 &&
              `${session.entries.length} exercise${session.entries.length === 1 ? '' : 's'}`}
          </span>
          <span aria-hidden="true" style={{ color: 'var(--color-text-muted)' }}>
            {expanded ? '▾' : '▸'}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: 'var(--border-card)' }}>
          {/* Ordered entries with per-set breakdown */}
          {session.entries.length > 0 && (
            <ol className="space-y-2">
              {session.entries.map((entry) => {
                const derived = entryDerivedSummary(entry);
                return (
                  <li key={entry.id} className="text-sm">
                    <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {entry.exercise.name}
                      {entry.exercise.variant && (
                        <span style={{ color: 'var(--color-text-muted)' }}>
                          {' '}({entry.exercise.variant})
                        </span>
                      )}
                    </span>
                    <span className="ml-2 font-mono text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {entrySetsDisplay(entry)}
                    </span>
                    {derived && (
                      <span className="ml-2 text-[11px]" style={{ color: 'var(--color-sage)' }}>
                        {derived}
                      </span>
                    )}
                    {entry.notes && (
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {entry.notes}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {/* Cardio fields */}
          {session.type === 'cardio' && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {session.distance_mi !== null && <span>{session.distance_mi} mi</span>}
              {session.avg_hr !== null && <span>{session.avg_hr} bpm avg</span>}
              {session.calories !== null && (
                <span>{formatMetricValue(session.calories, 0)} cal</span>
              )}
              {session.steps !== null && (
                <span>{formatMetricValue(session.steps, 0)} steps</span>
              )}
              {session.machine && <span>{session.machine}</span>}
              {session.perceived_effort !== null && (
                <span>effort {session.perceived_effort}/5</span>
              )}
            </div>
          )}

          {/* Energy + notes */}
          {session.energy !== null && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Energy {session.energy}/5
            </p>
          )}
          {session.notes && (
            <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
              {session.notes}
            </p>
          )}

          {/* Actions */}
          {!editing && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ border: '1px solid var(--border-card)', color: 'var(--color-sage)' }}
              >
                Edit
              </button>
              {confirmingDelete ? (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                    style={{ backgroundColor: 'var(--color-terracotta)', color: 'white' }}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                    style={{ border: '1px solid var(--border-card)', color: 'var(--color-text-muted)' }}
                  >
                    Keep
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                  style={{ border: '1px solid var(--border-card)', color: 'var(--color-terracotta)' }}
                >
                  Delete
                </button>
              )}
            </div>
          )}
          {deleteError && (
            <p role="alert" className="text-xs" style={{ color: 'var(--color-terracotta)' }}>
              {deleteError}
            </p>
          )}

          {/* Inline edit form */}
          {editing && (
            <SessionEditForm
              session={session}
              onSave={async (body) => {
                await onSave(session.id, body);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export interface SessionListProps {
  sessions: WorkoutWire[];
  onSave: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Presentational session list (exported for tests). */
export function SessionList({ sessions, onSave, onDelete }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div
        className="rounded-xl border"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
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
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5v9m10.5-9v9M4 9.75v4.5m16-4.5v4.5M6.75 12h10.5" />
            </svg>
          }
          title="No sessions found"
          description="No workout sessions match these filters yet. Log one with the button above — sessions from your agent or the API show up here too."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          onSave={onSave}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

/** Convert a date-input day to the inclusive ISO bounds /api/workouts expects. */
function dayToFromIso(day: string): string | undefined {
  return day ? new Date(`${day}T00:00:00`).toISOString() : undefined;
}
function dayToToIso(day: string): string | undefined {
  return day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined;
}

/** Data-fetching History tab. */
export default function HistoryView() {
  const [type, setType] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const from = useMemo(() => dayToFromIso(fromDay), [fromDay]);
  const to = useMemo(() => dayToToIso(toDay), [toDay]);

  const { sessions, loading, error, createSession, updateSession, deleteSession } =
    useWorkoutSessions({
      from,
      to,
      type: type || undefined,
    });

  // Label filtering is client-side (contains, case-insensitive) — the list
  // endpoint's ?label= is exact-match, which is unhelpful for free text.
  const visible = useMemo(() => {
    const needle = labelFilter.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) => (s.label ?? '').toLowerCase().includes(needle));
  }, [sessions, labelFilter]);

  const filterField = 'rounded-lg border px-2.5 py-1.5 text-sm';
  const filterStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-card)',
    borderColor: 'var(--border-card)',
    color: 'var(--color-text-primary)',
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filter by session type"
          className={filterField}
          style={filterStyle}
        >
          <option value="">All types</option>
          {SESSION_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          type="text"
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          placeholder="Filter by label"
          aria-label="Filter by label"
          className={filterField}
          style={filterStyle}
        />
        <input
          type="date"
          value={fromDay}
          onChange={(e) => setFromDay(e.target.value)}
          aria-label="From date"
          className={filterField}
          style={filterStyle}
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>to</span>
        <input
          type="date"
          value={toDay}
          onChange={(e) => setToDay(e.target.value)}
          aria-label="To date"
          className={filterField}
          style={filterStyle}
        />
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="ml-auto px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--color-sage)', color: 'var(--bg-primary)' }}
          >
            Log session
          </button>
        )}
      </div>

      {/* Manual logging panel — mirrors the medications page's add form */}
      {showCreate && (
        <div
          className="rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            Log session
          </h2>
          <SessionEditForm
            onSave={async (body) => {
              await createSession(body);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

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

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <SessionList
          sessions={visible}
          onSave={async (id, body) => {
            await updateSession(id, body);
          }}
          onDelete={deleteSession}
        />
      )}
    </div>
  );
}
