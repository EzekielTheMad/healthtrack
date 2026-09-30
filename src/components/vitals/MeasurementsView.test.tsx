/**
 * Vitals → Measurements: latest-session card, neutral change reporting,
 * trend controls and the deterministic range report.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import MeasurementsView from './MeasurementsView';
import type { ViewVitalRow } from '@/lib/metrics/vitals-view';

// Recharts measures its container with ResizeObserver, which jsdom lacks, and
// renders nothing at zero width. The chart's own behavior is covered by the
// pure series builder (measurements.test.ts); here we only need the view
// around it to mount.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const NOW = new Date('2026-09-02T00:00:00.000Z');

function row(
  metric_key: string,
  value: number,
  day: string,
  source = 'example_tape',
): ViewVitalRow {
  return {
    metric_key,
    value,
    unit: 'in',
    source,
    recorded_at: `${day}T00:00:00.000Z`,
    metadata: {},
  };
}

function renderView(vitals: ViewVitalRow[], props = {}) {
  return render(<MeasurementsView vitals={vitals} now={NOW} {...props} />);
}

describe('MeasurementsView', () => {
  it('shows an intentional empty state with a manual-entry affordance', () => {
    const onAddManual = vi.fn();
    renderView([row('weight', 210, '2026-09-01')], { onAddManual });

    expect(screen.getByText('No body measurements yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Vital' }));
    expect(onAddManual).toHaveBeenCalledOnce();
  });

  it('heads the latest session with its date and source', () => {
    renderView([row('waist', 38.1, '2026-09-01'), row('chest', 40.1, '2026-09-01')]);

    const card = screen.getByLabelText('Latest measurements');
    expect(within(card).getByText(/Sep 1, 2026/)).toBeInTheDocument();
    expect(within(card).getByLabelText('Data source: example_tape')).toBeInTheDocument();
  });

  it('labels a lone session as the baseline', () => {
    renderView([row('waist', 38.1, '2026-09-01')]);
    expect(screen.getByText(/Baseline — your first reading/)).toBeInTheDocument();
    expect(screen.getAllByText('Baseline').length).toBeGreaterThan(0);
  });

  it('groups readings into Core, Arms and Legs', () => {
    renderView([
      row('waist', 38.1, '2026-09-01'),
      row('left_bicep', 14.2, '2026-09-01'),
      row('left_calf', 15.0, '2026-09-01'),
    ]);

    for (const group of ['Core', 'Arms', 'Legs']) {
      expect(screen.getByRole('heading', { name: group })).toBeInTheDocument();
    }
  });

  it('omits unmeasured metrics rather than rendering a wall of dashes', () => {
    renderView([row('waist', 38.1, '2026-09-01')]);
    const card = screen.getByLabelText('Latest measurements');
    expect(within(card).queryByText('Hips')).not.toBeInTheDocument();
    expect(within(card).queryByText('Neck')).not.toBeInTheDocument();
    expect(within(card).queryByRole('heading', { name: 'Arms' })).not.toBeInTheDocument();
  });

  it('shows a bilateral pair side by side, each with its own change', () => {
    renderView([
      row('left_bicep', 14.2, '2026-09-01'),
      row('right_bicep', 14.6, '2026-09-01'),
      row('left_bicep', 14.0, '2026-08-01'),
    ]);

    const card = screen.getByLabelText('Latest measurements');
    expect(within(card).getByText('Left')).toBeInTheDocument();
    expect(within(card).getByText('Right')).toBeInTheDocument();
    expect(within(card).getByText('14.2')).toBeInTheDocument();
    expect(within(card).getByText('14.6')).toBeInTheDocument();
    // Left moved +0.2 since Aug 1; right is a first reading.
    expect(within(card).getByText(/\+0\.2 in/)).toBeInTheDocument();
    expect(within(card).getAllByText('Baseline').length).toBe(1);
  });

  it('dates a value that was last measured before the session date', () => {
    renderView([row('waist', 38.1, '2026-09-01'), row('chest', 40.1, '2026-07-04')]);
    expect(screen.getByText(/Some measurements were last taken earlier/)).toBeInTheDocument();
    const card = screen.getByLabelText('Latest measurements');
    // The stale value carries its own measurement date, not the header's.
    expect(within(card).getByText(/measured/)).toBeInTheDocument();
    expect(within(card).getByText('Jul 4')).toBeInTheDocument();
    expect(within(card).queryByText('Sep 1')).not.toBeInTheDocument();
  });

  it('reports a change neutrally, with no good/bad coloring by default', () => {
    renderView([row('waist', 38.1, '2026-09-01'), row('waist', 38.6, '2026-08-01')]);
    const change = screen.getByText(/−0\.5 in/);
    expect(change).toHaveStyle({ color: 'var(--color-text-muted)' });
  });

  it('colors a change only when an active goal supplies the direction', () => {
    renderView([row('waist', 38.1, '2026-09-01'), row('waist', 38.6, '2026-08-01')], {
      metricGoals: [{ metricKey: 'waist', direction: 'decrease' }],
    });
    expect(screen.getByText(/−0\.5 in/)).toHaveStyle({ color: 'var(--color-sage)' });
  });

  it('renders a sub-display-step move as no change, not +0.0', () => {
    renderView([row('waist', 38.12, '2026-09-01'), row('waist', 38.1, '2026-08-01')]);
    const card = screen.getByLabelText('Latest measurements');
    expect(within(card).getByText(/No change/)).toBeInTheDocument();
    expect(within(card).queryByText(/\+0(\.0)? in/)).not.toBeInTheDocument();
  });

  it('renders values at registry precision without rounding the stored value', () => {
    renderView([row('waist', 96.8 / 2.54, '2026-09-01')]);
    const card = screen.getByLabelText('Latest measurements');
    expect(within(card).getByText('38.1')).toBeInTheDocument();
    expect(screen.queryByText(/38\.11/)).not.toBeInTheDocument();
  });

  it('tabulates first, latest, change and reading count for the range', () => {
    renderView([
      row('waist', 39.4, '2026-06-01'),
      row('waist', 38.6, '2026-08-01'),
      row('waist', 38.1, '2026-09-01'),
    ]);

    const report = screen.getByLabelText('Report');
    const dataRow = within(report).getByRole('row', { name: /Waist/ });
    expect(within(dataRow).getByText('39.4')).toBeInTheDocument();
    expect(within(dataRow).getByText('38.1')).toBeInTheDocument();
    expect(within(dataRow).getByText('−1.3')).toBeInTheDocument();
    expect(within(dataRow).getByText('3')).toBeInTheDocument();
  });

  it('reports a lone in-range reading as a baseline in the table', () => {
    renderView([row('waist', 38.1, '2026-09-01')]);
    const report = screen.getByLabelText('Report');
    expect(within(report).getByText('Baseline')).toBeInTheDocument();
  });

  it('never hides the latest measurement behind a short range', () => {
    // Only reading is 18 months old — outside the default 1Y range.
    renderView([row('waist', 38.1, '2025-03-01')]);
    const card = screen.getByLabelText('Latest measurements');
    expect(within(card).getByText('38.1')).toBeInTheDocument();
    expect(within(card).getByText(/Mar 1, 2025/)).toBeInTheDocument();
    // …while the range-scoped report says so plainly rather than showing zero.
    expect(
      screen.getByText(/No measurements in this range\. Widen it/),
    ).toBeInTheDocument();
  });

  it('narrows and widens the report with the range selector', () => {
    renderView([row('waist', 39.4, '2026-01-15'), row('waist', 38.1, '2026-09-01')]);

    const rangeGroup = screen.getByRole('group', { name: 'Measurement date range' });
    // 1Y (default) sees both readings.
    expect(within(screen.getByLabelText('Report')).getByText('2')).toBeInTheDocument();

    fireEvent.click(within(rangeGroup).getByRole('button', { name: '3M' }));
    const report = screen.getByLabelText('Report');
    expect(within(report).getByText('Baseline')).toBeInTheDocument();
    expect(within(report).getByText('1')).toBeInTheDocument();
  });

  it('exposes labeled, keyboard-operable range and preset controls', () => {
    renderView([row('waist', 38.1, '2026-09-01')]);

    const rangeGroup = screen.getByRole('group', { name: 'Measurement date range' });
    const all = within(rangeGroup).getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'false');
    // Native <button>s: focusable, and Enter/Space activate them by default.
    all.focus();
    expect(all).toHaveFocus();
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');

    const presetGroup = screen.getByRole('group', { name: 'Measurement chart preset' });
    for (const label of ['Core', 'Upper body', 'Arms', 'Legs']) {
      expect(within(presetGroup).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(presetGroup).getByRole('button', { name: 'Core' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offers only metrics that actually have readings as chart series', () => {
    renderView([row('waist', 38.1, '2026-09-01'), row('left_bicep', 14.2, '2026-09-01')]);

    expect(screen.getByRole('checkbox', { name: 'Waist' })).toBeChecked();
    const bicep = screen.getByRole('checkbox', { name: 'Left Bicep' });
    expect(bicep).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Hips' })).not.toBeInTheDocument();

    fireEvent.click(bicep);
    expect(bicep).toBeChecked();
    // Selecting a metric by hand releases the preset.
    expect(
      screen.getByRole('button', { name: 'Core' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses semantic headings for each section', () => {
    renderView([row('waist', 38.1, '2026-09-01')]);
    expect(
      screen.getByRole('heading', { name: 'Latest measurements', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trends', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Report', level: 2 })).toBeInTheDocument();
  });

  it('renders readably at a phone width', () => {
    // The layout is single-column by default and only grids up at md/xl, so a
    // 375px viewport gets one card per row with no horizontal page scroll; the
    // report table is the one wide element and scrolls inside its own box.
    const { container } = renderView([
      row('waist', 38.1, '2026-09-01'),
      row('left_bicep', 14.2, '2026-09-01'),
    ]);

    const grid = container.querySelector('.grid.grid-cols-1');
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain('md:grid-cols-2');

    const table = screen.getByRole('table');
    expect(table.parentElement!.className).toContain('overflow-x-auto');
  });
});
