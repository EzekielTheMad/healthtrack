import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCachedHealthData, cacheHealthData } from './cache';
import { enqueueAction, dequeueActions } from './queue';
afterEach(() => vi.unstubAllGlobals());
describe('legacy offline quarantine', () => {
  it('cannot read another person from user-only cache or consume old unscoped actions', async () => {
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    expect(await getCachedHealthData('signed-in-user')).toBeNull();
    expect(await dequeueActions()).toEqual([]);
    await expect(cacheHealthData('user', { medications: [] })).rejects.toThrow(/disabled/);
    await expect(enqueueAction('/api/medications', 'POST', { name: 'synthetic' })).rejects.toThrow(
      /disabled/
    );
    expect(open).not.toHaveBeenCalled();
  });
});
