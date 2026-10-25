import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PairApproval from './PairApproval';
const account = vi.hoisted(() => ({ id: 'owner' }));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({ data: { user: { id: account.id } }, isPending: false }),
}));
const request = {
  request_id: 'synthetic-request',
  status: 'pending',
  expires_at: '2099-01-01T00:00:00Z',
  server_url: 'https://health.invalid',
  account: { id: 'owner', name: 'Synthetic owner', email: 'owner@example.invalid' },
  device: { name: 'Synthetic phone' },
  legacy_delivery_active: true,
  active_device: null,
  subjects: [
    { id: 'self', name: 'My record', kind: 'owner' },
    { id: 'child', name: 'Synthetic child', kind: 'dependent' },
  ],
};
beforeEach(() => {
  account.id = 'owner';
});
afterEach(() => vi.unstubAllGlobals());
describe('phone pairing approval', () => {
  it('requires explicit sender replacement and sends only selected offline grants', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => request });
    vi.stubGlobal('fetch', fetcher);
    render(<PairApproval requestId="synthetic-request" />);
    const button = await screen.findByRole('button', { name: 'Approve this phone' });
    expect(button).toBeDisabled();
    expect(screen.getByText('https://health.invalid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Replace the Life Dashboard/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Synthetic child' }));
    fireEvent.click(button);
    await screen.findByText('Phone approved');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      replace_existing: true,
      offline_subjects: ['child'],
    });
  });
  it('retains consent choices after failed approval and does not claim success', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => request })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Request expired; begin again.' }),
      });
    vi.stubGlobal('fetch', fetcher);
    render(<PairApproval requestId="synthetic-request" />);
    await screen.findByRole('button', { name: 'Approve this phone' });
    const replace = screen.getByRole('checkbox', { name: /Replace the Life Dashboard/ });
    fireEvent.click(replace);
    const child = screen.getByRole('checkbox', { name: 'Synthetic child' });
    fireEvent.click(child);
    fireEvent.click(screen.getByRole('button', { name: 'Approve this phone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Request expired');
    expect(replace).toBeChecked();
    expect(child).toBeChecked();
    expect(screen.queryByText('Phone approved')).toBeNull();
  });
  it('discards the previous account request snapshot on account change', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => request })
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<PairApproval requestId="synthetic-request" />);
    await screen.findByText('Synthetic owner · owner@example.invalid');
    account.id = 'other';
    view.rerender(<PairApproval requestId="synthetic-request" />);
    expect(screen.queryByText('Synthetic owner · owner@example.invalid')).toBeNull();
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
