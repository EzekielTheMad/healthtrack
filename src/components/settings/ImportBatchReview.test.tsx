import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImportBatchReview from './ImportBatchReview';
import { apiFetch } from '@/lib/api/client';
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const { setActiveProfile } = vi.hoisted(() => ({ setActiveProfile: vi.fn() }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({ setActiveProfile }),
}));
const fetchMock = vi.mocked(apiFetch);
const original = { test_name: 'Synthetic marker', value: 5, unit: 'mg', visit_date: '2026' };
function batch() {
  return {
    id: 'batch-one',
    file_name: 'synthetic.pdf',
    source_path: 'owner/synthetic.pdf',
    status: 'pending',
    warnings: [],
    counts: { applied: 0, linked: 0, corrected: 0, skipped: 0, pending: 2, error: 0 },
    items: [
      {
        id: 'new',
        domain: 'lab_results',
        payload: original,
        status: 'pending',
        classification: 'new',
        matches: [],
      },
      {
        id: 'possible',
        domain: 'lab_results',
        payload: { ...original, value: 7 },
        status: 'pending',
        classification: 'possible',
        matches: [{ id: 'saved', values: { ...original, visit_date: '2026-02-03', value: 6 } }],
      },
    ],
  };
}
beforeEach(() => {
  fetchMock.mockReset();
  setActiveProfile.mockReset();
});
describe('shared saved document review', () => {
  it('links saved and candidate records to stable anchors for the imported patient, excluding staged entries', async () => {
    const data = batch();
    data.items[1].matches.push({
      id: 'staged:other-entry',
      values: { ...original, visit_date: '2026-02-03' },
    });
    fetchMock.mockResolvedValueOnce({
      ...data,
      dependent_id: 'synthetic-child',
      patient_name: 'Synthetic child',
      items: data.items.map((item) =>
        item.id === 'new' ? { ...item, status: 'linked', record_id: 'new-saved' } : item
      ),
    });
    render(<ImportBatchReview batchId="batch-one" />);
    const savedLink = await screen.findByRole('link', { name: 'View saved lab results' });
    expect(savedLink).toHaveAttribute('href', '/labs#record-new-saved');
    savedLink.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(savedLink, { button: 1 });
    expect(setActiveProfile).toHaveBeenCalledWith('synthetic-child', 'Synthetic child');
    fireEvent.click(screen.getByText('Compare existing / document entries (2)'));
    const candidateLinks = screen.getAllByRole('link', { name: 'View record' });
    expect(candidateLinks).toHaveLength(1);
    expect(candidateLinks[0]).toHaveAttribute('href', '/labs#record-saved');
    candidateLinks[0].addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(candidateLinks[0], { button: 1 });
    expect(setActiveProfile).toHaveBeenCalledTimes(2);
  });

  it('uses clinical comparison fields and never attaches an existing target when adding separately', async () => {
    const data = batch();
    data.items[1].matches[0].values = {
      ...data.items[1].matches[0].values,
      user_id: 'secret-internal-owner',
      dependent_id: 'secret-internal-patient',
    } as never;
    fetchMock
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error('Synthetic save failure'));
    render(<ImportBatchReview batchId="batch-one" />);
    await screen.findByText('Review synthetic.pdf');
    expect(screen.queryByText('secret-internal-owner')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-internal-patient')).not.toBeInTheDocument();
    const selects = screen.getAllByRole('combobox', { name: 'Decision for Synthetic marker' });
    fireEvent.change(selects[0], { target: { value: 'hold' } });
    fireEvent.change(selects[1], { target: { value: 'add' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply decisions (1)' }));
    await screen.findByRole('alert');
    const sent = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(sent.decisions[0].action).toBe('add');
    expect(sent.decisions[0]).not.toHaveProperty('target_id');
  });
  it('defaults ambiguous matches to review and sends only approved decisions', async () => {
    const data = batch();
    fetchMock.mockResolvedValueOnce(data).mockResolvedValueOnce({
      ...data,
      counts: { ...data.counts, applied: 1, pending: 1 },
      items: data.items.map((item) => (item.id === 'new' ? { ...item, status: 'applied' } : item)),
    });
    render(<ImportBatchReview batchId="batch-one" />);
    await screen.findByText('Review synthetic.pdf');
    const selects = screen.getAllByRole('combobox', { name: 'Decision for Synthetic marker' });
    expect(selects[0]).toHaveValue('add');
    expect(selects[1]).toHaveValue('hold');
    fireEvent.click(screen.getByRole('button', { name: 'Apply decisions (1)' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const options = fetchMock.mock.calls[1][1]!;
    const sent = JSON.parse(options.body as string);
    expect(sent.decisions).toHaveLength(1);
    expect(sent.decisions[0].item_id).toBe('new');
    expect(sent.decisions[0].values.visit_date).toBe('2026');
  });
  it('retains review after failure and supplies the selected record snapshot for corrections', async () => {
    fetchMock
      .mockResolvedValueOnce(batch())
      .mockRejectedValueOnce(new Error('Synthetic save failure'));
    render(<ImportBatchReview batchId="batch-one" />);
    await screen.findByText('Review synthetic.pdf');
    const selects = screen.getAllByRole('combobox', { name: 'Decision for Synthetic marker' });
    fireEvent.change(selects[0], { target: { value: 'hold' } });
    fireEvent.change(selects[1], { target: { value: 'correct' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply decisions (1)' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic save failure');
    expect(selects[1]).toHaveValue('correct');
    const sent = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(sent.decisions[0]).toMatchObject({
      action: 'correct',
      target_id: 'saved',
      expected: { value: 6 },
    });
  });
});
