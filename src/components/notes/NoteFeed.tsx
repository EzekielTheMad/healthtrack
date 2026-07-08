'use client';

import React, { useState } from 'react';
import type { Note, NoteType } from '@/lib/types';

interface NoteFeedProps {
  notes: Note[];
  onDelete: (id: string) => Promise<void>;
}

const TYPE_BADGE_STYLES: Record<NoteType, { color: string; bg: string }> = {
  symptom: { color: 'var(--color-terracotta)', bg: 'rgba(224, 122, 95, 0.12)' },
  observation: { color: 'var(--color-sage)', bg: 'rgba(129, 178, 154, 0.12)' },
  general: { color: 'var(--color-text-muted)', bg: 'rgba(155, 155, 155, 0.12)' },
};

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} month${diffMonth !== 1 ? 's' : ''} ago`;
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function SeverityDots({ severity }: { severity: number }) {
  const getColor = (level: number): string => {
    if (level <= 2) return 'var(--color-sage)';
    if (level === 3) return 'var(--color-warning)';
    return 'var(--color-terracotta)';
  };

  return (
    <div className="flex items-center gap-1" aria-label={`Severity ${severity} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="inline-block w-2 h-2 rounded-full"
          style={{
            backgroundColor: i < severity ? getColor(severity) : 'var(--border-card)',
          }}
        />
      ))}
    </div>
  );
}

export default function NoteFeed({ notes, onDelete }: NoteFeedProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    await onDelete(id);
    setDeletingId(null);
    setConfirmingId(null);
  }

  if (notes.length === 0) return null;

  return (
    <div className="space-y-3" role="feed" aria-label="Notes feed">
      {notes.map((note) => {
        const badge = TYPE_BADGE_STYLES[note.note_type];
        return (
          <article
            key={note.id}
            className="rounded-xl border p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <time
                  className="text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={formatFullDate(note.recorded_at)}
                  dateTime={note.recorded_at}
                >
                  {formatRelativeTime(note.recorded_at)}
                </time>
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium capitalize"
                  style={{ color: badge.color, backgroundColor: badge.bg }}
                >
                  {note.note_type}
                </span>
                {note.note_type === 'symptom' && note.severity != null && (
                  <SeverityDots severity={note.severity} />
                )}
              </div>

              {/* Delete */}
              <div className="flex items-center gap-2">
                {confirmingId === note.id ? (
                  <>
                    <span className="text-xs" style={{ color: 'var(--color-terracotta)' }}>
                      Delete?
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(note.id)}
                      disabled={deletingId === note.id}
                      className="text-xs font-medium px-2 py-1 rounded cursor-pointer disabled:opacity-50"
                      style={{ color: 'var(--color-terracotta)', backgroundColor: 'rgba(224, 122, 95, 0.12)' }}
                      aria-label="Confirm delete"
                    >
                      {deletingId === note.id ? 'Deleting...' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="text-xs font-medium px-2 py-1 rounded cursor-pointer"
                      style={{ color: 'var(--color-text-muted)' }}
                      aria-label="Cancel delete"
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(note.id)}
                    className="text-xs cursor-pointer hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label={`Delete note from ${formatFullDate(note.recorded_at)}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text-primary)' }}>
              {note.content}
            </p>

            {/* Tags */}
            {note.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium"
                    style={{ color: 'var(--accent-purple)', backgroundColor: 'rgba(167, 139, 250, 0.12)' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
