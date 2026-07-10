/**
 * TrendsView — deduplicated trends: one compact stat card per metric, with a
 * single inline expanded chart panel per page (click card to open, one at a
 * time, close affordance).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TrendsView from './TrendsView';
import type { Vital } from '@/lib/types';

let idCounter = 0;
function vital(metric_key: string, value: number, recorded_at: string): Vital {
  idCounter += 1;
  return {
    id: `v${idCounter}`,
    user_id: 'u1',
    metric_key,
    value,
    unit: null,
    source: 'manual',
    recorded_at,
    metadata: {},
    created_at: recorded_at,
  };
}

/** Rows arrive recorded_at desc, like the API returns them. */
function fixture(): Vital[] {
  return [
    // sleep_score is a bar-bucket metric
    vital('sleep_score', 82, '2026-07-08T00:00:00Z'),
    vital('sleep_score', 75, '2026-07-07T00:00:00Z'),
    // resting_hr is a stat metric
    vital('resting_hr', 58, '2026-07-08T00:00:00Z'),
    vital('resting_hr', 61, '2026-07-07T00:00:00Z'),
  ];
}

const baseProps = {
  userAge: 35,
  userSex: 'male' as const,
  rangeFrom: new Date('2026-06-08T00:00:00Z'),
  rangeTo: new Date('2026-07-08T00:00:00Z'),
};

describe('TrendsView', () => {
  it('renders each metric exactly once, as a stat card (no duplicate charts)', () => {
    render(<TrendsView vitals={fixture()} {...baseProps} />);
    // One card per metric — including bar-bucket metrics.
    expect(screen.getAllByText('Sleep Score')).toHaveLength(1);
    expect(screen.getAllByText('Resting HR')).toHaveLength(1);
    // No expanded panel until a card is clicked.
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('expands a bar metric card into a BarChart panel and closes it again', () => {
    render(<TrendsView vitals={fixture()} {...baseProps} />);
    const card = screen.getByRole('button', { name: /Sleep Score — show chart/ });

    fireEvent.click(card);
    const panel = screen.getByRole('region', { name: 'Sleep Score chart' });
    expect(panel).toBeInTheDocument();
    expect(panel.querySelector('svg[aria-label="Bar chart"]')).not.toBeNull();
    expect(card).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close chart' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('keeps only one panel expanded at a time', () => {
    render(<TrendsView vitals={fixture()} {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Sleep Score — show chart/ }));
    expect(screen.getByRole('region', { name: 'Sleep Score chart' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Resting HR — show chart/ }));
    expect(screen.queryByRole('region', { name: 'Sleep Score chart' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resting HR chart' })).toBeInTheDocument();
  });

  it('collapses an expanded card when clicked again', () => {
    render(<TrendsView vitals={fixture()} {...baseProps} />);
    const card = screen.getByRole('button', { name: /Sleep Score — show chart/ });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: /Sleep Score — hide chart/ }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('clamps card values to registry decimals and renders one-sided ranges honestly', () => {
    render(
      <TrendsView
        vitals={[vital('ahi', 3.3333333333, '2026-07-08T00:00:00Z')]}
        {...baseProps}
      />,
    );
    // Raw stored float renders at AHI's 1 decimal (card value + range row).
    expect(screen.getAllByText('3.3').length).toBeGreaterThan(0);
    expect(screen.queryByText('3.3333333333')).not.toBeInTheDocument();
    // AHI normal range is one-sided: "≤ 4.9", never a fabricated 0–4.9 band.
    expect(screen.getByText('≤ 4.9')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: '3.3 events/hr, normal range 4.9 or below' }),
    ).toBeInTheDocument();
  });

  it('renders minute-based sleep metrics as durations and hours as hrs', () => {
    render(
      <TrendsView
        vitals={[
          vital('deep_sleep', 462, '2026-07-08T00:00:00Z'),
          vital('sleep_duration', 7.5, '2026-07-08T00:00:00Z'),
        ]}
        {...baseProps}
      />,
    );
    expect(screen.getByText('7h 42m')).toBeInTheDocument();
    expect(screen.queryByText('462')).not.toBeInTheDocument();
    expect(screen.getByText('hrs')).toBeInTheDocument();
    expect(screen.queryByText('hours')).not.toBeInTheDocument();
  });

  it('labels long-range bar panels as weekly aggregates', () => {
    render(
      <TrendsView
        vitals={fixture()}
        {...baseProps}
        rangeFrom={new Date('2026-01-08T00:00:00Z')}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sleep Score — show chart/ }));
    expect(screen.getByText('(weekly averages)')).toBeInTheDocument();
  });
});
