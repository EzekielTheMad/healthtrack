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
  const stored = { ...child, biological_sex: null };
  fetchMock.mockImplementation(async (_url, init) =>
    json(init?.method ? stored : [stored], init?.method === 'POST' ? 201 : 200)
  );
  await act(async () => {
    await result.current.addDependent(values);
  });
  await act(async () => {
    expect(await result.current.updateDependent(child.id, { biological_sex: null })).toMatchObject({
      biological_sex: null,
    });
  });
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method).map(([, init]) => JSON.parse(init.body))
  ).toEqual([values, { id: child.id, biological_sex: null }]);
  expect(result.current.dependents[0].biological_sex).toBeNull();
});

it('refreshes two independent consumers after a successful add, rename and removal', async () => {
  let stored: Dependent[] = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return json(stored);
    if (init.method === 'POST') {
      stored = [child];
      return json(child, 201);
    }
    if (init.method === 'PATCH') {
      stored = [{ ...child, ...JSON.parse(String(init.body)) }];
      return json(stored[0]);
    }
    stored = [];
    return new Response(null, { status: 204 });
  });
  const manager = renderHook(() => useDependents());
  const picker = renderHook(() => useDependents());
  await waitFor(() =>
    expect(manager.result.current.loading || picker.result.current.loading).toBe(false)
  );
  await act(async () => {
    await manager.result.current.addDependent(values);
  });
  await waitFor(() => expect(picker.result.current.dependents).toEqual([child]));
  expect(manager.result.current.dependents).toEqual([child]);
  await act(async () => {
    await manager.result.current.updateDependent(child.id, { name: 'Renamed fictional child' });
  });
  await waitFor(() =>
    expect(picker.result.current.dependents[0].name).toBe('Renamed fictional child')
  );
  expect(manager.result.current.dependents[0].name).toBe('Renamed fictional child');
  await act(async () => {
    await picker.result.current.deleteDependent(child.id);
  });
  await waitFor(() => expect(manager.result.current.dependents).toEqual([]));
  expect(picker.result.current.dependents).toEqual([]);
  // Reads stay session-scoped and bypass the browser's response cache.
  for (const [url, init] of fetchMock.mock.calls.filter(([, init]) => !init?.method)) {
    expect(url).toBe('/api/dependents');
    expect(init).toEqual({ cache: 'no-store' });
  }
});

it.each(['POST', 'PATCH', 'DELETE'])(
  'does not broadcast or change either consumer after a failed %s write',
  async (method) => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method ? json({ message: 'Fictional rejected write' }, 409) : json([child])
    );
    const manager = renderHook(() => useDependents());
    const picker = renderHook(() => useDependents());
    await waitFor(() =>
      expect(manager.result.current.loading || picker.result.current.loading).toBe(false)
    );
    const readsBefore = fetchMock.mock.calls.length;
    const originalValues = { ...values };
    const mutate = () =>
      method === 'POST'
        ? manager.result.current.addDependent(values)
        : method === 'PATCH'
          ? manager.result.current.updateDependent(child.id, { name: 'Rejected rename' })
          : manager.result.current.deleteDependent(child.id);
    await act(async () => {
      await mutate();
    });
    expect(manager.result.current.error).toBe('Fictional rejected write');
    expect(manager.result.current.dependents).toEqual([child]);
    expect(picker.result.current.dependents).toEqual([child]);
    expect(picker.result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(readsBefore + 1);
    expect(values).toEqual(originalValues);
    fetchMock.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => {
      await mutate();
    });
    expect(manager.result.current.error).toContain('Failed to');
    expect(manager.result.current.dependents).toEqual([child]);
    expect(picker.result.current.dependents).toEqual([child]);
    expect(fetchMock).toHaveBeenCalledTimes(readsBefore + 2);
  }
);

it('ignores an older response body that finishes after another consumer changed the list', async () => {
  let finishOldBody!: (data: Dependent[]) => void;
  const oldBody = new Promise<Dependent[]>((resolve) => {
    finishOldBody = resolve;
  });
  let stored: Dependent[] = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce({ ok: true, json: () => oldBody });
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      stored = [child];
      return json(child, 201);
    }
    return json(stored);
  });
  const stalePicker = renderHook(() => useDependents());
  const manager = renderHook(() => useDependents());
  await waitFor(() => expect(manager.result.current.loading).toBe(false));
  await act(async () => {
    await manager.result.current.addDependent(values);
  });
  await waitFor(() => expect(stalePicker.result.current.dependents).toEqual([child]));
  await act(async () => {
    finishOldBody([]);
  });
  expect(stalePicker.result.current.dependents).toEqual([child]);
  expect(manager.result.current.dependents).toEqual([child]);
  expect(stalePicker.result.current.loading).toBe(false);
});

it('removes unmounted subscribers and still refreshes mounted consumers if a successful write finishes after unmount', async () => {
  let finishWrite!: (response: Response) => void;
  let stored: Dependent[] = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method)
      return new Promise<Response>((resolve) => {
        finishWrite = resolve;
      });
    return json(stored);
  });
  const manager = renderHook(() => useDependents());
  const picker = renderHook(() => useDependents());
  await waitFor(() =>
    expect(manager.result.current.loading || picker.result.current.loading).toBe(false)
  );
  let saving!: ReturnType<typeof manager.result.current.addDependent>;
  act(() => {
    saving = manager.result.current.addDependent(values);
  });
  manager.unmount();
  stored = [child];
  await act(async () => {
    finishWrite(json(child, 201));
    await saving;
  });
  await waitFor(() => expect(picker.result.current.dependents).toEqual([child]));
  expect(fetchMock.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(3);
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
