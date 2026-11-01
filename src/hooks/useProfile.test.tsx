import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { apiFetch, ApiRequestError } from '@/lib/api/client';
import type { Dependent, Profile } from '@/lib/types';
import { useProfile } from './useProfile';

const { selected } = vi.hoisted(() => ({
  selected: { dependentId: null as string | null, delegateOwnerId: null as string | null },
}));

vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  apiFetch: vi.fn(),
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => selected }));

const owner: Profile = {
  id: 'synthetic-owner',
  display_name: 'Synthetic owner',
  date_of_birth: '1980-01-01',
  biological_sex: 'male',
  height_inches: 74,
  weight_lbs: 210,
  unit_system: 'metric',
  created_at: '2020-01-01T12:00:00Z',
  updated_at: '2020-01-01T12:00:00Z',
};
const child: Dependent = {
  id: 'synthetic-child',
  parent_user_id: owner.id,
  name: 'Synthetic child',
  date_of_birth: '2018-06-15',
  biological_sex: 'female',
  relationship: 'child',
  transition_age: 18,
  transitioned: false,
  transitioned_to: null,
  created_at: '2021-01-01T12:00:00Z',
  updated_at: '2021-01-01T12:00:00Z',
};

beforeEach(() => {
  selected.dependentId = null;
  selected.delegateOwnerId = null;
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('selected profile demographics', () => {
  it('treats only the authenticated owner self 404 as an incomplete profile without creating one', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiRequestError('Profile not found', 404));
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ profile: null, missing: true, error: null });
    expect(vi.mocked(apiFetch).mock.calls).toEqual([['/api/profile']]);
  });
  it.each([
    new ApiRequestError('Profile not found', 401),
    new ApiRequestError('Profile not found', 403),
    new ApiRequestError('Profile not found', 500),
    new Error('Profile not found'),
  ])(
    'keeps status/network failures unknown rather than treating their message as a missing profile',
    async (failure) => {
      vi.mocked(apiFetch).mockRejectedValueOnce(failure);
      const { result } = renderHook(() => useProfile());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current).toMatchObject({
        profile: null,
        missing: false,
        error: 'Profile not found',
      });
    }
  );
  it('retains a delegated 404 as unavailable and never falls back to the actor profile', async () => {
    selected.delegateOwnerId = 'delegated-owner';
    vi.mocked(apiFetch).mockRejectedValueOnce(new ApiRequestError('Not found', 404));
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ profile: null, missing: false, error: 'Not found' });
    expect(vi.mocked(apiFetch).mock.calls).toEqual([['/api/profile?owner_id=delegated-owner']]);
  });
  it('clears the missing state only after an explicitly saved owner profile succeeds', async () => {
    vi.mocked(apiFetch)
      .mockRejectedValueOnce(new ApiRequestError('Profile not found', 404))
      .mockResolvedValueOnce(owner);
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.missing).toBe(true));
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.updateProfile({ display_name: owner.display_name });
    });
    expect(result.current).toMatchObject({ profile: owner, missing: false, error: null });
  });
  it('hides owner demographics on the first child render and never copies owner height or weight', async () => {
    let resolveDependents!: (value: Dependent[]) => void;
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(owner)
      .mockReturnValueOnce(
        new Promise<Dependent[]>((resolve) => {
          resolveDependents = resolve;
        })
      )
      .mockResolvedValueOnce(owner);
    const rendered: (Profile | null)[] = [];
    const { result, rerender } = renderHook(() => {
      const state = useProfile();
      rendered.push(state.profile);
      return state;
    });
    await waitFor(() => expect(result.current.profile?.id).toBe(owner.id));
    rendered.length = 0;
    selected.dependentId = child.id;
    rerender();
    expect(result.current.profile).toBeNull();
    expect(rendered.every((profile) => profile === null)).toBe(true);
    await act(async () => {
      resolveDependents([child]);
    });
    await waitFor(() => expect(result.current.profile?.id).toBe(child.id));
    expect(result.current.profile).toMatchObject({
      display_name: child.name,
      date_of_birth: child.date_of_birth,
      biological_sex: child.biological_sex,
      height_inches: null,
      weight_lbs: null,
      unit_system: 'metric',
    });
    expect(rendered.every((profile) => profile === null || profile.id === child.id)).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('loads the child when the owner profile is absent and defaults only units to imperial', async () => {
    selected.dependentId = child.id;
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([child])
      .mockRejectedValueOnce(new ApiRequestError('Profile not found', 404));
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profile).toMatchObject({
      id: child.id,
      display_name: child.name,
      date_of_birth: child.date_of_birth,
      biological_sex: child.biological_sex,
      height_inches: null,
      weight_lbs: null,
      unit_system: 'imperial',
    });
    expect(result.current.error).toBeNull();
    expect(vi.mocked(apiFetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/dependents',
      '/api/profile',
    ]);
  });

  it('keeps loaded child demographics when an earlier owner save finishes late', async () => {
    let resolveSave!: (value: Profile) => void;
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(owner)
      .mockReturnValueOnce(
        new Promise<Profile>((resolve) => {
          resolveSave = resolve;
        })
      )
      .mockResolvedValueOnce([child])
      .mockResolvedValueOnce(owner);
    const { result, rerender } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.profile?.id).toBe(owner.id));
    let pending!: ReturnType<typeof result.current.updateProfile>;
    act(() => {
      pending = result.current.updateProfile({ display_name: 'Saved owner' });
    });
    selected.dependentId = child.id;
    rerender();
    await waitFor(() => expect(result.current.profile?.id).toBe(child.id));
    await act(async () => {
      resolveSave({ ...owner, display_name: 'Saved owner' });
      await pending;
    });
    expect(result.current.profile).toMatchObject({
      id: child.id,
      height_inches: null,
      weight_lbs: null,
    });
    expect(result.current.error).toBeNull();
  });

  it('rethrows a failed owner save and retains the previously loaded profile', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(owner)
      .mockRejectedValueOnce(new Error('Synthetic save failure'));
    const { result } = renderHook(() => useProfile());
    await waitFor(() => expect(result.current.profile?.id).toBe(owner.id));
    await act(async () => {
      await expect(result.current.updateProfile({ weight_lbs: 200 })).rejects.toThrow(
        'Synthetic save failure'
      );
    });
    expect(result.current.profile).toEqual(owner);
    expect(result.current.error).toBe('Synthetic save failure');
  });

  it.each(['child', 'delegate'] as const)(
    'rejects Settings profile writes for a selected %s',
    async (subject) => {
      if (subject === 'child') {
        selected.dependentId = child.id;
        vi.mocked(apiFetch).mockResolvedValueOnce([child]).mockResolvedValueOnce(owner);
      } else {
        selected.delegateOwnerId = 'delegated-owner';
        vi.mocked(apiFetch).mockResolvedValueOnce({ ...owner, id: 'delegated-owner' });
      }
      const { result } = renderHook(() => useProfile());
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => {
        await expect(result.current.updateProfile({ height_inches: 72 })).rejects.toThrow(
          'your own record'
        );
      });
      expect(vi.mocked(apiFetch).mock.calls.every(([, options]) => options?.method !== 'PUT')).toBe(
        true
      );
    }
  );
});
