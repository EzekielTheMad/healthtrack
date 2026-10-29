// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverModels, generateText } from './provider';
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const input = {
  system: 'fictional system',
  max_tokens: 1024,
  messages: [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'fictional' },
        {
          type: 'document' as const,
          source: { type: 'base64' as const, media_type: 'application/pdf', data: 'JVBERg==' },
        },
        {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: 'image/png', data: 'iVBORw==' },
        },
      ],
    },
  ],
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
describe('fixed official provider transports', () => {
  it.each(['anthropic', 'openai', 'gemini'] as const)(
    'formats text/PDF/image for %s and sends credentials only in headers',
    async (provider) => {
      fetchMock.mockResolvedValue(
        json(
          provider === 'anthropic'
            ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }
            : provider === 'openai'
              ? {
                  status: 'completed',
                  output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
                }
              : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }
        )
      );
      expect(await generateText(provider, 'secret-synthetic-key', 'selected-model', input)).toBe(
        'ok'
      );
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).not.toContain('secret');
      expect(options.redirect).toBe('error');
      expect(options.cache).toBe('no-store');
      expect(options.body).not.toContain('secret');
      const body = JSON.parse(options.body);
      if (provider === 'openai') {
        expect(body.store).toBe(false);
        expect(body.input[0].content.map((p: { type: string }) => p.type)).toEqual([
          'input_text',
          'input_file',
          'input_image',
        ]);
      }
      if (provider === 'gemini')
        expect(body.contents[0].parts[1].inlineData.mimeType).toBe('application/pdf');
      if (provider === 'anthropic')
        expect(body.messages[0].content[2].source.media_type).toBe('image/png');
    }
  );
  it.each([401, 403, 404, 429, 500])(
    'sanitizes provider %s errors and never retries',
    async (status) => {
      fetchMock.mockResolvedValue(json({ message: 'sensitive-key-and-clinical-data' }, status));
      try {
        await generateText('openai', 'synthetic-key', 'selected-model', input);
        throw Error('should fail');
      } catch (e) {
        expect(String(e)).not.toContain('sensitive');
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );
  it('sanitizes network messages and malformed output', async () => {
    fetchMock.mockRejectedValueOnce(new Error('sensitive-url-key'));
    await expect(generateText('openai', 'synthetic-key', 'selected-model', input)).rejects.toThrow(
      'could not be reached'
    );
    fetchMock.mockResolvedValueOnce(new Response('bad-json'));
    await expect(generateText('openai', 'synthetic-key', 'selected-model', input)).rejects.toThrow(
      'unsupported'
    );
  });
  it('rejects truncation and refuses external model paths before sending', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] })
    );
    await expect(
      generateText('anthropic', 'synthetic-key', 'selected-model', input)
    ).rejects.toThrow('incomplete');
    await expect(generateText('gemini', 'synthetic-key', '../external', input)).rejects.toThrow(
      'Check'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('discovers Anthropic capabilities and follows bounded pagination', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: 'claude-one',
              display_name: 'One',
              capabilities: { pdf_input: { supported: true }, image_input: { supported: true } },
            },
          ],
          has_more: true,
          last_id: 'claude-one',
        })
      )
      .mockResolvedValueOnce(
        json({
          data: [{ id: 'claude-two', capabilities: { pdf_input: { supported: false } } }],
          has_more: false,
        })
      );
    expect(await discoverModels('anthropic', 'synthetic-key', () => {})).toEqual(
      [
        { id: 'claude-one', label: 'One', documents: 'supported' },
        { id: 'claude-two', label: 'claude-two', documents: 'unsupported' },
      ].sort((a, b) => a.label.localeCompare(b.label))
    );
    expect(fetchMock.mock.calls[1][0]).toContain('after_id=claude-one');
  });
  it('filters models for the implemented direct endpoint without inventing capabilities', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [{ id: 'gpt-synthetic' }, { id: 'gpt-synthetic-realtime' }, { id: 'embedding-test' }],
      })
    );
    expect(await discoverModels('openai', 'synthetic-key', () => {})).toEqual([
      { id: 'gpt-synthetic', label: 'gpt-synthetic', documents: 'test_required' },
    ]);
    fetchMock.mockResolvedValueOnce(
      json({
        models: [
          { name: 'models/gemini-synthetic', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] },
        ],
      })
    );
    expect((await discoverModels('gemini', 'synthetic-key', () => {}))[0].id).toBe(
      'gemini-synthetic'
    );
  });
});
