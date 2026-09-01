'use client';

import { useEffect, useMemo, useState } from 'react';
import Skeleton from '@/components/shared/Skeleton';
import EmptyState from '@/components/shared/EmptyState';
import { shiftDayKey } from '@/lib/dates';

// ---------------------------------------------------------------------------
// Daily nutrition totals — reads ONLY the canonical nutrition_daily snapshot
// (never the raw Health Connect webhook history, per PRD §6.7).
//
// Null is rendered as "—", not 0: a nutrient nobody reported is unknown, and
// showing a zero would misstate the day.
// ---------------------------------------------------------------------------

interface NutritionDay {
  date: string;
  source_package: string;
  calories: number | null;
  protein_grams: number | null;
  carbs_grams: number | null;
  fat_grams: number | null;
  record_count: number;
}

const RANGES = [
  { id: '14', label: '14 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
] as const;

function fmt(value: number | null, decimals = 0): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(decimals);
}

/** Mean over the days that actually reported the nutrient. */
function meanOf(rows: NutritionDay[], key: keyof NutritionDay): number | null {
  const values = rows
    .map((r) => r[key])
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default function NutritionView() {
  const [days, setDays] = useState<(typeof RANGES)[number]['id']>('30');
  const [rows, setRows] = useState<NutritionDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const today = new Date().toISOString().slice(0, 10);
      const start = shiftDayKey(today, -Number(days));
      try {
        const res = await fetch(
          `/api/nutrition/daily?start_date=${start}&end_date=${today}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message ?? body?.error ?? 'Failed to load nutrition');
        }
        const data = (await res.json()) as NutritionDay[];
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load nutrition');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const averages = useMemo(
    () => ({
      calories: meanOf(rows, 'calories'),
      protein: meanOf(rows, 'protein_grams'),
      carbs: meanOf(rows, 'carbs_grams'),
      fat: meanOf(rows, 'fat_grams'),
    }),
    [rows],
  );

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-card)',
    borderColor: 'var(--border-card)',
  };

  return (
    <div className="space-y-4">
      <div
        className="inline-flex items-center gap-1 rounded-lg border p-1"
        style={cardStyle}
        role="tablist"
        aria-label="Nutrition range"
      >
        {RANGES.map((r) => {
          const active = days === r.id;
          return (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setDays(r.id)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: active ? 'rgba(129, 178, 154, 0.15)' : 'transparent',
                color: active ? 'var(--color-sage)' : 'var(--color-text-muted)',
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            borderColor: 'rgba(248, 113, 113, 0.3)',
            color: 'var(--color-terracotta)',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <Skeleton variant="card" className="h-[200px]" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 2v7c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V2M6 2v20M17 2v20c2.2 0 4-1.8 4-4V7c0-2.8-1.8-5-4-5z" />
            </svg>
          }
          title="No nutrition data yet"
          description="Connect the Life Dashboard Android app in Settings → Health Connect and approve your food-tracking app to see daily calories and macros here."
        />
      ) : (
        <>
          {/* Averages over the window */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Avg calories', value: fmt(averages.calories), unit: 'kcal' },
              { label: 'Avg protein', value: fmt(averages.protein), unit: 'g' },
              { label: 'Avg carbs', value: fmt(averages.carbs), unit: 'g' },
              { label: 'Avg fat', value: fmt(averages.fat), unit: 'g' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border p-4" style={cardStyle}>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.label}</p>
                <p className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {s.value}
                  {s.value !== '—' && (
                    <span className="text-xs font-normal ml-1" style={{ color: 'var(--color-text-muted)' }}>
                      {s.unit}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>

          {/* Daily rows, newest first */}
          <div className="rounded-xl border overflow-x-auto" style={cardStyle}>
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr style={{ color: 'var(--color-text-primary)' }}>
                  <th className="py-2 px-4">Date</th>
                  <th className="py-2 px-4">Calories</th>
                  <th className="py-2 px-4">Protein</th>
                  <th className="py-2 px-4">Carbs</th>
                  <th className="py-2 px-4">Fat</th>
                  <th className="py-2 px-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr
                    key={`${r.date}:${r.source_package}`}
                    style={{ borderTop: '1px solid var(--border-card)' }}
                  >
                    <td className="py-2 px-4" style={{ color: 'var(--color-text-primary)' }}>{r.date}</td>
                    <td className="py-2 px-4" style={{ color: 'var(--color-text-muted)' }}>{fmt(r.calories)}</td>
                    <td className="py-2 px-4" style={{ color: 'var(--color-text-muted)' }}>{fmt(r.protein_grams, 1)}</td>
                    <td className="py-2 px-4" style={{ color: 'var(--color-text-muted)' }}>{fmt(r.carbs_grams, 1)}</td>
                    <td className="py-2 px-4" style={{ color: 'var(--color-text-muted)' }}>{fmt(r.fat_grams, 1)}</td>
                    <td
                      className="py-2 px-4 font-mono text-xs"
                      style={{ color: 'var(--color-text-muted)' }}
                      title={`${r.record_count} source record(s)`}
                    >
                      {r.source_package}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Days are America/Phoenix calendar dates. Each day is recomputed from your food log
            on every sync, so edits and re-sends correct the day rather than adding to it. A
            dash means the source did not report that nutrient — not zero.
          </p>
        </>
      )}
    </div>
  );
}
