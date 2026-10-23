import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '@/lib/api/client';
import MedicalHistoryImport from './MedicalHistoryImport';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/hooks/useDependents', () => ({
  useDependents: () => ({ dependents: [{ id: 'synthetic-child', name: 'Synthetic child' }] }),
}));
vi.mock('./ImportBatchReview', () => ({
  default: ({
    batchId,
    onComplete,
    onCancel,
  }: {
    batchId: string;
    onComplete: () => void;
    onCancel: () => void;
  }) => (
    <section aria-label="Saved review">
      <p>Review {batchId}</p>
      <button onClick={onComplete}>Finish saved review</button>
      <button onClick={onCancel}>Close saved review</button>
    </section>
  ),
}));

const ownerReview = {
  id: 'owner-batch',
  file_name: 'synthetic-owner.pdf',
  status: 'pending',
  created_at: '2026-01-01T12:00:00Z',
};
const childReview = {
  id: 'child-batch',
  file_name: 'synthetic-child.pdf',
  status: 'incomplete',
  created_at: '2026-01-02T12:00:00Z',
};

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('saved medical history reviews without AI extraction', () => {
  it('loads, resumes, and completes a saved review while extraction remains disabled even with a selected PDF', async () => {
    vi.mocked(apiFetch).mockResolvedValue([ownerReview]);
    render(<MedicalHistoryImport extractionEnabled={false} />);
    const saved = await screen.findByRole('button', { name: /synthetic-owner.pdf/ });
    expect(apiFetch).toHaveBeenCalledWith('/api/import-batches');
    expect(screen.getByText(/AI extraction is not configured/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('PDF (up to 50MB), PNG or JPG (up to 10MB)'), {
      target: { files: [new File(['synthetic'], 'new-report.pdf', { type: 'application/pdf' })] },
    });
    const extract = screen.getByRole('button', { name: 'Extract and review' });
    expect(extract).toBeDisabled();
    fireEvent.click(extract);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(saved);
    expect(screen.getByRole('region', { name: 'Saved review' })).toHaveTextContent(
      'Review owner-batch'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Finish saved review' }));
    expect(await screen.findByRole('button', { name: /synthetic-owner.pdf/ })).toBeInTheDocument();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Extract and review' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads only the selected patient saved reviews and can resume/close them without AI', async () => {
    let resolveChild!: (rows: (typeof childReview)[]) => void;
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([ownerReview])
      .mockReturnValueOnce(
        new Promise<(typeof childReview)[]>((resolve) => {
          resolveChild = resolve;
        })
      )
      .mockResolvedValueOnce([childReview]);
    render(<MedicalHistoryImport extractionEnabled={false} />);
    await screen.findByRole('button', { name: /synthetic-owner.pdf/ });
    fireEvent.change(screen.getByLabelText('Import into profile'), {
      target: { value: 'synthetic-child' },
    });
    expect(screen.queryByRole('button', { name: /synthetic-owner.pdf/ })).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenLastCalledWith('/api/import-batches?dependent_id=synthetic-child');
    await act(async () => {
      resolveChild([childReview]);
    });
    fireEvent.click(await screen.findByRole('button', { name: /synthetic-child.pdf/ }));
    expect(screen.getByRole('region', { name: 'Saved review' })).toHaveTextContent(
      'Review child-batch'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close saved review' }));
    expect(await screen.findByRole('button', { name: /synthetic-child.pdf/ })).toBeInTheDocument();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
    expect(apiFetch).toHaveBeenLastCalledWith('/api/import-batches?dependent_id=synthetic-child');
    expect(fetch).not.toHaveBeenCalled();
  });
});
