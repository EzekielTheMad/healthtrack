import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComparisonMetric } from '@/lib/metrics/comparison-types';

const capture = vi.hoisted(() => ({
  lines: [] as Array<Record<string, unknown>>,
  axes: [] as Array<Record<string, unknown>>,
}));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: (props: Record<string, unknown>) => {
    capture.axes.push(props);
    return null;
  },
  Line: (props: Record<string, unknown>) => {
    capture.lines.push(props);
    return null;
  },
}));
import MetricComparisonChart from './MetricComparisonChart';

describe('MetricComparisonChart', () => {
  it('labels both independent axes and leaves nulls disconnected with linear segments', () => {
    capture.lines = [];
    capture.axes = [];
    const metric = (label: string, unit: string | null): ComparisonMetric => ({
      key: label,
      label,
      unit,
      domain: 'vitals',
      aggregation: 'mean',
      sources: [],
      selected_source: null,
    });
    render(
      <MetricComparisonChart
        points={[{ date: '2026-10-01', left: 0, right: null }]}
        left={metric('AHI', 'events/hr')}
        right={metric('Sleep Score', null)}
      />
    );
    expect(screen.getByText('Left axis: AHI (events/hr)')).toBeInTheDocument();
    expect(screen.getByText('Right axis: Sleep Score')).toBeInTheDocument();
    expect(capture.lines).toHaveLength(2);
    for (const line of capture.lines) {
      expect(line.connectNulls).toBe(false);
      expect(line.type).toBe('linear');
    }
    expect(capture.axes.map((axis) => axis.yAxisId)).toEqual(['left', 'right']);
  });
});
