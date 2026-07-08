'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api/client';
import { METRIC_CATALOG, DEVICE_DEFAULTS, MANUAL_DEFAULTS } from '@/lib/dashboard-metrics';
import { useDashboardStats } from '@/hooks/useDashboardStats';

interface DashboardStatsStepProps {
  onNext: () => void;
  onBack: () => void;
}

const CATEGORIES = ['Heart', 'Sleep', 'Respiratory', 'Blood Pressure'] as const;

export function DashboardStatsStep({ onNext, onBack }: DashboardStatsStepProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const { initializeStats } = useDashboardStats();

  // Determine adaptive defaults based on connected sources
  useEffect(() => {
    let cancelled = false;
    async function checkSources() {
      try {
        const data = await apiFetch<{ source_count: number }>('/api/dashboard-stats');
        if (cancelled) return;
        const defaults = data.source_count > 0 ? DEVICE_DEFAULTS : MANUAL_DEFAULTS;
        setSelected(new Set(defaults));
      } catch {
        if (!cancelled) setSelected(new Set(MANUAL_DEFAULTS));
      }
    }
    checkSources();
    return () => { cancelled = true; };
  }, []);

  function toggleMetric(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleContinue() {
    if (selected.size === 0) {
      onNext();
      return;
    }
    setSaving(true);
    await initializeStats(Array.from(selected));
    setSaving(false);
    onNext();
  }

  const grouped = CATEGORIES.map((cat) => ({
    category: cat,
    metrics: METRIC_CATALOG.filter((m) => m.category === cat),
  })).filter((g) => g.metrics.length > 0);

  return (
    <div
      className="rounded-xl border p-6 space-y-6"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Choose Your Dashboard
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Select the health metrics you&apos;d like to see at a glance. You can change these anytime.
        </p>
      </div>

      {grouped.map(({ category, metrics }) => (
        <div key={category}>
          <h3
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {category}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {metrics.map((metric) => {
              const isSelected = selected.has(metric.metricKey);
              return (
                <button
                  key={metric.metricKey}
                  type="button"
                  onClick={() => toggleMetric(metric.metricKey)}
                  className="flex items-start gap-3 rounded-lg border p-4 text-left transition-all cursor-pointer"
                  style={{
                    borderColor: isSelected ? 'var(--color-sage)' : 'var(--border-card)',
                    backgroundColor: isSelected ? 'rgba(129, 178, 154, 0.08)' : 'transparent',
                  }}
                >
                  {/* Checkbox */}
                  <div
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors"
                    style={{
                      borderColor: isSelected ? 'var(--color-sage)' : 'var(--border-card)',
                      backgroundColor: isSelected ? 'var(--color-sage)' : 'transparent',
                    }}
                  >
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {metric.label}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                        {metric.displayUnit}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {metric.description}
                      {metric.requiresDevice && (
                        <span className="ml-1 italic">(requires device)</span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onNext}
          className="text-sm font-medium transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className="px-6 py-2.5 rounded-full text-sm font-bold transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
            color: 'white',
            boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
          }}
        >
          {saving ? 'Saving...' : `Continue with ${selected.size} stats`}
        </button>
      </div>
    </div>
  );
}
