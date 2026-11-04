'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Skeleton from '@/components/shared/Skeleton';
import EmptyState from '@/components/shared/EmptyState';
import { shiftDayKey } from '@/lib/dates';
import { nutritionSourceLabel, hasFriendlyLabel } from '@/lib/nutrition/sources';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { calendarDayInTimeZone } from '@/lib/oura/timezone';

// ---------------------------------------------------------------------------
// Nutrition — imported ACTUAL intake (PRD §6.7).
//
// HealthTrack is not a food logger and has no targets here: MacroFactor owns
// logging and dynamic targets, and this page shows what it recorded. Reads hit
// ONLY the canonical nutrition_daily snapshot — never the raw Health Connect
// webhook history — through the same repository the PAT endpoint uses.
//
// Three states, never conflated:
//   loading — skeletons;
//   error   — an authorization/network/server failure says so out loud. It must
//             never render as "No nutrition data yet", which would tell the
//             user their food log is empty when the request simply failed;
//   empty   — a successful response with no rows.
//
// Null renders as "—", not 0: a nutrient nobody reported is unknown, and a
// zero would misstate the day.
// ---------------------------------------------------------------------------

export interface NutritionDay {
  date: string;
  source_package: string;
  calories: number | null;
  protein_grams: number | null;
  carbs_grams: number | null;
  fat_grams: number | null;
  record_count: number;
  updated_at?: string | null;
}

