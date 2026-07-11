'use client';

import React, { useMemo, useState } from 'react';
import {
  METRICS,
  getMetric,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type MetricCategory,
} from '@/lib/metrics/registry';
import {
  bucketWeekly,
  shouldBucketWeekly,
  type ChartPoint,
} from '@/lib/metrics/vitals-view';
import { formatDuration, isDurationMetric } from '@/lib/metrics/format';
import {
  resolveGoalDirection,
  type ActiveMetricGoal,
} from '@/lib/fitness/goal-direction';
import { getVitalDayKey, shiftDayKey } from '@/lib/dates';
import { getVitalRange } from '@/lib/reference-ranges';
import type { Vital } from '@/lib/types';
import CategorySection from './CategorySection';
import CompactStatCard from './CompactStatCard';
import BarChart from './BarChart';
import VitalTrendChart from './VitalTrendChart';

// ---------------------------------------------------------------------------
// Trends view — one compact stat card per metric (latest value + sparkline +
// range band), grouped into registry-category sections. Clicking a card opens
// a single inline panel below that category's grid with the full-size chart
// for the visible range (bar-bucket metrics: BarChart, weekly-aggregated for
// long ranges; everything else: VitalTrendChart).
// ---------------------------------------------------------------------------

interface CardData {
  key: string;
  latest: Vital;
  /** Full window of readings, recorded_at desc (as fetched). */
  data: Vital[];
  sparkline: Array<{ value: number; date: string }>;
  displayValue?: string;
}

interface SectionData {
  category: MetricCategory;
  cards: CardData[];
}

interface TrendsViewProps {
  /** Vitals for the visible range, ordered recorded_at desc. */
  vitals: Vital[];
  userAge: number;
  userSex: 'male' | 'female' | 'prefer_not_to_say';
  /** Visible range bounds — drive weekly bar aggregation for long ranges. */
  rangeFrom: Date;
  rangeTo: Date;
  /** Active metric goals — override registry directions in sparkline tones. */
  metricGoals?: readonly ActiveMetricGoal[];
}

function metricLabel(key: string): string {
  return getMetric(key)?.label ?? key;
}

/** Latest label text for an ordinal reading: metadata.label, falling back to
    the registry label for the numeric value. */
function ordinalDisplayValue(latest: Vital, labels: readonly string[]): string {
  const raw = latest.metadata?.label;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return labels[latest.value - 1] ?? String(latest.value);
}

