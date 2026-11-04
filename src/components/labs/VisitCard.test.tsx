import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VisitCard from './VisitCard';
import type { LabVisit, LabResult } from '@/lib/types';

afterEach(cleanup);
const result: LabResult = {
  id: 'result-1',
  user_id: 'owner',
  lab_visit_id: 'visit-1',
  panel_name: 'Panel',
  test_name: 'Example test',
  value: 5,
  unit: 'mg/dL',
  reference_range_low: 1,
  reference_range_high: 10,
  reference_range_text: '1–10',
  flag: null,
  created_at: '2026-01-01T12:00:00Z',
};
const visit: LabVisit & { results: LabResult[] } = {
  id: 'visit-1',
  user_id: 'owner',
  visit_date: '2026-01-01',
  provider_id: null,
  source_pdf_path: 'owner/report.pdf',
  notes: null,
  created_at: '2026-01-01T12:00:00Z',
  results: [result],
};

describe('saved lab corrections', () => {
  it('shows the exact calendar date and opens the original authenticated document', () => {
    render(<VisitCard visit={visit} />);
    expect(document.getElementById('record-result-1')).toBeInTheDocument();
    expect(document.getElementById('record-visit-1')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('January 1, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View source document' }));
    expect(screen.getByRole('link', { name: 'Open original document' })).toHaveAttribute(
      'href',
      '/api/files/owner/report.pdf'
    );
    expect(screen.getByTitle('Original lab document')).toHaveAttribute(
      'src',
      '/api/files/owner/report.pdf'
    );
    expect(screen.queryByRole('button', { name: 'Edit lab visit' })).not.toBeInTheDocument();
  });

  it('sends only the changed stable-ID fields and accepts a real zero', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<VisitCard visit={visit} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit lab visit' }));
    fireEvent.change(screen.getByLabelText('Result 1 value'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('visit-1', { results: [{ id: 'result-1', value: 0 }] })
    );
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  });

  it('rejects blanks and retains edits after a server failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Correction failed'));
    render(<VisitCard visit={visit} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit lab visit' }));
    fireEvent.change(screen.getByLabelText('Result 1 value'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blank values are not zero');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Result 1 value'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correction failed');
    expect(screen.getByLabelText('Result 1 value')).toHaveValue(4);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit lab visit' }));
    expect(screen.getByLabelText('Result 1 value')).toHaveValue(5);
  });
});
