import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScanPage, { ScanWorkspace } from './ScanWorkspace';
import { apiFetch } from '@/lib/api/client';
const profile = vi.hoisted(() => ({
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
  delegatePermission: null as string | null,
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));
const empty = {
  scans: [],
  preferences: {},
  latest: {
    scan: null,
    source: null,
    policy: 'choice_required',
    sources: [],
    warnings: [],
    candidate_scan_ids: [],
  },
  coverage: { history_may_be_truncated: false },
};
const fixture = {
  external_id: 'json-1',
  source: 'Fictional BIA',
  method: 'bia',
  measured_at: { precision: 'month', value: '2026-10' },
  provenance: { basis: 'source_reported', sources: [{ reference: 'Fictional report' }] },
  measurements: [{ metric_key: 'body_fat_mass', value: 0, unit: 'kg', raw_text: '0.000 kg' }],
};
beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  profile.dependentId = null;
  profile.delegateOwnerId = null;
  profile.delegatePermission = null;
  vi.mocked(apiFetch).mockImplementation(async (_url, init) =>
    init?.method === 'POST' ? { result: 'created', scan: {} } : empty
  );
});
it('previews a partial date and genuine zero, then retains exact manual input after a failed save', async () => {
  render(<ScanWorkspace ownerId={null} dependentId={null} canWrite />);
  fireEvent.change(screen.getByLabelText('Source name'), { target: { value: 'Fictional BIA' } });
  fireEvent.change(screen.getByLabelText('Source scan / report ID'), {
    target: { value: 'manual-1' },
  });
  fireEvent.change(screen.getByLabelText('Date precision'), { target: { value: 'month' } });
  fireEvent.change(screen.getByLabelText(/Measurement date or exact time/), {
    target: { value: '2026-10' },
  });
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '0.000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan' }));
  expect(screen.getByRole('region', { name: 'Scan import preview' })).toHaveTextContent('2026-10');
  vi.mocked(apiFetch).mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') throw new Error('Synthetic save failure');
    return empty;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save scans' }));
  await screen.findByText(/Failed — Synthetic save failure/);
  expect(screen.getByLabelText('Value')).toHaveValue('0.000');
  const call = vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === 'POST');
  const sent = JSON.parse(call![1]!.body as string);
  expect(sent.scan.measurements[0]).toMatchObject({ value: 0, raw_text: '0.000 kg' });
  expect(sent.scan.measured_at).toEqual({ precision: 'month', value: '2026-10' });
  expect(screen.getByRole('button', { name: 'Confirm and save scans' })).toBeEnabled();
});
it('rejects unsupported JSON fields before writes and saves approved JSON in the exact selected subject', async () => {
  render(<ScanWorkspace ownerId={null} dependentId="fictional-child" canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'JSON import' }));
  fireEvent.change(screen.getByLabelText('Scan JSON'), {
    target: { value: JSON.stringify({ ...fixture, vendor_recommended_calories: 2200 }) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan import' }));
  expect(screen.getByRole('alert')).toHaveTextContent(/Unrecognized/);
  expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
    0
  );
  fireEvent.change(screen.getByLabelText('Scan JSON'), {
    target: { value: JSON.stringify(fixture) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan import' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save scans' }));
  await screen.findByText('json-1: Created');
  const call = vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(call![1]!.body as string)).toMatchObject({
    dependent_id: 'fictional-child',
    scan: fixture,
  });
});
it('stops remaining JSON writes when the selected person changes mid-import', async () => {
  let resolveFirst: (value: unknown) => void = () => {};
  vi.mocked(apiFetch).mockImplementation(async (_url, init) =>
    init?.method === 'POST'
      ? new Promise((resolve) => {
          resolveFirst = resolve;
        })
      : empty
  );
  const view = render(<ScanPage />);
  fireEvent.click(screen.getByRole('button', { name: 'JSON import' }));
  fireEvent.change(screen.getByLabelText('Scan JSON'), {
    target: { value: JSON.stringify([fixture, { ...fixture, external_id: 'json-2' }]) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan import' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save scans' }));
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST')
    ).toHaveLength(1)
  );
  profile.dependentId = 'other-child';
  view.rerender(<ScanPage />);
  resolveFirst({ result: 'created', scan: {} });
  await waitFor(() =>
    expect(
      vi.mocked(apiFetch).mock.calls.some(([url]) => String(url).includes('other-child'))
    ).toBe(true)
  );
  expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
    1
  );
  expect(screen.queryByRole('region', { name: 'Scan import preview' })).not.toBeInTheDocument();
});
