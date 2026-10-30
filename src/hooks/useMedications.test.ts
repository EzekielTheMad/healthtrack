import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { useMedications } from './useMedications';
import { apiFetch } from '@/lib/api/client';
import type { Medication } from '@/lib/types';

const { profile } = vi.hoisted(() => ({
  profile: { dependentId: null as string | null, delegateOwnerId: null as string | null },
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({
  useActiveProfile: () => profile,
}));
beforeEach(() => {
  profile.dependentId = null;
  profile.delegateOwnerId = null;
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('medication mutation failures', () => {
  it('rejects failed mutations so the editor can retain the unsaved draft', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Write rejected'));
    const { result } = renderHook(() => useMedications());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(
        result.current.updateMedication('med-1', { start_date: '2026-01-01' })
      ).rejects.toThrow('Write rejected');
    });
    expect(result.current.error).toBe('Write rejected');
    expect(result.current.medications).toEqual([]);
  });

  it('hides owner rows immediately and ignores their late mutation response after selecting a child', async () => {
    const owner = { id: 'owner-med', name: 'Owner medicine', active: true } as Medication;
    const child = { id: 'child-med', name: 'Child medicine', active: true } as Medication;
    let resolve!: (value: Medication) => void;
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([owner])
      .mockReturnValueOnce(
        new Promise<Medication>((done) => {
          resolve = done;
        })
      )
      .mockResolvedValueOnce([child]);
    const { result, rerender } = renderHook(() => useMedications());
    await waitFor(() => expect(result.current.medications[0]?.id).toBe('owner-med'));
    let pending!: ReturnType<typeof result.current.addMedication>;
    act(() => {
      pending = result.current.addMedication({ name: 'Owner added', active: true } as Parameters<
        typeof result.current.addMedication
      >[0]);
    });
    profile.dependentId = 'child-one';
    rerender();
    expect(result.current.medications).toEqual([]);
    await waitFor(() => expect(result.current.medications[0]?.id).toBe('child-med'));
    await act(async () => {
      resolve({ ...owner, id: 'late-owner-med' });
      await pending;
    });
    expect(result.current.medications).toEqual([child]);
    expect(vi.mocked(apiFetch).mock.calls[2][0]).toBe('/api/medications?dependent_id=child-one');
  });
});
