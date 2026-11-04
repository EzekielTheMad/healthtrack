import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  clinicalFactSchema,
  scanInputSchema,
  type FidelityRecord,
  type BodyScan,
} from '@/lib/fidelity/contracts';
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({ dependentId: null, delegateOwnerId: null }),
}));
vi.mock('@/hooks/useVitals', () => ({
  useVitals: () => ({ vitals: [], loading: false, error: null }),
}));
vi.mock('@/hooks/useMedications', () => ({
  useMedications: () => ({ medications: [], loading: false, error: null }),
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
import DashboardPage from './page';
const fetchMock = vi.fn();
const acceptedLab: FidelityRecord = {
  id: 'accepted-lab',
  user_id: 'fictional-owner',
  dependent_id: null,
  kind: 'lab',
  fact: clinicalFactSchema.parse({
    kind: 'lab',
    test_name: 'Fictional qualitative lab',
    outcome: { kind: 'text', text: 'Negative' },
    collection_date: { precision: 'unknown', value: null },
    provenance: { basis: 'source_reported' },
  }),
  revision: 'fixture',
  received_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  legacy: false,
};
const acceptedMedication: FidelityRecord = {
  ...acceptedLab,
  id: 'accepted-course',
  kind: 'medication',
  fact: clinicalFactSchema.parse({
    kind: 'medication',
    name: 'Fictional unconfirmed course',
    status: 'unconfirmed',
    provenance: { basis: 'source_reported' },
  }),
};
const acceptedScan: BodyScan = {
  id: 'accepted-scan',
  user_id: 'fictional-owner',
  dependent_id: null,
  scan: scanInputSchema.parse({
    external_id: 'fictional-scan',
    source: 'fictional-bia',
    method: 'bia',
    measured_at: { precision: 'unknown', value: null },
    measurements: [{ metric_key: 'body_fat_pct', value: 20, unit: '%' }],
    provenance: { basis: 'source_reported' },
  }),
  measurements: [
    {
      metric_key: 'body_fat_pct',
      value: 20,
      unit: '%',
      source_value: 20,
      source_unit: '%',
      estimated: true,
    },
  ],
  revision: 'fixture',
  received_at: '2026-01-01T00:00:00Z',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function routeResponse(input: string, profileStatus: number | 'network') {
  const url = new URL(input, 'http://localhost');
  if (url.pathname === '/api/profile') {
    if (profileStatus === 'network') throw new Error('Network unavailable');
    return json(
      {
        error: profileStatus === 404 ? 'not_found' : 'request_failed',
        message: profileStatus === 404 ? 'Profile not found' : 'Profile request failed',
      },
      profileStatus
    );
  }
  if (url.pathname === '/api/labs') return json([]);
  if (url.pathname === '/api/clinical-records')
    return json({
      format: 'typed',
      records: [url.searchParams.get('kind') === 'lab' ? acceptedLab : acceptedMedication],
      coverage: {
        limit: 1,
        legacy_receipt: 'unknown',
        warning: 'Qualified results retain their source precision.',
      },
    });
  if (url.pathname === '/api/scans')
    return json({
      scans: [acceptedScan],
      preferences: {},
      latest: null,
      focused_scan_id: null,
      coverage: {
        limit: 1,
        returned: 1,
        history_may_be_truncated: true,
        order: 'measurement_evidence_then_stable_id',
        unknown_dates_are_not_latest: true,
      },
    });
  throw new Error('Unexpected fixture request');
}
beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
it('uses the real fetch helper and route-shaped results to show 3/6 for accepted history plus a confirmed missing owner profile', async () => {
  fetchMock.mockImplementation(async (input: string) => routeResponse(input, 404));
  render(<DashboardPage />);
  expect(await screen.findByText('3 of 6 complete')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Complete your profile' })).toHaveAttribute(
    'href',
    '/settings?tab=profile'
  );
  expect(screen.queryByText(/Setup progress is unavailable/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Detailed clinical records' })).toBeInTheDocument();
  const presenceCalls = fetchMock.mock.calls
    .map(([url]) => new URL(url, 'http://localhost'))
    .filter((url) => url.pathname === '/api/clinical-records' || url.pathname === '/api/scans');
  expect(presenceCalls).toHaveLength(3);
  for (const url of presenceCalls) expect(url.searchParams.get('limit')).toBe('1');
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
    true
  );
});
it.each([401, 403, 500, 'network'] as const)(
  'keeps profile failure %s unknown while accepted clinical/scans history remains readable',
  async (status) => {
    fetchMock.mockImplementation(async (input: string) => routeResponse(input, status));
    render(<DashboardPage />);
    expect(await screen.findByText(/Setup progress is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/of 6 complete/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Detailed clinical records' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
      true
    );
  }
);
