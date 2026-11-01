import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import type { Dependent } from '@/lib/types';
import { dependentSchema, type DependentFormValues } from '@/lib/validations';
import { useDependents } from './useDependents';
const fetchMock = vi.fn();
const child: Dependent = {
  id: 'fictional-child',
  parent_user_id: 'fictional-owner',
  name: 'Fictional child',
  date_of_birth: '2010-01-01',
  biological_sex: 'male',
  relationship: 'child',
  transition_age: 18,
  transitioned: false,
  transitioned_to: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const values: DependentFormValues = {
  name: child.name,
  date_of_birth: child.date_of_birth,
  biological_sex: null,
  relationship: child.relationship,
  transition_age: child.transition_age,
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValueOnce(json([]));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('accepts null biological sex and sends explicit null in add and update requests', async () => {
  expect(dependentSchema.parse(values).biological_sex).toBeNull();
  const { result } = renderHook(() => useDependents());
  await waitFor(() => expect(result.current.loading).toBe(false));
  fetchMock
    .mockResolvedValueOnce(json({ ...child, biological_sex: null }, 201))
    .mockResolvedValueOnce(json({ ...child, biological_sex: null }));
  await act(async () => {
    await result.current.addDependent(values);
  });
  await act(async () => {
    expect(await result.current.updateDependent(child.id, { biological_sex: null })).toMatchObject({
      biological_sex: null,
    });
  });
  expect(fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(init.body))).toEqual([
    values,
    { id: child.id, biological_sex: null },
  ]);
  expect(result.current.dependents[0].biological_sex).toBeNull();
});
it.each(['add', 'update'])(
  'returns no success on failed %s responses and network errors',
  async (mode) => {
    const { result } = renderHook(() => useDependents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock
      .mockResolvedValueOnce(json({ message: 'Synthetic rejection' }, 400))
      .mockRejectedValueOnce(new Error('Network unavailable'));
    const mutate = () =>
      mode === 'add'
        ? result.current.addDependent(values)
        : result.current.updateDependent(child.id, { biological_sex: null });
    await act(async () => {
      expect(await mutate()).toBeUndefined();
    });
    expect(result.current.error).toBe('Synthetic rejection');
    await act(async () => {
      expect(await mutate()).toBeUndefined();
    });
    expect(result.current.error).toContain('Your entered values are still available');
    expect(result.current.dependents).toEqual([]);
  }
);
it.each([
  ['America/Phoenix', '2026-06-14T20:00:00-07:00', '2010-06-15', 15],
  ['America/Phoenix', '2026-06-15T00:00:00-07:00', '2010-06-15', 16],
  ['America/Phoenix', '2026-06-16T00:00:00-07:00', '2010-06-15', 16],
  ['America/Phoenix', '2027-01-01T02:00:00Z', '2010-01-01', 16],
  ['America/Phoenix', '2027-01-01T07:00:00Z', '2010-01-01', 17],
  ['America/Phoenix', '2027-01-02T07:00:00Z', '2010-01-01', 17],
  ['UTC', '2026-06-14T23:59:00Z', '2010-06-15', 15],
  ['UTC', '2026-06-15T00:00:00Z', '2010-06-15', 16],
  ['UTC', '2026-06-16T00:00:00Z', '2010-06-15', 16],
])('uses local calendar birthday parts in %s at %s', async (timeZone, instant, dob, age) => {
  vi.stubEnv('TZ', timeZone);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  const { result } = renderHook(() => useDependents());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.getAge({ ...child, date_of_birth: dob })).toBe(age);
  expect(result.current.needsTransition({ ...child, date_of_birth: dob, transition_age: 16 })).toBe(
    age >= 16
  );
  expect(
    result.current.needsTransition({
      ...child,
      date_of_birth: dob,
      transition_age: 16,
      transitioned: true,
    })
  ).toBe(false);
});
