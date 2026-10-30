// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessage } from './call';
import { generateText } from '@/lib/ai/provider';
import { assertCurrentAiConfiguration } from '@/lib/ai/settings';
vi.mock('@/lib/ai/provider', () => ({ generateText: vi.fn() }));
vi.mock('@/lib/ai/settings', () => ({ assertCurrentAiConfiguration: vi.fn() }));
const config = {
  userId: 'actor',
  revision: 'v1',
  provider: 'openai' as const,
  primaryModel: 'selected-primary',
  extractionModel: 'selected-extraction',
  apiKey: 'synthetic-key',
};
const input = {
  system: 'fictional',
  max_tokens: 1024,
  messages: [{ role: 'user' as const, content: 'test' }],
};
beforeEach(() => vi.resetAllMocks());
describe('account-bound provider calls', () => {
  it.each(['primary', 'extraction'] as const)(
    'uses the selected %s model and returns public provenance',
    async (task) => {
      vi.mocked(generateText).mockResolvedValue('ok');
      const result = await createMessage(config, task, input);
      expect(generateText).toHaveBeenCalledWith(
        'openai',
        'synthetic-key',
        task === 'primary' ? 'selected-primary' : 'selected-extraction',
        input
      );
      expect(result.provenance).toEqual({
        provider: 'openai',
        model: task === 'primary' ? 'selected-primary' : 'selected-extraction',
        configuration_revision: 'v1',
      });
      expect(JSON.stringify(result)).not.toContain('synthetic-key');
      expect(assertCurrentAiConfiguration).toHaveBeenCalledTimes(2);
    }
  );
  it('does not retry or fall back after a provider error', async () => {
    vi.mocked(generateText).mockRejectedValue(new Error('sanitized'));
    await expect(createMessage(config, 'primary', input)).rejects.toThrow('sanitized');
    expect(generateText).toHaveBeenCalledTimes(1);
  });
  it('fences a removed or changed configuration before sending', async () => {
    vi.mocked(assertCurrentAiConfiguration).mockImplementation(() => {
      throw new Error('changed');
    });
    await expect(createMessage(config, 'primary', input)).rejects.toThrow('changed');
    expect(generateText).not.toHaveBeenCalled();
  });
  it('discards in-flight output after configuration changed', async () => {
    vi.mocked(generateText).mockResolvedValue('stale');
    vi.mocked(assertCurrentAiConfiguration)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('changed');
      });
    await expect(createMessage(config, 'primary', input)).rejects.toThrow('changed');
  });
});
