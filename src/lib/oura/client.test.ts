import { describe, expect, it, vi } from 'vitest';
import { OuraClient } from './client';

describe('OuraClient endpoint semantics', () => {
  it('uses inclusive daily dates and paginates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'a', day: '2026-09-01' }], next_token: 'next' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'b', day: '2026-09-02' }], next_token: null })));
    await expect(new OuraClient('secret').getDailyActivity('2026-09-01', '2026-09-07')).resolves.toHaveLength(2);
    expect(new URL(fetchMock.mock.calls[0][0] as string).search).toContain('start_date=2026-09-01');
    expect(new URL(fetchMock.mock.calls[0][0] as string).search).toContain('end_date=2026-09-07');
    expect(new URL(fetchMock.mock.calls[1][0] as string).search).toContain('next_token=next');
    fetchMock.mockRestore();
  });
});