export default function TrendsView({
  vitals,
  userAge,
  userSex,
  rangeFrom,
  rangeTo,
  metricGoals = [],
}: TrendsViewProps) {
  /** Metric key of the single expanded card, or null. */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, Vital[]>();
    for (const v of vitals) {
      const arr = map.get(v.metric_key);
      if (arr) arr.push(v);
      else map.set(v.metric_key, [v]);
    }
    return map;
  }, [vitals]);

  // One section per registry category with data, in fixed order. Within a
  // section, metrics follow registry order; keys unknown to the registry are
  // appended (fallback category: cardiovascular).
  const sections = useMemo<SectionData[]>(() => {
    const registryKeysWithData = METRICS.filter((m) => grouped.has(m.key)).map((m) => m.key);
    const unknownKeys = [...grouped.keys()].filter((k) => !getMetric(k));

    const byCategory = new Map<MetricCategory, string[]>();
    for (const key of [...registryKeysWithData, ...unknownKeys]) {
      const cat = getMetric(key)?.category ?? 'cardiovascular';
      const arr = byCategory.get(cat);
      if (arr) arr.push(key);
      else byCategory.set(cat, [key]);
    }

    return CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((category) => ({
      category,
      cards: byCategory.get(category)!.map((key) => {
        const data = grouped.get(key)!;
        const metric = getMetric(key);
        const latest = data[0]; // recorded_at desc
        // Sparkline: the trailing 7 CALENDAR days ending at the latest
        // reading — "last 7 readings" reached weeks back on sparse metrics.
        const sparkCut = shiftDayKey(getVitalDayKey(latest.recorded_at, key), -6);
        return {
          key,
          latest,
          data,
          sparkline: data
            .filter((v) => getVitalDayKey(v.recorded_at, key) >= sparkCut)
            .map((v) => ({ value: v.value, date: v.recorded_at }))
            .reverse(),
          displayValue:
            metric?.valueType === 'ordinal'
              ? ordinalDisplayValue(latest, metric.ordinalLabels ?? [])
              : undefined,
        };
      }),
    }));
  }, [grouped]);

  const weeklyBars = shouldBucketWeekly(rangeFrom, rangeTo);

  function renderExpandedPanel(card: CardData) {
    const metric = getMetric(card.key);
    const range = getVitalRange(card.key, userAge, userSex);
    const isBar = metric?.chart === 'bar';

    let chart: React.ReactNode;
    if (isBar) {
      let points: ChartPoint[] = card.data.map((v) => ({
        value: v.value,
        date: v.recorded_at,
      }));
      if (weeklyBars) {
        points = bucketWeekly(points, metric!.aggregate, metric!.decimals ?? 0);
      }
      chart = (
        <BarChart
          data={points.map((p) => ({ ...p, label: metricLabel(card.key) }))}
          height={240}
          refLow={
            weeklyBars && metric!.aggregate === 'sum' ? undefined : (range?.low ?? undefined)
          }
          refHigh={weeklyBars && metric!.aggregate === 'sum' ? undefined : range?.high}
          decimals={metric!.decimals ?? 0}
          formatValue={isDurationMetric(metric) ? formatDuration : undefined}
        />
      );
    } else {
      chart = (
        <VitalTrendChart
          data={card.data.map((v) => ({ value: v.value, recorded_at: v.recorded_at }))}
          metricKey={card.key}
          label={metricLabel(card.key)}
          refLow={range?.low ?? undefined}
          refHigh={range?.high}
          unit={card.latest.unit ?? ''}
          ordinalLabels={
            metric?.valueType === 'ordinal' ? metric.ordinalLabels : undefined
          }
        />
      );
    }

    return (
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        role="region"
        aria-label={`${metricLabel(card.key)} chart`}
      >
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {metricLabel(card.key)}
            {isBar && weeklyBars && (
              <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                (weekly {metric!.aggregate === 'sum' ? 'totals' : 'averages'})
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setExpandedKey(null)}
            aria-label="Close chart"
            className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
            style={{
              border: '1px solid var(--border-card)',
              color: 'var(--color-text-muted)',
            }}
          >
            Close
          </button>
        </div>
        {chart}
      </div>
    );
  }

  return (
    <>
      {sections.map((section) => {
        const expandedCard = section.cards.find((c) => c.key === expandedKey);
        return (
          <CategorySection
            key={section.category}
            title={CATEGORY_LABELS[section.category]}
            count={section.cards.length}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {section.cards.map((card) => {
                const range = getVitalRange(card.key, userAge, userSex);
                return (
                  <CompactStatCard
                    key={card.key}
                    metricKey={card.key}
                    goalDirection={resolveGoalDirection(
                      card.key,
                      getMetric(card.key)?.goalDirection,
                      metricGoals,
                    )}
                    label={metricLabel(card.key)}
                    value={card.latest.value}
                    displayValue={card.displayValue}
                    unit={card.latest.unit ?? ''}
                    source={card.latest.source}
                    timestamp={card.latest.recorded_at}
                    sparklineData={card.sparkline}
                    rangeInfo={range ? { low: range.low, high: range.high } : undefined}
                    expanded={card.key === expandedKey}
                    onClick={() =>
                      setExpandedKey((prev) => (prev === card.key ? null : card.key))
                    }
                  />
                );
              })}
            </div>
            {expandedCard && renderExpandedPanel(expandedCard)}
          </CategorySection>
        );
      })}
    </>
  );
}
