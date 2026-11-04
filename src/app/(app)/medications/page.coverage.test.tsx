import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { clinicalFactSchema, type FidelityRecord } from '@/lib/fidelity/contracts';
const { api, medCard, add, update, check } = vi.hoisted(() => ({
  api: vi.fn(),
  medCard: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  check: vi.fn(),
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: api }));
vi.mock('@/hooks/useMedications', () => ({
  useMedications: () => ({
    medications: [],
    loading: false,
    error: null,
    addMedication: add,
    updateMedication: update,
  }),
}));
vi.mock('@/hooks/useInteractionAlerts', () => ({
  useInteractionAlerts: () => ({
    alerts: [],
    status: null,
    snoozedCount: 0,
    checking: false,
    error: null,
    snoozeAlert: vi.fn(),
    checkInteractions: check,
  }),
}));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: false } }),
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => ({ dependentId: null, delegateOwnerId: null }),
}));
vi.mock('@/components/medications/MedCard', () => ({ default: medCard }));
import MedicationsPage from './page';
const record = (id: string, input: unknown): FidelityRecord => {
  const fact = clinicalFactSchema.parse(input);
  return {
    id,
    user_id: 'fictional-owner',
    dependent_id: null,
    kind: fact.kind,
    fact,
    revision: 'fictional',
    received_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    legacy: false,
  };
};
beforeEach(() => {
  api.mockReset();
  medCard.mockReset().mockReturnValue(null);
  add.mockReset();
  update.mockReset();
  check.mockReset();
  api.mockImplementation(async (url: string) => ({
    records: [
      url.includes('kind=medication_event')
        ? record('missed-event', {
            kind: 'medication_event',
            medication_id: 'course',
            event: 'missed',
            event_date: { precision: 'day', value: '2026-01-01' },
            provenance: { basis: 'patient_reported' },
          })
        : record('course', {
            kind: 'medication',
            name: 'Fictional unconfirmed course',
            status: 'unconfirmed',
            provenance: { basis: 'source_reported' },
          }),
    ],
  }));
});
afterEach(() => cleanup());
it('preserves detailed unconfirmed courses and reported events while keeping active and inactive counts truthful', async () => {
  render(<MedicationsPage />);
  await screen.findByText('Fictional unconfirmed course');
  expect(screen.getByText('missed')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'active (0)' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('No active medications')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Detailed clinical records' })).toHaveAttribute(
    'href',
    '/clinical-records'
  );
  fireEvent.click(screen.getByRole('tab', { name: 'past (0)' }));
  expect(screen.getByText('No medications marked inactive')).toBeInTheDocument();
  expect(screen.getByText('Fictional unconfirmed course')).toBeInTheDocument();
  expect(screen.getByText('missed')).toBeInTheDocument();
  expect(medCard).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(check).not.toHaveBeenCalled();
  expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
});
