import { afterEach, describe, expect, it, vi } from 'vitest';
import { OuraClient } from './client';
import { OuraApiError, retryAfterAt } from './errors';

afterEach(() => vi.restoreAllMocks());
describe('OuraClient endpoint semantics', () => {
  it('uses inclusive daily dates and paginates', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'a', day: '2026-09-01' }], next_token: 'next' })
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: 'b', day: '2026-09-02' }], next_token: null })
      );
    await expect(
      new OuraClient('synthetic').getDailyActivity('2026-09-01', '2026-09-07')
    ).resolves.toHaveLength(2);
    expect(new URL(fetch.mock.calls[0][0] as string).search).toContain('start_date=2026-09-01');
    expect(new URL(fetch.mock.calls[0][0] as string).search).toContain('end_date=2026-09-07');
    expect(new URL(fetch.mock.calls[1][0] as string).search).toContain('next_token=next');
  });
});
describe('Oura safe provider requests', () => {
  it('refreshes and retries once on an unexpected access-token 401', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('sensitive provider body', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: [], next_token: null }));
    const refresh = vi.fn().mockResolvedValue('rotated');
    await expect(
      new OuraClient('old', refresh).getSpO2('2026-10-01', '2026-10-02')
    ).resolves.toEqual([]);
    expect(refresh).toHaveBeenCalledExactlyOnceWith('old');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1]?.headers).toEqual({ Authorization: 'Bearer rotated' });
  });
  it('does not loop on a repeated 401 or echo a provider body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret-body', { status: 401 }));
    const refresh = vi.fn().mockResolvedValue('rotated');
    const result = new OuraClient('old', refresh).getSpO2('2026-10-01', '2026-10-02');
    await expect(result).rejects.toMatchObject({ status: 401, code: 'auth_required' });
    await expect(result).rejects.not.toThrow(/secret-body/);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('retains a rate-limit retry deadline without retrying immediately', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
    const before = Date.now();
    try {
      await new OuraClient('old').getSpO2('2026-10-01', '2026-10-02');
      throw new Error('expected rate limit');
    } catch (error) {
      expect(error).toBeInstanceOf(OuraApiError);
      expect(Date.parse((error as OuraApiError).retryAt!)).toBeGreaterThanOrEqual(before + 120_000);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('parses Retry-After seconds and HTTP dates and ignores past or malformed values', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(retryAfterAt('60', now)).toBe('2026-10-01T00:01:00.000Z');
    expect(retryAfterAt('Thu, 01 Oct 2026 00:02:00 GMT', now)).toBe('2026-10-01T00:02:00.000Z');
    expect(retryAfterAt('bad', now)).toBeNull();
    expect(retryAfterAt('2020-01-01', now)).toBeNull();
  });
});
