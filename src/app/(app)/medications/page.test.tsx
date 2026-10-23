import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MedicationsPage from './page';
import { useInteractionAlerts } from '@/hooks/useInteractionAlerts';
import { useMedications } from '@/hooks/useMedications';
import type { Medication } from '@/lib/types';

vi.mock('@/hooks/useInteractionAlerts', () => ({ useInteractionAlerts: vi.fn() }));
vi.mock('@/hooks/useMedications', () => ({ useMedications: vi.fn() }));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: true } }),
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({ delegateOwnerId: null }),
}));
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

const medicine: Medication = {
  id: 'med-1',
  user_id: 'owner',
  name: 'Synthetic A',
  dosage: '5 mg',
  frequency: 'once_daily',
  category: null,
  prescriber_id: null,
  start_date: '2000-01-01',
  end_date: null,
  active: true,
  notes: null,
  rxcui: '12345',
  created_at: '2000-01-01T12:00:00Z',
  updated_at: '2000-01-01T12:00:00Z',
};
const update = vi.fn();
const check = vi.fn();
beforeEach(() => {
  update.mockReset().mockResolvedValue(undefined);
  check.mockReset().mockResolvedValue({ hasInteractions: false });
  vi.mocked(useMedications).mockReturnValue({
    medications: [medicine, { ...medicine, id: 'med-2', name: 'Synthetic B' }],
    loading: false,
    error: null,
    addMedication: vi.fn(),
    updateMedication: update,
  });
  vi.mocked(useInteractionAlerts).mockReturnValue({
    alerts: [],
    status: { checked_at: '2000-01-01T12:00:00Z', has_interactions: false },
    snoozedCount: 0,
    checking: false,
    loading: false,
    error: null,
    snoozeAlert: vi.fn(),
    checkInteractions: check,
  });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('medication interaction refresh triggers', () => {
  it('opens the past tab for an imported inactive record after loading and follows later hash changes', async () => {
    const inactive = { ...medicine, id: 'past-med', name: 'Past synthetic', active: false };
    const loaded = {
      medications: [medicine, inactive],
      loading: false,
      error: null,
      addMedication: vi.fn(),
      updateMedication: update,
    };
    vi.mocked(useMedications).mockReturnValue({ ...loaded, medications: [], loading: true });
    window.history.replaceState(null, '', '/medications#record-past-med');
    const { rerender } = render(<MedicationsPage />);
    vi.mocked(useMedications).mockReturnValue(loaded);
    rerender(<MedicationsPage />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'past (1)' })).toHaveAttribute('aria-selected', 'true')
    );
    expect(document.getElementById('record-past-med')).toBeInTheDocument();
    window.history.replaceState(null, '', '/medications#record-med-1');
    fireEvent(window, new HashChangeEvent('hashchange'));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'active (1)' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(document.getElementById('record-med-1')).toBeInTheDocument();
  });

  it.each(['name', 'dosage', 'frequency', 'status'])(
    'rechecks after a meaningful %s edit',
    async (field) => {
      render(<MedicationsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Edit Synthetic A' }));
      if (field === 'name')
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Synthetic renamed' } });
      if (field === 'dosage')
        fireEvent.change(screen.getByLabelText('Dosage'), { target: { value: '10 mg' } });
      if (field === 'frequency')
        fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'twice_daily' } });
      if (field === 'status') fireEvent.click(screen.getByRole('switch'));
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
      if (field === 'status') expect(check).toHaveBeenCalledWith();
      else expect(check).toHaveBeenCalledWith('med-1');
    }
  );

  it('does not spend an AI check for a date-only edit and preserves the code', async () => {
    render(<MedicationsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Synthetic A' }));
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '2000-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'med-1',
        expect.objectContaining({ start_date: '2000-02-01', rxcui: '12345' })
      )
    );
    expect(check).not.toHaveBeenCalled();
  });

  it('preserves an unknown frequency during a date-only correction without checking', async () => {
    vi.mocked(useMedications).mockReturnValue({
      medications: [{ ...medicine, frequency: null }],
      loading: false,
      error: null,
      addMedication: vi.fn(),
      updateMedication: update,
    });
    render(<MedicationsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Synthetic A' }));
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '2000-02-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'med-1',
        expect.objectContaining({ start_date: '2000-02-01', frequency: null })
      )
    );
    expect(check).not.toHaveBeenCalled();
  });

  it('does not check after a failed medication write', async () => {
    update.mockRejectedValueOnce(new Error('Medication save unavailable'));
    render(<MedicationsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Synthetic A' }));
    fireEvent.change(screen.getByLabelText('Dosage'), { target: { value: '10 mg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Medication save unavailable');
    expect(check).not.toHaveBeenCalled();
  });

  it('keeps previous warnings visibly stale rather than presenting a clean result', () => {
    vi.mocked(useMedications).mockReturnValue({
      medications: [medicine],
      loading: false,
      error: null,
      addMedication: vi.fn(),
      updateMedication: update,
    });
    vi.mocked(useInteractionAlerts).mockReturnValue({
      alerts: [
        {
          id: 'warning-1',
          user_id: 'owner',
          trigger_medication_id: 'med-1',
          alert_text: 'Previous synthetic warning',
          severity: 'warning',
          dismissed: false,
          checked_at: '2000-01-01T12:00:00Z',
          medication_snapshot: {},
        },
      ],
      status: null,
      snoozedCount: 0,
      checking: false,
      loading: false,
      error: 'Check unavailable',
      snoozeAlert: vi.fn(),
      checkInteractions: check,
    });
    render(<MedicationsPage />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Previous interaction alerts may be out of date'
    );
    expect(screen.getByText('Check unavailable')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText(/No interactions found/)).not.toBeInTheDocument();
  });

  it('marks snoozed warnings stale even when only one active medication remains', () => {
    vi.mocked(useMedications).mockReturnValue({
      medications: [medicine],
      loading: false,
      error: null,
      addMedication: vi.fn(),
      updateMedication: update,
    });
    vi.mocked(useInteractionAlerts).mockReturnValue({
      alerts: [],
      status: null,
      snoozedCount: 1,
      checking: false,
      loading: false,
      error: null,
      snoozeAlert: vi.fn(),
      checkInteractions: check,
    });
    render(<MedicationsPage />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Previous interaction alerts may be out of date'
    );
    expect(screen.getByRole('button', { name: 'Check interactions' })).toBeInTheDocument();
    expect(screen.queryByText(/No interactions found/)).not.toBeInTheDocument();
  });
});
