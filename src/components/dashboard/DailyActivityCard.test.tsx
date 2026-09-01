/**
 * Daily activity card — canonical source discipline and unknown-vs-zero.
 *
 * The regression this guards: Health Connect's aggregate API already
 * deduplicates the phone, the watch and every app feeding it. If this card
 * ever started counting raw Fitbit/Samsung/phone/Oura step rows too, one walk
 * would be counted several times over on the dashboard.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DailyActivityCard, {
  buildDailyActivity,
  DAILY_TOTALS_SOURCE,
} from './DailyActivityCard';
import type { Vital } from '@/lib/types';

function vital(overrides: Partial<Vital> & Pick<Vital, 'metric_key' | 'value'>): Vital {
  return {
    id: `v-${Math.random()}`,
    user_id: 'user-1',
    unit: null,
    source: DAILY_TOTALS_SOURCE,
    recorded_at: '2026-09-01T00:00:00Z',
    metadata: {},
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function metric(vitals: Vital[], key: string) {
  return buildDailyActivity(vitals).find((m) => m.key === key)!;
}

describe('buildDailyActivity', () => {
  it('reads only health_connect_daily rows', () => {
    const vitals = [
      vital({ metric_key: 'steps', value: 11240 }),
      vital({ metric_key: 'steps', value: 9800, source: 'fitbit' }),
      vital({ metric_key: 'steps', value: 8200, source: 'samsung_health' }),
      vital({ metric_key: 'steps', value: 7100, source: 'oura' }),
      vital({ metric_key: 'steps', value: 500, source: 'manual' }),
    ];
    const steps = metric(vitals, 'steps');
    expect(steps.latest).toBe(11240);
    // One day, one canonical value — competing sources are not summed in.
    expect(steps.trend).toHaveLength(1);
  });

  it('exposes the four approved metrics and nothing else', () => {
    expect(buildDailyActivity([]).map((m) => m.key)).toEqual([
      'steps',
      'distance',
      'active_calories',
      'total_calories',
    ]);
  });

  it('treats a metric the snapshot omitted as unknown, not zero', () => {
    const vitals = [vital({ metric_key: 'steps', value: 4180 })];
    expect(metric(vitals, 'steps').latest).toBe(4180);
    expect(metric(vitals, 'total_calories').latest).toBeNull();
    expect(metric(vitals, 'active_calories').latest).toBeNull();
  });

  it('keeps a reported zero as zero', () => {
    const vitals = [vital({ metric_key: 'steps', value: 0 })];
    expect(metric(vitals, 'steps').latest).toBe(0);
  });

  it('takes the newest day, and orders the trend oldest-first', () => {
    const vitals = [
      vital({ metric_key: 'steps', value: 3000, recorded_at: '2026-08-30T00:00:00Z' }),
      vital({ metric_key: 'steps', value: 9000, recorded_at: '2026-09-01T00:00:00Z' }),
      vital({ metric_key: 'steps', value: 6000, recorded_at: '2026-08-31T00:00:00Z' }),
    ];
    const steps = metric(vitals, 'steps');
    expect(steps.latest).toBe(9000);
    expect(steps.trend.map((t) => t.value)).toEqual([3000, 6000, 9000]);
  });

  it('does not add a re-synced day onto the stored one', () => {
    // upsertOwnVital is idempotent on (metric, recorded_at, source), so a
    // re-sync REPLACES the row. The reader must reflect that, never sum it.
    const vitals = [vital({ metric_key: 'steps', value: 12000 })];
    expect(metric(vitals, 'steps').latest).toBe(12000);
    expect(metric(vitals, 'steps').trend.map((t) => t.value)).toEqual([12000]);
  });
});

describe('DailyActivityCard', () => {
  it('renders the canonical latest values', () => {
    render(
      <DailyActivityCard
        vitals={[
          vital({ metric_key: 'steps', value: 11240 }),
          vital({ metric_key: 'distance', value: 5 }),
          vital({ metric_key: 'active_calories', value: 612 }),
        ]}
      />,
    );
    expect(screen.getByText('Daily activity')).toBeInTheDocument();
    expect(screen.getByText('11,240')).toBeInTheDocument();
    expect(screen.getByText('5.00')).toBeInTheDocument();
    expect(screen.getByText('612')).toBeInTheDocument();
    // total_calories was not reported → a dash, never "0".
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Not reported')).toBeInTheDocument();
  });

  it('renders nothing while loading, or with no canonical rows at all', () => {
    const { container: loadingBox } = render(
      <DailyActivityCard vitals={[vital({ metric_key: 'steps', value: 1 })]} loading />,
    );
    expect(loadingBox).toBeEmptyDOMElement();

    const { container: otherSourcesOnly } = render(
      <DailyActivityCard vitals={[vital({ metric_key: 'steps', value: 9800, source: 'fitbit' })]} />,
    );
    expect(otherSourcesOnly).toBeEmptyDOMElement();
  });
});
