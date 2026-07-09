'use client';

import { METRIC_CATALOG, getMetricDefinition, buildLabResultDefinition } from '@/lib/dashboard-metrics';
import type { DashboardStatPreference } from '@/lib/types';

interface AvailableLabTest {
  testName: string;
  unit: string | null;
  latestValue: number;
  flag: string | null;
}

interface DashboardCustomizerProps {
  stats: DashboardStatPreference[];
  availableLabTests: AvailableLabTest[];
  onAddStat: (widgetType: 'vital' | 'lab_result', metricKey: string) => void;
  onRemoveStat: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  onClose: () => void;
}

export default function DashboardCustomizer({
  stats,
  availableLabTests,
  onAddStat,
  onRemoveStat,
  onToggleVisibility,
  onTogglePinned,
  onReorder,
  onClose,
}: DashboardCustomizerProps) {
  const sorted = [...stats].sort((a, b) => a.position - b.position);
  const visible = sorted.filter((s) => s.visible);
  const hidden = sorted.filter((s) => !s.visible);

  // Vitals not yet added
  const addedVitalKeys = new Set(
    stats.filter((s) => s.widget_type === 'vital').map((s) => s.metric_key),
  );
  const availableVitals = METRIC_CATALOG.filter((m) => !addedVitalKeys.has(m.metricKey));

  // Lab tests not yet added
  const addedLabKeys = new Set(
    stats.filter((s) => s.widget_type === 'lab_result').map((s) => s.metric_key),
  );
  const availableLabs = availableLabTests.filter((t) => !addedLabKeys.has(t.testName));

  function getLabel(stat: DashboardStatPreference): string {
    if (stat.widget_type === 'vital') {
      return getMetricDefinition(stat.metric_key)?.label ?? stat.metric_key;
    }
    return stat.metric_key; // lab test name is the label
  }

  function getTypeBadge(stat: DashboardStatPreference) {
    if (stat.widget_type === 'lab_result') {
      return (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
          style={{ backgroundColor: 'rgba(167, 139, 250, 0.12)', color: 'var(--accent-purple)' }}
        >
          Lab
        </span>
      );
    }
    return null;
  }

  return (
    <div
      className="rounded-xl border p-5 space-y-4"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Customize Stats
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ backgroundColor: 'var(--color-sage)', color: 'var(--color-bark)' }}
        >
          Done
        </button>
      </div>

      {/* Active stats */}
      {visible.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Active
          </p>
          <ul className="space-y-1">
            {visible.map((stat, idx) => (
              <li
                key={stat.id}
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ backgroundColor: 'var(--bg-primary)' }}
              >
                {/* Reorder */}
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => onReorder(stat.id, 'up')}
                    disabled={idx === 0}
                    className="text-[10px] leading-none disabled:opacity-20 cursor-pointer disabled:cursor-default"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorder(stat.id, 'down')}
                    disabled={idx === visible.length - 1}
                    className="text-[10px] leading-none disabled:opacity-20 cursor-pointer disabled:cursor-default"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                </div>

                {/* Label + type badge */}
                <span className="flex-1 text-sm font-medium truncate flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                  {getLabel(stat)}
                  {getTypeBadge(stat)}
                </span>

                {/* Pin toggle */}
                <button
                  type="button"
                  onClick={() => onTogglePinned(stat.id)}
                  className="text-sm cursor-pointer"
                  title={stat.pinned ? 'Unpin' : 'Pin to top'}
                  style={{ color: stat.pinned ? 'var(--color-terracotta)' : 'var(--color-text-muted)', opacity: stat.pinned ? 1 : 0.4 }}
                >
                  ★
                </button>

                {/* Visibility toggle */}
                <button
                  type="button"
                  onClick={() => onToggleVisibility(stat.id)}
                  className="text-xs cursor-pointer"
                  title="Hide from dashboard"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hidden stats */}
      {hidden.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Hidden
          </p>
          <ul className="space-y-1">
            {hidden.map((stat) => (
              <li
                key={stat.id}
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ backgroundColor: 'var(--bg-primary)', opacity: 0.6 }}
              >
                <span className="flex-1 text-sm truncate flex items-center gap-2" style={{ color: 'var(--color-text-muted)' }}>
                  {getLabel(stat)}
                  {getTypeBadge(stat)}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleVisibility(stat.id)}
                  className="text-xs font-medium cursor-pointer"
                  style={{ color: 'var(--color-sage)' }}
                >
                  Show
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveStat(stat.id)}
                  className="text-xs font-medium cursor-pointer"
                  style={{ color: 'var(--color-terracotta)' }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Available vitals, grouped by registry category (the catalog is ~60
          metrics — a flat pill list is unusable) */}
      {availableVitals.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Available Vitals
          </p>
          {Array.from(new Set(availableVitals.map((m) => m.category))).map((category) => (
            <div key={category} className="space-y-1">
              <p className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {category}
              </p>
              <div className="flex flex-wrap gap-2">
                {availableVitals
                  .filter((m) => m.category === category)
                  .map((metric) => (
                    <button
                      key={metric.metricKey}
                      type="button"
                      onClick={() => onAddStat('vital', metric.metricKey)}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer"
                      style={{
                        borderColor: 'var(--border-card)',
                        color: 'var(--color-text-primary)',
                        backgroundColor: 'transparent',
                      }}
                    >
                      <span style={{ color: 'var(--color-sage)' }}>+</span>
                      {metric.label}
                      {metric.displayUnit && (
                        <span style={{ color: 'var(--color-text-muted)' }}>
                          ({metric.displayUnit})
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Available lab tests */}
      {availableLabs.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            From Your Labs
          </p>
          <div className="flex flex-wrap gap-2">
            {availableLabs.map((lab) => (
              <button
                key={lab.testName}
                type="button"
                onClick={() => onAddStat('lab_result', lab.testName)}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer"
                style={{
                  borderColor: 'var(--border-card)',
                  color: 'var(--color-text-primary)',
                  backgroundColor: 'transparent',
                }}
              >
                <span style={{ color: 'var(--color-sage)' }}>+</span>
                {lab.testName}
                <span className="font-mono" style={{ color: 'var(--color-text-muted)' }}>
                  {lab.latestValue} {lab.unit ?? ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {availableVitals.length === 0 && availableLabs.length === 0 && visible.length > 0 && (
        <p className="text-xs text-center py-2" style={{ color: 'var(--color-text-muted)' }}>
          All available stats have been added.
        </p>
      )}
    </div>
  );
}
