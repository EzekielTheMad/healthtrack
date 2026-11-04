import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ScanPage, { ScanWorkspace } from './ScanWorkspace';
import { apiFetch } from '@/lib/api/client';
import { type BodyScan, scanInputSchema } from '@/lib/fidelity/contracts';
import { normalizeScanMeasurements } from '@/lib/metrics/scan-normalization';
import { selectCoherentScan } from '@/lib/fidelity/scan-selection';
const profile = vi.hoisted(() => ({
  dependentId: null as string | null,
  delegateOwnerId: null as string | null,
  delegatePermission: null as string | null,
}));
const plotted = vi.hoisted(() => ({ data: [] as { id: string; value: number | null }[] }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ data }: { data: typeof plotted.data }) => {
    plotted.data = data;
    return null;
  },
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

it('previews and retries ordinary regional/vendor fields, exact dates and scoped references without losing zero or blanks', async () => {
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    if (String(url).startsWith('/api/medications?'))
      return {
        records: [
          {
            id: 'legacy:medication:creatine',
            fact: {
              kind: 'medication',
              name: 'Fictional creatine',
              supplement: true,
              status: 'historical',
              start_date: { precision: 'month', value: '2024-03' },
            },
          },
          {
            id: 'not-a-supplement',
            fact: {
              kind: 'medication',
              name: 'Fictional prescription',
              supplement: false,
              status: 'active',
            },
          },
        ],
      };
    if (init?.method === 'POST') throw new Error('Synthetic retry needed');
    return empty;
  });
  render(<ScanWorkspace ownerId="delegated-owner" dependentId="fictional-child" canWrite />);
  function enter(label: string | RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  enter('Source name', 'Fictional BIA');
  enter('Source scan / report ID', 'full-manual');
  enter('Date precision', 'instant');
  enter(/Measurement date or exact time/, '2026-10-30T09:30:00-07:00');
  enter(/Measurement timezone/, 'America/Phoenix');
  enter(/Workout exact timestamp/, '2026-10-30T08:00:00-07:00');
  enter(/Workout timezone/, 'America/Phoenix');
  fireEvent.click(screen.getByRole('button', { name: 'Add five-region lean and fat rows' }));
  screen
    .getAllByLabelText('Value')
    .slice(1)
    .forEach((field, index) =>
      fireEvent.change(field, { target: { value: index === 1 ? '0.000' : '2.123456' } })
    );
  enter('Metric 2: Source definition / protocol', 'Vendor regional lean, not skeletal muscle');
  fireEvent.click(screen.getByRole('button', { name: 'Load supplements for this person' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /Fictional creatine/ }));
  expect(screen.queryByText('Fictional prescription')).not.toBeInTheDocument();
  enter('Durable source reference', 'Fictional report');
  enter('Source 1: Protected document ID', 'retained-child-report');
  enter('Source 1: Report page', '2');
  fireEvent.click(screen.getByText('Vendor scores, body age, references and recommendations'));
  fireEvent.click(screen.getByRole('button', { name: 'Add body age' }));
  enter('Body age: Reported value or text', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Add source score' }));
  enter('Source score 1: Score identifier', 'fitness');
  enter('Source score 1: Score name', 'Vendor fitness score');
  enter('Source score 1: Reported value or text', '0');
  enter('Source score 1: Source definition', 'Proprietary vendor score');
  enter('Source score 1: Reference lower bound', '0');
  enter('Source score 1: Reference upper bound', '100');
  fireEvent.click(screen.getByRole('button', { name: 'Add reference band' }));
  enter('Reference band 1: Reference label', 'Printed band');
  enter('Reference band 1: Reference description', 'No numeric bound provided');
  fireEvent.click(screen.getByRole('button', { name: 'Add recommendation' }));
  enter('Recommendation 1: Recommendation name', 'Weight control');
  enter('Recommendation 1: Recommendation text', 'Printed recommendation');
  enter('Recommendation 1: Optional numeric value', '0');
  enter('Recommendation 1: Source unit', 'kg');
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan' }));
  const preview = screen.getByRole('region', { name: 'Scan import preview' });
  expect(preview).toHaveTextContent('10 reported values');
  expect(preview).toHaveTextContent('0.000 kg');
  expect(preview).toHaveTextContent('Vendor fitness score');
  expect(preview).toHaveTextContent('No numeric bound provided');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save scans' }));
  await screen.findByText(/Failed — Synthetic retry needed/);
  expect(screen.getByLabelText('Recommendation 1: Optional numeric value')).toHaveValue('0');
  expect(screen.getByLabelText('Source 1: Report page')).toHaveValue('2');
  const writes = () => vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  const sent = JSON.parse(writes()[0][1]!.body as string);
  expect(sent).toMatchObject({
    owner_id: 'delegated-owner',
    dependent_id: 'fictional-child',
    scan: {
      external_id: 'full-manual',
      measured_at: {
        precision: 'instant',
        value: '2026-10-30T09:30:00-07:00',
        timezone: 'America/Phoenix',
      },
      conditions: {
        workout_at: {
          precision: 'instant',
          value: '2026-10-30T08:00:00-07:00',
          timezone: 'America/Phoenix',
        },
      },
      supplement_record_ids: ['legacy:medication:creatine'],
      provenance: {
        sources: [{ reference: 'Fictional report', document_id: 'retained-child-report', page: 2 }],
      },
      vendor_results: {
        body_age: { value: 0, unit: 'years' },
        scores: [{ value: 0, reference: { low: 0, high: 100 } }],
        recommendations: [{ value: 0, unit: 'kg' }],
      },
    },
  });
  expect(sent.scan.measurements).toHaveLength(10);
  expect(sent.scan.measurements[0]).toMatchObject({
    metric_key: 'lean_mass_left_arm',
    definition: 'Vendor regional lean, not skeletal muscle',
  });
  expect(sent.scan.measurements[1]).toMatchObject({
    metric_key: 'fat_mass_left_arm',
    value: 0,
    raw_text: '0.000 kg',
  });
  expect(sent.scan.vendor_results.reference_bands[0].reference).not.toHaveProperty('low');
  const supplementRead = vi
    .mocked(apiFetch)
    .mock.calls.find(([url]) => String(url).startsWith('/api/medications?'));
  expect(String(supplementRead?.[0])).toContain(
    'owner_id=delegated-owner&dependent_id=fictional-child'
  );
  vi.mocked(apiFetch).mockImplementation(async (_url, init) =>
    init?.method === 'POST' ? { result: 'existing', scan: {} } : empty
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save scans' }));
  await screen.findByText('full-manual: Already saved');
  expect(writes()[1][1]!.body).toBe(writes()[0][1]!.body);
});

it('rejects offset-free workout times, invalid timezones and pages before any write', async () => {
  render(<ScanWorkspace ownerId={null} dependentId={null} canWrite />);
  fireEvent.change(screen.getByLabelText('Source name'), { target: { value: 'Fictional BIA' } });
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText(/Workout exact timestamp/), {
    target: { value: '2026-10-30T08:00:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan' }));
  expect(screen.getByRole('alert')).toHaveTextContent('conditions.workout_at');
  fireEvent.change(screen.getByLabelText(/Workout exact timestamp/), {
    target: { value: '2026-10-30T08:00:00Z' },
  });
  fireEvent.change(screen.getByLabelText(/Workout timezone/), { target: { value: 'MadeUp/Zone' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan' }));
  expect(screen.getByRole('alert')).toHaveTextContent('timezone');
  fireEvent.change(screen.getByLabelText(/Workout timezone/), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Durable source reference'), {
    target: { value: 'Report' },
  });
  fireEvent.change(screen.getByLabelText('Source 1: Report page'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview scan' }));
  expect(screen.getByRole('alert')).toHaveTextContent('page');
  expect(vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
    0
  );
});

it('displays source and derived ratios separately and excludes incompatible protocols from a shared plot', async () => {
  function report(id: string, date: string, definition: string, value: number): BodyScan {
    const scan = scanInputSchema.parse({
      ...fixture,
      external_id: id,
      manufacturer: 'Fictional',
      model: 'One',
      measured_at: { precision: 'instant', value: date },
      conditions: { workout_status: 'pre_workout', fasting_status: 'fasted' },
      measurements: [
        { metric_key: 'phase_angle', value, unit: 'degrees', definition },
        { metric_key: 'weight', value: 80, unit: 'kg' },
        { metric_key: 'body_fat_mass', value: 20, unit: 'kg' },
        { metric_key: 'total_body_water', value: 40, unit: 'kg' },
        { metric_key: 'extracellular_water', value: 16, unit: 'kg' },
        { metric_key: 'ecw_ratio', value: 0.39, unit: 'fraction' },
      ],
      vendor_results: {
        scores: [{ key: 'score', name: 'Vendor zero', value: 0 }],
        recommendations: [{ name: 'Printed advice', text: 'No change', value: 0, unit: 'kg' }],
      },
    });
    return {
      id,
      user_id: 'owner',
      dependent_id: null,
      scan,
      measurements: normalizeScanMeasurements(scan),
      revision: id,
      received_at: '2026-11-01T00:00:00Z',
    };
  }
  const current = report('current', '2026-10-30T10:00:00Z', 'Right side 50kHz', 6.5);
  const matching = report('matching', '2026-09-30T10:00:00Z', 'Right side 50kHz', 6);
  const otherProtocol = report('other-protocol', '2026-08-30T10:00:00Z', 'Whole body 250kHz', 7);
  const unknown = report('unknown', '2026-07-30T10:00:00Z', 'Right side 50kHz', 7);
  unknown.scan.conditions!.workout_status = 'unknown';
  const rows = [current, matching, otherProtocol, unknown];
  vi.mocked(apiFetch).mockResolvedValue({
    ...empty,
    scans: rows,
    latest: selectCoherentScan(rows),
  });
  render(<ScanWorkspace ownerId={null} dependentId={null} canWrite={false} />);
  const details = await screen.findByRole('article', { name: 'Selected scan' });
  expect(details).toHaveTextContent('Source: 0.39 fraction');
  const derived = within(details).getByRole('region', { name: 'Derived from this scan' });
  expect(derived).toHaveTextContent('0.4 fraction');
  expect(derived).toHaveTextContent('25 %');
  expect(derived).toHaveTextContent('Formula: extracellular_water / total_body_water');
  expect(within(details).getByRole('region', { name: 'Source vendor outputs' })).toHaveTextContent(
    'No change · 0 kg'
  );
  fireEvent.change(screen.getByLabelText('Observation plot'), { target: { value: 'phase_angle' } });
  expect(plotted.data.map((row) => row.id)).toEqual(['matching', 'current']);
  fireEvent.change(screen.getByLabelText('Compare with baseline'), {
    target: { value: 'other-protocol' },
  });
  expect(details).toHaveTextContent('Source metric definitions differ');
  expect(details).toHaveTextContent('Unavailable / not comparable');
  expect(screen.queryByRole('button', { name: 'Preview scan' })).not.toBeInTheDocument();
});
