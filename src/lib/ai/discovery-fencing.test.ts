// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setupRepoDb, insertUser, OWNER, type RepoTestDb } from '@/lib/repos/repo-test-harness';

let ctx: RepoTestDb;
let ai: typeof import('./settings');
const fetchMock = vi.fn();
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-discovery-fencing-');
  insertUser(ctx.sqlite, OWNER);
  ai = await import('./settings');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  ctx.restore();
});

it.each(['removal', 'replacement', 'expiry'] as const)(
  '%s while the first discovery page is pending prevents another request with that key',
  async (change) => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const running = ai.refreshAiModels(OWNER, 'unconfigured', 'anthropic', 'synthetic-old-key');
    const failed = expect(running).rejects.toThrow('expired');
    if (change === 'removal') ai.removeAiSettings(OWNER, 'unconfigured');
    else if (change === 'expiry')
      ctx.sqlite.prepare('UPDATE ai_setting_drafts SET expires_at=0').run();
    else {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              { name: 'models/gemini-fixture', supportedGenerationMethods: ['generateContent'] },
            ],
          })
        )
      );
      await ai.refreshAiModels(OWNER, 'unconfigured', 'gemini', 'synthetic-new-key');
    }
    finish(
      new Response(
        JSON.stringify({ data: [{ id: 'claude-fixture' }], has_more: true, last_id: 'next-page' })
      )
    );
    await failed;
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('api.anthropic.com'))
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(change === 'replacement' ? 2 : 1);
  }
);
