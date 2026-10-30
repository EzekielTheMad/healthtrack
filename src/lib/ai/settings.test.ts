// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
const mocks = vi.hoisted(() => ({ discover: vi.fn(), generate: vi.fn() }));
vi.mock('./provider', () => ({ discoverModels: mocks.discover, generateText: mocks.generate }));
let ctx: RepoTestDb;
let ai: typeof import('./settings');
const models = [
  { id: 'primary', label: 'Primary', documents: 'test_required' },
  { id: 'document', label: 'Document', documents: 'supported' },
];
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-account-ai-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  ai = await import('./settings');
  mocks.discover.mockReset().mockResolvedValue(models);
  mocks.generate.mockReset().mockResolvedValue('HEALTHTRACK_TEST_OK');
});
afterEach(() => {
  vi.unstubAllEnvs();
  ctx.restore();
});
async function configured(provider: 'anthropic' | 'openai' | 'gemini' = 'openai') {
  const current = ai.readAiSettings(OWNER);
  const draft = await ai.refreshAiModels(
    OWNER,
    current.revision,
    provider,
    'synthetic-private-key'
  );
  await ai.testAiDraft(OWNER, draft.draft_id, 'primary', 'document');
  return ai.saveAiDraft(OWNER, current.revision, draft.draft_id, 'primary', 'document');
}
describe('encrypted per-account settings', () => {
  it('sends a genuinely decodable synthetic PNG in the two-request setup test', async () => {
    const draft = await ai.refreshAiModels(OWNER, 'unconfigured', 'openai', 'synthetic-key');
    await ai.testAiDraft(OWNER, draft.draft_id, 'primary', 'document');
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls.map((call) => call[3].max_tokens)).toEqual([1024, 1024]);
    const input = mocks.generate.mock.calls[1][3] as import('./types').AiMessageInput;
    const content = input.messages[0].content as import('./types').AiContent[];
    expect(content.filter((item) => item.type === 'document')).toHaveLength(1);
    const image = content.find((item) => item.type === 'image')!;
    expect(image.source?.media_type).toBe('image/png');
    const { data, info } = await sharp(Buffer.from(image.source!.data, 'base64'), {
      failOn: 'error',
    })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect({ width: info.width, height: info.height, channels: info.channels }).toEqual({
      width: 1,
      height: 1,
      channels: 4,
    });
    expect([...data]).toEqual([255, 255, 255, 255]);
  });
  it.each(['anthropic', 'openai', 'gemini'] as const)(
    'discovers, tests and saves %s without returning a key',
    async (provider) => {
      const value = await configured(provider);
      expect(value.provider).toBe(provider);
      expect(value.has_key).toBe(true);
      expect(JSON.stringify(value)).not.toContain('synthetic-private-key');
      const raw = ctx.sqlite
        .prepare('SELECT encrypted_key FROM ai_settings WHERE user_id=?')
        .get(OWNER) as { encrypted_key: string };
      expect(raw.encrypted_key).not.toContain('synthetic');
      expect(raw.encrypted_key.split(':')).toHaveLength(3);
      const resolved = ai.resolveAiConfiguration(OWNER);
      expect(resolved.apiKey).toBe('synthetic-private-key');
      expect(mocks.generate.mock.calls.map((c) => c[2])).toEqual(['primary', 'document']);
      expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain(OWNER);
      expect(ai.hasAiConfiguration(STRANGER)).toBe(false);
      expect(() => ai.resolveAiConfiguration(STRANGER)).toThrow('Settings');
    }
  );
  it('ignores legacy environment keys until explicit migration', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'legacy-secret');
    expect(ai.hasAiConfiguration(OWNER)).toBe(false);
    expect(() => ai.resolveAiConfiguration(OWNER)).toThrow('Settings');
  });
  it('requires an exact successful task test and refuses client-invented models', async () => {
    const d = await ai.refreshAiModels(OWNER, 'unconfigured', 'openai', 'synthetic-key');
    expect(() => ai.saveAiDraft(OWNER, 'unconfigured', d.draft_id, 'primary', null)).toThrow(
      'Test'
    );
    await expect(ai.testAiDraft(OWNER, d.draft_id, 'invented', null)).rejects.toThrow(
      'unavailable'
    );
    await ai.testAiDraft(OWNER, d.draft_id, 'primary', null);
    expect(() => ai.saveAiDraft(OWNER, 'unconfigured', d.draft_id, 'primary', 'document')).toThrow(
      'Test'
    );
  });
  it('cannot read/use another account draft', async () => {
    const d = await ai.refreshAiModels(OWNER, 'unconfigured', 'openai', 'synthetic-key');
    await expect(ai.testAiDraft(STRANGER, d.draft_id, 'primary', null)).rejects.toThrow('expired');
    expect(() => ai.saveAiDraft(STRANGER, 'unconfigured', d.draft_id, 'primary', null)).toThrow(
      'expired'
    );
  });
  it('removal fences old work, clears drafts and does not revive a legacy key', async () => {
    const old = await configured();
    const config = ai.resolveAiConfiguration(OWNER);
    await ai.refreshAiModels(OWNER, old.revision, 'openai');
    const removed = ai.removeAiSettings(OWNER, old.revision);
    expect(removed.has_key).toBe(false);
    expect(removed.revision).not.toBe(old.revision);
    expect(() => ai.assertCurrentAiConfiguration(config)).toThrow('changed');
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM ai_setting_drafts').get()).toEqual({ n: 0 });
  });
  it('preserves configuration across reconnecting the same volume', async () => {
    const saved = await configured();
    ctx.sqlite.close();
    expect(ai.readAiSettings(OWNER)).toEqual(saved);
    expect(ai.resolveAiConfiguration(OWNER).apiKey).toBe('synthetic-private-key');
  });
  it('discards a stale test after removal and never sends the second call', async () => {
    const d = await ai.refreshAiModels(OWNER, 'unconfigured', 'openai', 'synthetic-key');
    let finish!: (s: string) => void;
    mocks.generate.mockImplementationOnce(
      () =>
        new Promise<string>((r) => {
          finish = r;
        })
    );
    const running = ai.testAiDraft(OWNER, d.draft_id, 'primary', null);
    ai.removeAiSettings(OWNER, 'unconfigured');
    finish('HEALTHTRACK_TEST_OK');
    await expect(running).rejects.toThrow('expired');
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(ai.readAiSettings(OWNER).has_key).toBe(false);
  });
  it('late discovery cannot overwrite the newer draft', async () => {
    let finish!: (s: unknown) => void;
    mocks.discover.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        })
    );
    const first = ai.refreshAiModels(OWNER, 'unconfigured', 'openai', 'old-synthetic-key');
    const second = await ai.refreshAiModels(OWNER, 'unconfigured', 'gemini', 'new-synthetic-key');
    finish(models);
    await expect(first).rejects.toThrow('expired');
    await ai.testAiDraft(OWNER, second.draft_id, 'primary', null);
    expect(ai.saveAiDraft(OWNER, 'unconfigured', second.draft_id, 'primary', null).provider).toBe(
      'gemini'
    );
  });
  it('failed connection never replaces the working configuration', async () => {
    const saved = await configured();
    mocks.discover.mockRejectedValueOnce(new Error('synthetic-safe-failure'));
    await expect(
      ai.refreshAiModels(OWNER, saved.revision, 'gemini', 'replacement-key')
    ).rejects.toThrow();
    expect(ai.readAiSettings(OWNER)).toEqual(saved);
  });
  it('expired drafts and invalid keys cannot be used', async () => {
    await expect(ai.refreshAiModels(OWNER, 'unconfigured', 'openai', 'bad\nkey')).rejects.toThrow(
      'Check'
    );
    const d = await ai.refreshAiModels(OWNER, 'unconfigured', 'openai', 'synthetic-key');
    ctx.sqlite.prepare('UPDATE ai_setting_drafts SET expires_at=0').run();
    await expect(ai.testAiDraft(OWNER, d.draft_id, 'primary', null)).rejects.toThrow('expired');
  });
});
