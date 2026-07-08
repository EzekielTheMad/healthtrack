'use client';

import React, { useMemo, useState } from 'react';
import { useNotes } from '@/hooks/useNotes';
import type { NoteType } from '@/lib/types';
import NoteEntry from '@/components/notes/NoteEntry';
import NoteFeed from '@/components/notes/NoteFeed';
import EmptyState from '@/components/shared/EmptyState';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

type FilterTab = 'all' | NoteType;

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'symptom', label: 'Symptoms' },
  { value: 'observation', label: 'Observations' },
  { value: 'general', label: 'General' },
];

export default function NotesPage() {
  const { notes, loading, error, addNote, deleteNote } = useNotes();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const filteredNotes = useMemo(() => {
    if (activeFilter === 'all') return notes;
    return notes.filter((n) => n.note_type === activeFilter);
  }, [notes, activeFilter]);

  async function handleAddNote(data: {
    content: string;
    note_type: NoteType;
    severity: number | null;
    tags: string[];
    recorded_at: string;
  }) {
    await addNote({
      content: data.content,
      note_type: data.note_type,
      severity: data.severity,
      tags: data.tags,
      recorded_at: data.recorded_at,
    });
  }

  async function handleDelete(id: string) {
    await deleteNote(id);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        Notes &amp; Symptoms
      </h1>

      {/* Note entry form */}
      <NoteEntry onSubmit={handleAddNote} />

      {/* Error */}
      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(224, 122, 95, 0.12)',
            borderColor: 'var(--color-terracotta)',
            color: 'var(--color-terracotta)',
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter notes by type">
        {FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.value;
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveFilter(tab.value)}
              className="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
              style={{
                backgroundColor: isActive ? 'var(--border-card)' : 'transparent',
                color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner size="lg" />
        </div>
      ) : filteredNotes.length === 0 ? (
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                />
              </svg>
            }
            title={
              activeFilter === 'all'
                ? 'No notes yet'
                : `No ${activeFilter} notes`
            }
            description="Record symptoms, side effects, and general health observations to share with your providers."
          />
        </div>
      ) : (
        <NoteFeed notes={filteredNotes} onDelete={handleDelete} />
      )}
    </div>
  );
}
