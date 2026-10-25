import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ComparisonMetric,
  ComparisonResponse,
  ComparisonSource,
} from '@/lib/metrics/comparison-types';

const state = vi.hoisted(() => ({
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
  userId: 'owner',
  apiFetch: vi.fn(),
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({
    dependentId: state.dependentId,
    delegateOwnerId: state.delegateOwnerId,
  }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: state.apiFetch }));
vi.mock('./MetricComparisonChart', () => ({
  default: ({ points }: { points: unknown }) => (
    <div data-testid="comparison-chart" data-points={JSON.stringify(points)} />
  ),
}));
import ComparisonView from './ComparisonView';

const source = (name: string, label = name): ComparisonSource => ({
  source: name,
  label,
  recorded_days: 2,
  points: [
    { date: '2026-10-01', value: 0 },
    { date: '2026-10-03', value: 2.5 },
  ],
});
const metric = (
  key: string,
  label: string,
  unit: string | null,
  selected = 'manual'
): ComparisonMetric => ({
  key,
  label,
  unit,
  domain: 'vitals',
  aggregation: 'mean',
  selected_source: selected,
  sources: [source(selected)],
});
function response(overrides: Partial<ComparisonResponse> = {}): ComparisonResponse {
  return {
    days: 30,
    start_date: '2026-10-01',
    end_date: '2026-10-30',
    time_zone: 'America/Phoenix',
    metrics: [
      metric('vital:ahi', 'AHI', 'events/hr'),
      metric('vital:sleep_score', 'Sleep Score', null),
    ],
    unavailable_domains: [],
    warnings: [],
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  state.dependentId = null;
  state.delegateOwnerId = null;
  state.userId = 'owner';
  state.apiFetch.mockReset().mockResolvedValue(response());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ComparisonView', () => {
  it('loads its independent window and exposes sources, recorded coverage, zero, and missing dates', async () => {
    render(<ComparisonView />);
    expect(await screen.findByLabelText('Left metric')).toHaveValue('vital:ahi');
    expect(state.apiFetch.mock.calls[0][0]).toBe('/api/metric-comparison?days=30');
    expect(screen.getAllByText('2 of 30 days recorded · manual')).toHaveLength(2);
    fireEvent.click(screen.getByText('View daily values and missing days'));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('0 events/hr')).toBeInTheDocument();
    expect(screen.getAllByText('No data').length).toBeGreaterThan(0);
    const points = JSON.parse(screen.getByTestId('comparison-chart').getAttribute('data-points')!);
    expect(points).toHaveLength(30);
    expect(points[1]).toEqual({ date: '2026-10-02', left: null, right: null });
    expect(screen.getAllByText(/America\/Phoenix/).length).toBeGreaterThan(0);
  });

  it('requires an explicit ambiguous source and overrides only this comparison without writes', async () => {
    const ahi = {
      ...metric('vital:ahi', 'AHI', 'events/hr'),
      selected_source: null,
      sources: [source('myair', 'myAir'), source('manual', 'Manual')],
    };
    state.apiFetch.mockResolvedValue(
      response({ metrics: [ahi, metric('vital:sleep_score', 'Sleep Score', null)] })
    );
    render(<ComparisonView />);
    expect(await screen.findByLabelText('Left source')).toHaveValue('');
    expect(
      JSON.parse(screen.getByTestId('comparison-chart').getAttribute('data-points')!)[0].left
    ).toBeNull();
    expect(screen.getByText(/Competing sources are kept separate/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Left source'), { target: { value: 'myair' } });
    expect(screen.getByLabelText('Left source')).toHaveValue('myair');
    expect(screen.getByText('Source selected for this comparison only.')).toBeInTheDocument();
    expect(
      JSON.parse(screen.getByTestId('comparison-chart').getAttribute('data-points')!)[0].left
    ).toBe(0);
    expect(state.apiFetch).toHaveBeenCalledTimes(1);
    expect(
      state.apiFetch.mock.calls.every(([, init]) => !init.method || init.method === 'GET')
    ).toBe(true);
  });

  it('hides the previous window during a new request and aborts the old request', async () => {
    const next = deferred<ComparisonResponse>();
    state.apiFetch.mockResolvedValueOnce(response()).mockReturnValueOnce(next.promise);
    render(<ComparisonView />);
    await screen.findByLabelText('Left metric');
    const oldSignal = state.apiFetch.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading comparison');
    expect(oldSignal.aborted).toBe(true);
    expect(state.apiFetch.mock.calls[1][0]).toBe('/api/metric-comparison?days=90');
    await act(async () => next.resolve(response({ days: 90, start_date: '2026-08-02' })));
    expect(screen.getAllByText('2 of 90 days recorded · manual')).toHaveLength(2);
  });

  it('switches subject without showing the previous patient or retaining local choices', async () => {
    const child = deferred<ComparisonResponse>();
    state.apiFetch.mockResolvedValueOnce(response()).mockReturnValueOnce(child.promise);
    const { rerender } = render(<ComparisonView />);
    await screen.findByLabelText('Left metric');
    fireEvent.change(screen.getByLabelText('Left metric'), {
      target: { value: 'vital:sleep_score' },
    });
    state.dependentId = 'child-1';
    rerender(<ComparisonView />);
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Left metric')).not.toBeInTheDocument();
    expect(state.apiFetch.mock.calls[1][0]).toBe(
      '/api/metric-comparison?days=30&dependent_id=child-1'
    );
    await act(async () => child.resolve(response({ unavailable_domains: ['nutrition'] })));
    expect(screen.getByLabelText('Left metric')).toHaveValue('vital:ahi');
    expect(screen.getByText('Unavailable for this person: Nutrition.')).toBeInTheDocument();
  });

  it('scopes delegated requests to owner_id and account switches reset the view', async () => {
    state.delegateOwnerId = 'shared-owner';
    const { rerender } = render(<ComparisonView />);
    await screen.findByLabelText('Left metric');
    expect(state.apiFetch.mock.calls[0][0]).toBe(
      '/api/metric-comparison?days=30&owner_id=shared-owner'
    );
    state.userId = 'second-viewer';
    rerender(<ComparisonView />);
    await waitFor(() => expect(state.apiFetch).toHaveBeenCalledTimes(2));
  });

  it('ignores a late owner response after switching to a dependent', async () => {
    const owner = deferred<ComparisonResponse>();
    state.apiFetch
      .mockReturnValueOnce(owner.promise)
      .mockResolvedValueOnce(response({ metrics: [] }));
    const { rerender } = render(<ComparisonView />);
    state.dependentId = 'child';
    rerender(<ComparisonView />);
    await screen.findByText(/No recorded comparison data/);
    await act(async () => owner.resolve(response()));
    expect(screen.queryByLabelText('Left metric')).not.toBeInTheDocument();
    expect(screen.getByText(/No recorded comparison data/)).toBeInTheDocument();
  });

  it('offers a safe retry without displaying server response details', async () => {
    state.apiFetch
      .mockRejectedValueOnce(new Error('sensitive upstream detail'))
      .mockResolvedValueOnce(response());
    render(<ComparisonView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the comparison.');
    expect(screen.queryByText(/sensitive upstream/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Left metric');
    expect(state.apiFetch).toHaveBeenCalledTimes(2);
  });

  it('bounds a hanging request and aborts it on timeout', async () => {
    vi.useFakeTimers();
    state.apiFetch.mockReturnValue(new Promise(() => {}));
    render(<ComparisonView />);
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent('timed out');
    expect((state.apiFetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  });

  it('refreshes after a saved reading while preserving the local metric and source choices', async () => {
    const sleep = {
      ...metric('vital:sleep_score', 'Sleep Score', null),
      sources: [source('manual'), source('oura')],
    };
    state.apiFetch.mockResolvedValue(
      response({ metrics: [metric('vital:ahi', 'AHI', 'events/hr'), sleep] })
    );
    const { rerender } = render(<ComparisonView refreshRevision={0} />);
    await screen.findByLabelText('Left metric');
    fireEvent.change(screen.getByLabelText('Left metric'), {
      target: { value: 'vital:sleep_score' },
    });
    fireEvent.change(screen.getByLabelText('Left source'), { target: { value: 'oura' } });
    rerender(<ComparisonView refreshRevision={1} />);
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
    await screen.findByLabelText('Left metric');
    expect(screen.getByLabelText('Left metric')).toHaveValue('vital:sleep_score');
    expect(screen.getByLabelText('Left source')).toHaveValue('oura');
    expect(state.apiFetch).toHaveBeenCalledTimes(2);
  });

  it('re-reads saved source defaults when a global preference changes', async () => {
    render(<ComparisonView />);
    await screen.findByLabelText('Left metric');
    state.apiFetch.mockResolvedValue(
      response({
        metrics: [
          { ...metric('vital:ahi', 'AHI', 'events/hr', 'myair') },
          metric('vital:sleep_score', 'Sleep Score', null),
        ],
      })
    );
    act(() => window.dispatchEvent(new Event('vital-source-preferences-changed')));
    await waitFor(() => expect(screen.getByLabelText('Left source')).toHaveValue('myair'));
    expect(state.apiFetch).toHaveBeenCalledTimes(2);
  });

  it('shows cross-domain presets only when both metrics have recorded data', async () => {
    const calories: ComparisonMetric = {
      ...metric('nutrition:calories', 'Calories', 'kcal'),
      domain: 'nutrition',
    };
    state.apiFetch.mockResolvedValue(
      response({ metrics: [calories, metric('vital:weight', 'Weight', 'lbs')] })
    );
    render(<ComparisonView />);
    expect(await screen.findByRole('button', { name: 'Calories and weight' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AHI and sleep' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Left metric')).toHaveValue('nutrition:calories');
    expect(screen.getByLabelText('Right metric')).toHaveValue('vital:weight');
  });
});
