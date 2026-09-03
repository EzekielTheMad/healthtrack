import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ syncAllOuraUsers: vi.fn() }));
vi.mock('./sync', () => ({ syncAllOuraUsers: mocks.syncAllOuraUsers }));

import { runOuraSyncOnce } from './scheduler';

type TestGlobal = typeof globalThis & {
  __healthtrackOuraScheduler?: { running: boolean; timer?: ReturnType<typeof setInterval> };
};

beforeEach(() => {
  delete (globalThis as TestGlobal).__healthtrackOuraScheduler;
  mocks.syncAllOuraUsers.mockReset();
});

describe('Oura scheduler run behavior', () => {
  it('prevents overlapping runs and allows a later run after completion', async () => {
    let resolveFirst!: (value: {
      usersAttempted: number;
      synced: number;
      errors: string[];
    }) => void;
    mocks.syncAllOuraUsers
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ usersAttempted: 1, synced: 2, errors: [] });

    const first = runOuraSyncOnce();
    await expect(runOuraSyncOnce()).resolves.toBeNull();
    expect(mocks.syncAllOuraUsers).toHaveBeenCalledTimes(1);

    resolveFirst({ usersAttempted: 1, synced: 1, errors: [] });
    await expect(first).resolves.toMatchObject({ synced: 1 });
    await expect(runOuraSyncOnce()).resolves.toMatchObject({ synced: 2 });
    expect(mocks.syncAllOuraUsers).toHaveBeenCalledTimes(2);
  });

  it('surfaces per-user summary errors and returns them to callers', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const summary = {
      usersAttempted: 2,
      synced: 5,
      errors: ['user-2: Sleep fetch error: unavailable'],
    };
    mocks.syncAllOuraUsers.mockResolvedValue(summary);

    await expect(runOuraSyncOnce()).resolves.toEqual(summary);
    expect(consoleError).toHaveBeenCalledWith(
      '[oura] scheduler sync errors:',
      'user-2: Sleep fetch error: unavailable'
    );
  });

  it('surfaces a top-level scheduler failure without leaving the lock stuck', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.syncAllOuraUsers
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ usersAttempted: 0, synced: 0, errors: [] });

    await expect(runOuraSyncOnce()).resolves.toEqual({
      usersAttempted: 0,
      synced: 0,
      errors: ['database unavailable'],
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[oura] scheduler run failed:',
      'database unavailable'
    );
    await expect(runOuraSyncOnce()).resolves.toMatchObject({ errors: [] });
  });
});
