/**
 * DailyTable — presentational per-day table (category groups, value + unit,
 * delta vs trailing 7-day average, intraday readings with local times).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailyTable } from './DailyVitalsView';
import { buildDailySections, type ViewVitalRow } from '@/lib/metrics/vitals-view';
import { formatLocalTime } from '@/lib/dates';

function row(metric_key: string, value: number, recorded_at: string): ViewVitalRow {
  return { metric_key, value, unit: null, source: 'manual', recorded_at, metadata: {} };
}

describe('DailyTable', () => {
  it('shows an empty message when the day has no data', () => {
    render(<DailyTable sections={[]} />);
    expect(screen.getByText('No vitals recorded on this day.')).toBeInTheDocument();
  });

  it('groups metrics under category headings with value, unit and delta', () => {
    const sections = buildDailySections(
      [
        row('resting_hr', 60, '2026-07-08T00:00:00Z'),
        row('resting_hr', 55, '2026-07-07T00:00:00Z'),
        row('sleep_score', 82, '2026-07-08T00:00:00Z'),
      ],
      '2026-07-08',
    );
    render(<DailyTable sections={sections} />);

    expect(screen.getByRole('heading', { name: 'Sleep' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cardiovascular' })).toBeInTheDocument();
    expect(screen.getByText('Resting HR')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('bpm')).toBeInTheDocument();
    // delta: 60 vs prior avg 55 → ▲ 5 bpm
    expect(screen.getByText(/5 bpm vs 7d avg/)).toBeInTheDocument();
    // no baseline for sleep_score → em dash placeholder
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('labels sum-metric deltas against the 7d daily average', () => {
    const sections = buildDailySections(
      [
        row('steps', 10000, '2026-07-08T00:00:00Z'),
        row('steps', 7000, '2026-07-07T00:00:00Z'),
      ],
      '2026-07-08',
    );
    render(<DailyTable sections={sections} />);
    // baseline 7000/7 = 1000 → ▲ 9000 steps vs 7d daily avg
    expect(screen.getByText(/9000 steps vs 7d daily avg/)).toBeInTheDocument();
  });

  it('lists each intraday reading with its local time', () => {
    const local = (h: number) => new Date(2026, 6, 8, h, 15).toISOString();
    const sections = buildDailySections(
      [row('blood_glucose', 95, local(7)), row('blood_glucose', 140, local(18))],
      '2026-07-08',
    );
    render(<DailyTable sections={sections} />);
    expect(screen.getByText('95')).toBeInTheDocument();
    expect(screen.getByText('140')).toBeInTheDocument();
    expect(screen.getByText(formatLocalTime(local(7)))).toBeInTheDocument();
    expect(screen.getByText(formatLocalTime(local(18)))).toBeInTheDocument();
  });

  it('renders duration metrics as h/m without a unit suffix', () => {
    const sections = buildDailySections(
      [row('deep_sleep', 462, '2026-07-08T00:00:00Z')],
      '2026-07-08',
    );
    render(<DailyTable sections={sections} />);
    expect(screen.getByText('7h 42m')).toBeInTheDocument();
    expect(screen.queryByText('min')).not.toBeInTheDocument();
  });

  it('renders ordinal readings as label text', () => {
    const sections = buildDailySections(
      [row('mood', 4, '2026-07-08T00:00:00Z')],
      '2026-07-08',
    );
    render(<DailyTable sections={sections} />);
    expect(screen.getByText('good')).toBeInTheDocument();
  });
});
