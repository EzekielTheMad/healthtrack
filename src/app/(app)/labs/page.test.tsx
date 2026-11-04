import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { clinicalFactSchema, type FidelityRecord } from '@/lib/fidelity/contracts';
const { api, trend, visit, save } = vi.hoisted(() => ({
  api: vi.fn(),
  trend: vi.fn(),
  visit: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: api }));
vi.mock('@/hooks/useLabResults', () => ({
  useLabResults: () => ({
    labVisits: [],
    loading: false,
    error: null,
    saveLabVisit: save,
    updateLabVisit: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: false } }),
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({ dependentId: null, delegateOwnerId: null }),
}));
vi.mock('@/components/labs/TrendCard', () => ({ default: trend }));
vi.mock('@/components/labs/VisitCard', () => ({ default: visit }));
import LabsPage from './page';
const fact = (id: string, test_name: string, outcome: unknown): FidelityRecord => ({
  id,
  user_id: 'fictional-owner',
  dependent_id: null,
  kind: 'lab',
  fact: clinicalFactSchema.parse({
    kind: 'lab',
    test_name,
    outcome,
    collection_date: { precision: 'month', value: '2020-01' },
    provenance: { basis: 'source_reported' },
  }),
  revision: 'fictional',
  received_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  legacy: false,
});
beforeEach(() => {
  api.mockReset();
  trend.mockReset().mockReturnValue(null);
  visit.mockReset().mockReturnValue(null);
  save.mockReset();
  api.mockResolvedValue({
    records: [
      fact('qualitative', 'Fictional qualitative', { kind: 'text', text: 'Negative' }),
      fact('threshold', 'Fictional threshold', { kind: 'censored', comparator: '<', value: 5 }),
    ],
  });
});
afterEach(() => cleanup());
it('keeps accepted qualitative and threshold history visible without manufacturing numeric visits or trends', async () => {
  render(<LabsPage />);
  await screen.findByText('Negative');
  expect(screen.getByText('<5')).toBeInTheDocument();
  expect(screen.queryByText('No lab results yet')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Detailed clinical records' })).toHaveAttribute(
    'href',
    '/clinical-records'
  );
  expect(
    screen.getByRole('heading', { name: 'No numeric lab results in this view' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'trends' }));
  expect(screen.getByText('Negative')).toBeInTheDocument();
  expect(screen.getByText('<5')).toBeInTheDocument();
  expect(trend).not.toHaveBeenCalled();
  expect(visit).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(api.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
