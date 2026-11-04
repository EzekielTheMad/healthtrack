import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import type { ClinicalReview } from '@/lib/fidelity/clinical';
const { api, profile } = vi.hoisted(() => ({
  api: vi.fn(),
  profile: {
    dependentId: null as string | null,
    dependentName: null as string | null,
    delegateOwnerId: null as string | null,
  },
}));
const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('@/lib/api/client', () => ({ apiFetch: api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
import ClinicalIntakeWorkspace from './ClinicalIntakeWorkspace';
const fact = {
  kind: 'lab',
  test_name: 'Fictional qualitative',
  outcome: { kind: 'text', text: 'Negative' },
  collection_date: { precision: 'unknown', value: null },
  printed_flags: [],
  provenance: { basis: 'patient_reported', verification: 'unconfirmed', sources: [] },
};
const preview = {
  id: 'batch',
  user_id: 'owner',
  dependent_id: null,
  external_id: 'fictional',
  version: 1,
  digest: 'a'.repeat(64),
  approved_at: null,
  received_at: '2026-10-30T00:00:00Z',
  items: [
    {
      item_key: 'one',
      action: 'add',
      fact,
      matches: [],
      matching_count: 0,
      matching_revision: 'fixture',
      outcome: null,
    },
  ],
  counts: { pending: 1 },
  coverage: [],
  documents: [],
} as ClinicalReview;
beforeEach(() => {
  navigation.query = '';
  profile.dependentId = null;
  profile.dependentName = null;
  profile.delegateOwnerId = null;
  api.mockReset();
  api.mockImplementation(async (url: string) =>
    url.startsWith('/api/clinical-records') ? { records: [] } : []
  );
});
it('rejects a saved batch URL for another selected person before rendering its clinical facts', async () => {
  navigation.query = 'batch_id=private-self';
  profile.dependentId = 'child';
  profile.dependentName = 'Fictional child';
  api.mockImplementation(async (url: string) =>
    url === '/api/clinical-intake/private-self'
      ? preview
      : url.startsWith('/api/clinical-records')
        ? { records: [] }
        : []
  );
  render(<ClinicalIntakeWorkspace />);
  expect(await screen.findByRole('alert')).toHaveTextContent('different person');
  expect(screen.queryByText('Fictional qualitative')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Approve exact batch in HealthTrack' })
  ).not.toBeInTheDocument();
});
it('requires viewing and acknowledging exact preview before approval, and retains it after failure', async () => {
  api.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/clinical-records')) return { records: [] };
    if (url === '/api/clinical-intake' && init?.method === 'POST') return preview;
    if (url.endsWith('/approve')) throw new Error('Synthetic approval failed');
    return [];
  });
  render(<ClinicalIntakeWorkspace />);
  await screen.findByText('No saved previews for this person.');
  fireEvent.click(screen.getByRole('button', { name: 'Typed JSON import' }));
  fireEvent.change(screen.getByLabelText('Typed intake JSON (up to 100 items)'), {
    target: {
      value: JSON.stringify({
        external_id: 'fictional',
        items: [{ item_key: 'one', action: 'add', fact }],
      }),
    },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Preview typed JSON' }).closest('form')!);
  const approve = await screen.findByRole('button', { name: 'Approve exact batch in HealthTrack' });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this exact preview/ }));
  expect(approve).toBeEnabled();
  fireEvent.click(approve);
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic approval failed');
  expect(screen.getByText('Exact preview · fictional')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /I reviewed this exact preview/ })).not.toBeChecked();
  expect(api.mock.calls.find(([url]) => String(url).endsWith('/approve'))?.[1].body).toBe(
    JSON.stringify({ version: 1, digest: 'a'.repeat(64) })
  );
});
it('saving changed choices replaces the digest and clears approval acknowledgment', async () => {
  api.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/clinical-records')) return { records: [] };
    if (init?.method === 'POST') return preview;
    if (init?.method === 'PATCH')
      return {
        ...preview,
        version: 2,
        digest: 'b'.repeat(64),
        items: [{ ...preview.items[0], action: 'skip' }],
      };
    return [];
  });
  render(<ClinicalIntakeWorkspace />);
  await screen.findByText('No saved previews for this person.');
  fireEvent.click(screen.getByRole('button', { name: 'Typed JSON import' }));
  fireEvent.change(screen.getByLabelText('Typed intake JSON (up to 100 items)'), {
    target: {
      value: JSON.stringify({
        external_id: 'fictional',
        items: [{ item_key: 'one', action: 'add', fact }],
      }),
    },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Preview typed JSON' }).closest('form')!);
  await screen.findByRole('button', { name: 'Approve exact batch in HealthTrack' });
  fireEvent.change(screen.getByLabelText('Decision for item 1'), { target: { value: 'skip' } });
  expect(screen.getByRole('button', { name: 'Approve exact batch in HealthTrack' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save review choices' }));
  await screen.findByText(/Version 2/);
  expect(screen.getByRole('checkbox', { name: /I reviewed this exact preview/ })).not.toBeChecked();
  expect(api.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1].body).toContain(
    '"expected_version":1'
  );
});
it('profile switching unmounts the old preview and rejects late previous-person responses', async () => {
  let finish: (value: unknown) => void = () => {};
  api.mockImplementation((url: string) => {
    if (url.startsWith('/api/clinical-records') && !url.includes('dependent_id'))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return Promise.resolve(url.startsWith('/api/clinical-records') ? { records: [] } : []);
  });
  const page = render(<ClinicalIntakeWorkspace />);
  profile.dependentId = 'child';
  profile.dependentName = 'Fictional child';
  page.rerender(<ClinicalIntakeWorkspace />);
  await screen.findByText('Fictional child');
  finish({
    records: [
      {
        id: 'old-private-record',
        kind: 'lab',
        fact,
        user_id: 'owner',
        dependent_id: null,
        revision: 'old',
        received_at: null,
        updated_at: 'old',
        legacy: false,
      },
    ],
  });
  await waitFor(() => expect(screen.queryByText('Fictional qualitative')).not.toBeInTheDocument());
  expect(screen.getByText('No clinical records for this person.')).toBeInTheDocument();
});