const RANGES = [
  { id: '14', label: '14 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

const MACROS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', decimals: 0 },
  { key: 'protein_grams', label: 'Protein', unit: 'g', decimals: 1 },
  { key: 'carbs_grams', label: 'Carbs', unit: 'g', decimals: 1 },
  { key: 'fat_grams', label: 'Fat', unit: 'g', decimals: 1 },
] as const;

/** Unknown is a dash. Zero is zero. */
export function formatNutrient(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

/** Mean over the days that actually reported the nutrient. */
function meanOf(rows: NutritionDay[], key: keyof NutritionDay): number | null {
  const values = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} hr ago`;
  return `${Math.floor(mins / 1440)} d ago`;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  borderColor: 'var(--border-card)',
};

function ForkKnifeIcon({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 2v7c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V2M6 2v20M17 2v20c2.2 0 4-1.8 4-4V7c0-2.8-1.8-5-4-5z" />
    </svg>
  );
}

/** Today's imported intake, or the most recent day the source reported. */
function TodayCard({ day, isToday }: { day: NutritionDay | null; isToday: boolean }) {
  return (
    <section className="rounded-xl border p-4 sm:p-5 space-y-4" style={cardStyle}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {isToday ? 'Today' : 'Most recent day'}
        </h2>
        {day && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {day.date} · {nutritionSourceLabel(day.source_package)} · {day.record_count} item
            {day.record_count === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {day ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {MACROS.map((m) => (
            <div key={m.key}>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {m.label}
              </p>
              <p
                className="text-2xl font-bold font-mono"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {formatNutrient(day[m.key], m.decimals)}
                <span
                  className="text-xs font-normal ml-1"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {m.unit}
                </span>
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Nothing imported for today yet.
        </p>
      )}
    </section>
  );
}

export default function NutritionView({ timeZone = 'Etc/UTC' }: { timeZone?: string }) {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  if (dependentId || delegateOwnerId)
    return (
      <section className="rounded-xl border p-4 space-y-2" style={cardStyle}>
        <h2 className="font-semibold">Nutrition unavailable for this person</h2>
        <p className="text-sm">
          Imported nutrition belongs to the signed-in account. Switch to My Health to view your
          intake.
        </p>
      </section>
    );
  return <OwnerNutrition timeZone={timeZone} />;
}

function OwnerNutrition({ timeZone }: { timeZone: string }) {
  const [days, setDays] = useState<RangeId>('30');
  const [allRows, setRows] = useState<NutritionDay[]>([]);
  const [sourceChoice, setSourceChoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      const today = calendarDayInTimeZone(new Date(), timeZone);
      const start = shiftDayKey(today, -(Number(days) - 1));
      try {
        const res = await fetch(`/api/nutrition/daily?start_date=${start}&end_date=${today}`, {
          signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            body?.message ?? body?.error ?? `Could not load nutrition (HTTP ${res.status}).`
          );
        }
        const data = (await res.json()) as NutritionDay[];
        if (!signal?.aborted) setRows(data);
      } catch (err) {
        if (signal?.aborted) return;
        // An error is NOT an empty log. Say what happened and keep the retry.
        setError(err instanceof Error ? err.message : 'Could not load nutrition.');
        setRows([]);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [days, timeZone]
  );

  useEffect(() => {
    const controller = new AbortController();
    // Read the external daily log for this range; the reusable loader initializes its loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const sources = [...new Set(allRows.map((row) => row.source_package))].sort();
  const selectedSource =
    sourceChoice && sources.includes(sourceChoice)
      ? sourceChoice
      : sources.length === 1
        ? sources[0]
        : null;
  const rows = selectedSource ? allRows.filter((row) => row.source_package === selectedSource) : [];
  const averages = {
    calories: meanOf(rows, 'calories'),
    protein_grams: meanOf(rows, 'protein_grams'),
    carbs_grams: meanOf(rows, 'carbs_grams'),
    fat_grams: meanOf(rows, 'fat_grams'),
  };

  // The API returns oldest-first; the page reads newest-first.
  const newestFirst = [...rows].reverse();
  const todayKey = calendarDayInTimeZone(new Date(), timeZone);
  const latest = newestFirst[0] ?? null;
  const todayRow = latest && latest.date === todayKey ? latest : null;
  const sourceControl =
    sources.length > 1 ? (
      <div className="rounded-xl border p-4 space-y-2" style={cardStyle}>
        <label htmlFor="nutrition-source" className="block text-sm font-medium">
          Nutrition source
        </label>
        <select
          id="nutrition-source"
          value={selectedSource ?? ''}
          onChange={(event) => setSourceChoice(event.target.value || null)}
          className="min-h-11 max-w-full w-full rounded-lg border px-3 text-sm"
          style={{ ...cardStyle, color: 'var(--color-text-primary)' }}
        >
          <option value="">Choose a source</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {nutritionSourceLabel(source)} ({source})
            </option>
          ))}
        </select>
        <p className="text-xs">
          Sources are separate snapshots. Choose one for this view; intake totals and averages are
          never combined across apps.
        </p>
      </div>
    ) : null;

  const rangeTabs = (
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
            className="min-h-11 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
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
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {rangeTabs}
        <Skeleton variant="card" className="h-[160px]" />
        <Skeleton variant="card" className="h-[240px]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {rangeTabs}
        <div
          role="alert"
          className="rounded-xl border px-4 py-4 space-y-3"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.1)',
            borderColor: 'rgba(248, 113, 113, 0.3)',
          }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--color-terracotta)' }}>
            Could not load your nutrition
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => load()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ color: 'var(--color-terracotta)', border: '1px solid rgba(248,113,113,0.3)' }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (allRows.length === 0) {
    return (
      <div className="space-y-4">
        {rangeTabs}
        <EmptyState
          icon={<ForkKnifeIcon />}
          title="No nutrition data yet"
          description="Pair the HealthTrack Android app, or connect your existing Life Dashboard relay in Settings → Integrations → Health Connect. Approve your food-tracking app to show daily calories and macros. Already approved it? Use “Reprocess retained nutrition” in the browser to normalize what was already received."
        />
        <div className="text-center">
          <Link
            href="/settings?tab=integrations#health-connect"
            className="inline-flex min-h-11 items-center rounded-lg px-4 py-2 text-sm underline"
            style={{ color: 'var(--color-sage)' }}
          >
            Set up Health Connect
          </Link>
        </div>
      </div>
    );
  }

  if (!selectedSource)
    return (
      <div className="space-y-4">
        {rangeTabs}
        {sourceControl}
        <p role="status">Choose a nutrition source to see intake and averages.</p>
      </div>
    );

  return (
    <div className="space-y-4">
      {rangeTabs}
      {sourceControl}

      <TodayCard day={todayRow ?? latest} isToday={todayRow !== null} />

      {/* Window averages */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {MACROS.map((m) => (
          <div key={m.key} className="rounded-xl border p-4" style={cardStyle}>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Avg {m.label.toLowerCase()}
            </p>
            <p
              className="text-xl font-bold font-mono"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {formatNutrient(averages[m.key], m.decimals)}
              <span
                className="text-xs font-normal ml-1"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {m.unit}
              </span>
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {
                new Set(rows.filter((row) => typeof row[m.key] === 'number').map((row) => row.date))
                  .size
              }{' '}
              recorded days in this {days}-day window
            </p>
          </div>
        ))}
      </div>

      {/* Daily history, newest first. Scrolls inside its own container so the
          page body never scrolls sideways on a phone. */}
      <section aria-label="Daily nutrition cards" className="space-y-3 sm:hidden">
        {newestFirst.map((row) => (
          <article
            key={`${row.date}:${row.source_package}`}
            className="rounded-xl border p-4 space-y-3"
            style={cardStyle}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="font-semibold">
                <time dateTime={row.date}>
                  {new Date(`${row.date}T12:00:00Z`).toLocaleDateString(undefined, {
                    timeZone: 'UTC',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </time>
              </h2>
              <span className="text-xs break-all" style={{ color: 'var(--color-text-muted)' }}>
                {nutritionSourceLabel(row.source_package)}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              {MACROS.map((macro) => (
                <div key={macro.key}>
                  <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {macro.label}
                  </dt>
                  <dd className="font-mono">
                    {formatNutrient(row[macro.key], macro.decimals)}{' '}
                    <span className="text-xs">{macro.unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {row.record_count} source items · updated {relativeTime(row.updated_at)}
            </p>
          </article>
        ))}
      </section>
      <div className="hidden sm:block rounded-xl border overflow-x-auto" style={cardStyle}>
        <table className="w-full text-sm text-left border-collapse min-w-[640px]">
          <caption className="sr-only">Daily nutrition history, newest first</caption>
          <thead>
            <tr style={{ color: 'var(--color-text-primary)' }}>
              <th scope="col" className="py-2 px-4">
                Date
              </th>
              <th scope="col" className="py-2 px-4">
                Calories
              </th>
              <th scope="col" className="py-2 px-4">
                Protein
              </th>
              <th scope="col" className="py-2 px-4">
                Carbs
              </th>
              <th scope="col" className="py-2 px-4">
                Fat
              </th>
              <th scope="col" className="py-2 px-4">
                Source
              </th>
              <th scope="col" className="py-2 px-4">
                Items
              </th>
              <th scope="col" className="py-2 px-4">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((r) => (
              <tr
                key={`${r.date}:${r.source_package}`}
                style={{ borderTop: '1px solid var(--border-card)' }}
              >
                <td className="py-2 px-4" style={{ color: 'var(--color-text-primary)' }}>
                  {r.date}
                </td>
                {MACROS.map((m) => (
                  <td
                    key={m.key}
                    className="py-2 px-4 font-mono"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {formatNutrient(r[m.key], m.decimals)}
                  </td>
                ))}
                <td
                  className="py-2 px-4"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={hasFriendlyLabel(r.source_package) ? r.source_package : undefined}
                >
                  {nutritionSourceLabel(r.source_package)}
                </td>
                <td className="py-2 px-4" style={{ color: 'var(--color-text-muted)' }}>
                  {r.record_count}
                </td>
                <td className="py-2 px-4" style={{ color: 'var(--color-text-muted)' }}>
                  {relativeTime(r.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Days use {timeZone} calendar dates. Each day is recomputed from your food log on every sync,
        so edits and re-sends correct the day rather than adding to it. A dash means the source did
        not report that nutrient — not zero. Targets stay in MacroFactor; HealthTrack shows what you
        actually ate.
      </p>
    </div>
  );
}
