import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedCard from './MedCard';
import type { Medication } from '@/lib/types';

vi.mock('@/components/shared/ProviderPicker', () => ({
  ProviderPicker: () => <span>Prescriber</span>,
}));
vi.mock('@/components/shared/MedicalAutocomplete', () => ({
  MedicalAutocomplete: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string, code: string | null) => void;
  }) => (
    <label>
      Name
      <input value={value} onChange={(event) => onChange(event.target.value, null)} />
    </label>
  ),
}));
afterEach(cleanup);

const medication: Medication = {
  id: 'med-1',
  user_id: 'owner',
  name: 'Example medicine',
  dosage: '10 mg',
  frequency: 'once_daily',
  category: null,
  prescriber_id: null,
  start_date: '2026-01-01',
  end_date: null,
  active: true,
  notes: null,
  rxcui: '123456',
  created_at: '2026-01-01T12:00:00Z',
  updated_at: '2026-01-01T12:00:00Z',
};

describe('medication corrections', () => {
  it('shows the exact calendar day and preserves its code when changing a date', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<MedCard medication={medication} onUpdate={onUpdate} />);
    expect(screen.getByText('Started Jan 1, 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Example medicine' }));
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '2025-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        'med-1',
        expect.objectContaining({ start_date: '2025-12-31', rxcui: '123456' })
      )
    );
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  });

  it('keeps unknown start dates blank and preserves a printed imported frequency', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <MedCard
        medication={{ ...medication, start_date: null, frequency: 'once each morning with food' }}
        onUpdate={onUpdate}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Example medicine' }));
    expect(screen.getByLabelText(/Start Date/)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        'med-1',
        expect.objectContaining({ start_date: '', frequency: 'once each morning with food' })
      )
    );
  });

  it('retains the draft and inline error after a failed save, then permits retry', async () => {
    const onUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Save unavailable'))
      .mockResolvedValue(undefined);
    render(<MedCard medication={medication} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Example medicine' }));
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '2025-12-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.getByLabelText(/Start Date/)).toHaveValue('2025-12-20');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  });
});
