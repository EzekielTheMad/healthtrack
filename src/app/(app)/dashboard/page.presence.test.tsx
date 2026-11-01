import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
const { api, medications, trend, selected } = vi.hoisted(() => ({
  api: vi.fn(),
  medications: vi.fn(),
  trend: vi.fn(),
  selected: { dependentId: null as string | null, delegateOwnerId: null as string | null },
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => selected,
}));
vi.mock('@/hooks/useVitals', () => ({
  useVitals: () => ({ vitals: [], loading: false, error: null }),
}));
vi.mock('@/hooks/useMedications', () => ({ useMedications: medications }));
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { display_name: 'Fictional owner', date_of_birth: '1980-01-01' },
    loading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useConditions', () => ({
  useConditions: () => ({ conditions: [], loading: false, error: null }),
}));
vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({ providers: [], loading: false, error: null }),
}));
vi.mock('@/hooks/useDashboardStats', () => ({
  useDashboardStats: () => ({
    stats: [],
    loading: false,
    hasCustomized: false,
    availableLabTests: [],
  }),
}));
vi.mock('@/hooks/useLabStatData', () => ({ useLabStatData: () => ({ labStatData: [] }) }));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: false } }),
}));
vi.mock('@/components/shared/DateRangeContext', () => ({
  useDateRangeContext: () => ({
    dateRange: { start: null, end: null },
    setDateRange: vi.fn(),
    reportingTimeZone: 'Etc/UTC',
  }),
}));
vi.mock('@/components/shared/DateRangeFilter', () => ({ default: () => null }));
vi.mock('@/components/dashboard/HealthSummaryCard', () => ({ default: () => null }));
vi.mock('@/components/dashboard/DailyActivityCard', () => ({ default: () => null }));
vi.mock('@/components/labs/TrendLine', () => ({ default: trend }));
import DashboardPage from './page';
beforeEach(() => {
  selected.dependentId = null;
  selected.delegateOwnerId = null;
  localStorage.clear();
  api.mockReset();
  medications.mockReset();
  medications.mockReturnValue({ medications: [], loading: false, error: null });
  trend.mockReset();
  trend.mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it('counts accepted clinical and scan history for setup without inventing active medications or numeric trends', async () => {
  api.mockImplementation(async (url: string) =>
    url.startsWith('/api/labs')
      ? []
      : url.startsWith('/api/scans')
        ? { scans: [{ id: 'scan' }] }
        : {
            records: [
              {
                id: 'clinical',
                fact: { status: 'unconfirmed', outcome: { kind: 'text', text: 'Negative' } },
              },
            ],
          }
  );
  render(<DashboardPage />);
  expect(await screen.findByText('4 of 6 complete')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Add your first medication' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Upload lab results' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'Record a vital sign or body scan' })
  ).not.toBeInTheDocument();
  expect(screen.getByText('No active medications')).toBeInTheDocument();
  expect(medications).toHaveBeenCalledWith({ activeOnly: true });
  expect(trend).not.toHaveBeenCalled();
  expect(screen.getByText('No numeric lab flags shown')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Detailed clinical records' })).toHaveAttribute(
    'href',
    '/clinical-records'
  );
  expect(screen.queryByText('Upload a lab report to review its results.')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View body scan history' })).toHaveAttribute(
    'href',
    '/scans'
  );
});
it('keeps unloaded lab history unknown instead of prompting a first upload', async () => {
  api.mockImplementation((url: string) =>
    url.startsWith('/api/labs')
      ? Promise.resolve([])
      : url.includes('kind=lab')
        ? new Promise(() => {})
        : Promise.resolve(url.startsWith('/api/scans') ? { scans: [] } : { records: [] })
  );
  render(<DashboardPage />);
  await waitFor(() =>
    expect(
      api.mock.calls.filter(
        ([url]) => url.startsWith('/api/clinical-records') || url.startsWith('/api/scans')
      )
    ).toHaveLength(3)
  );
  expect(screen.queryByText('Getting Started')).not.toBeInTheDocument();
  expect(screen.queryByText('No lab results recorded')).not.toBeInTheDocument();
  expect(screen.queryByText('Upload a lab report to review its results.')).not.toBeInTheDocument();
});
it('shows unavailable coverage after a permission failure without claiming zero history or first-upload status', async () => {
  api.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/labs')) return [];
    if (url.includes('kind=lab')) throw new Error('Not found');
    return url.startsWith('/api/scans') ? { scans: [] } : { records: [] };
  });
  render(<DashboardPage />);
  expect(await screen.findByText(/Setup progress is unavailable/)).toBeInTheDocument();
  expect(screen.getByText(/Lab history could not be checked/)).toBeInTheDocument();
  expect(screen.queryByText('Getting Started')).not.toBeInTheDocument();
  expect(screen.queryByText('No lab results recorded')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Upload lab results' })).not.toBeInTheDocument();
});
it('removes previous-person numeric lab facts immediately when switching profiles, even while the new request is pending', async () => {
  let finish: (value: unknown) => void = () => {};
  api.mockImplementation((url: string) => {
    if (url.startsWith('/api/labs')) {
      if (new URL(url, 'http://localhost').searchParams.has('dependent_id'))
        return new Promise((resolve) => {
          finish = resolve;
        });
      return Promise.resolve([
        {
          id: 'owner-visit',
          visit_date: '2026-01-01',
          lab_results: [
            {
              id: 'owner-result',
              test_name: 'Owner private lab',
              value: 12,
              unit: 'fictional',
              flag: 'high',
            },
          ],
        },
      ]);
    }
    return Promise.resolve(url.startsWith('/api/scans') ? { scans: [] } : { records: [] });
  });
  const page = render(<DashboardPage />);
  await screen.findByText('Owner private lab');
  selected.dependentId = 'fictional-child';
  page.rerender(<DashboardPage />);
  expect(screen.queryByText('Owner private lab')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      api.mock.calls.some(
        ([url]) => url.startsWith('/api/labs') && url.includes('dependent_id=fictional-child')
      )
    ).toBe(true)
  );
  await act(async () => {
    finish([]);
  });
  expect(screen.queryByText('Owner private lab')).not.toBeInTheDocument();
});
