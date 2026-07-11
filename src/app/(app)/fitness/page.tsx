'use client';

import React, { useState } from 'react';
import HistoryView from '@/components/fitness/HistoryView';
import TrendsView from '@/components/fitness/TrendsView';
import WeeklyView from '@/components/fitness/WeeklyView';
import GoalsView from '@/components/fitness/GoalsView';

// ---------------------------------------------------------------------------
// Fitness page — view-first workout tracking (spec §UI): History (sessions),
// Trends (per-exercise charts), Weekly (rollup + check-in), Goals & catalog.
// Logging is agent/API-first, so there is deliberately NO entry wizard here —
// this surface views and corrects. Tab pattern mirrors the vitals page
// (role=tablist, aria-selected, sage tint).
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'history', label: 'History' },
  { id: 'trends', label: 'Trends' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'goals', label: 'Goals & catalog' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function FitnessPage() {
  const [view, setView] = useState<TabId>('history');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Fitness
        </h1>
      </div>

      {/* View toggle — mirrors the vitals tab conventions */}
      <div
        className="inline-flex items-center gap-1 rounded-lg border p-1 flex-wrap"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        role="tablist"
        aria-label="Fitness view"
      >
        {TABS.map((tab) => {
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(tab.id)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
              style={{
                // Sage tint convention (see vitals page / FocusView badges).
                backgroundColor: active ? 'rgba(129, 178, 154, 0.15)' : 'transparent',
                color: active ? 'var(--color-sage)' : 'var(--color-text-muted)',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {view === 'history' ? (
        <HistoryView />
      ) : view === 'trends' ? (
        <TrendsView />
      ) : view === 'weekly' ? (
        <WeeklyView />
      ) : (
        <GoalsView />
      )}
    </div>
  );
}
