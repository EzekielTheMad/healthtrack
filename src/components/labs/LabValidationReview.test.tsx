import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LabValidationReview from './LabValidationReview';
import type { ParsedLabResult } from '@/lib/claude/parse-lab';

afterEach(cleanup);
const parsedData: ParsedLabResult = {
  visit_date: '2026-01-01',
  provider_name: 'Example Lab',
  results: [
    {
      panel_name: null,
      test_name: 'Example test',
      value: 5,
      unit: 'mg/dL',
      reference_range_low: null,
      reference_range_high: null,
      reference_range_text: null,
      flag: null,
      confidence: 'high',
    },
  ],
};

describe('lab extraction numeric review', () => {
  it('blocks a cleared value, while a recorded zero remains valid', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <LabValidationReview
        parsedData={parsedData}
        storagePath="owner/report.pdf"
        onSave={onSave}
        onCancel={vi.fn()}
        onReparse={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('Result 1 value'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Health Record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Blank values are not zero');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Result 1 value'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Health Record' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ results: [expect.objectContaining({ value: 0 })] }),
        'owner/report.pdf'
      )
    );
  });

  it('requires the report date instead of silently replacing an unknown date with today', async () => {
    const onSave = vi.fn();
    render(
      <LabValidationReview
        parsedData={{ ...parsedData, visit_date: null }}
        storagePath="owner/report.pdf"
        onSave={onSave}
        onCancel={vi.fn()}
        onReparse={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save to Health Record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('collection / visit date');
    expect(onSave).not.toHaveBeenCalled();
  });
});
