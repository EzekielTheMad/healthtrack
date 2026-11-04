// @vitest-environment node
import { it, expect, vi, beforeEach } from 'vitest';
import type { AiConfiguration } from '@/lib/ai/types';
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./call', () => ({ createMessage: call }));
import { parseTypedLabPdf, TypedLabExtractionError } from './parse-typed-lab';
const config = {
  userId: 'fictional',
  revision: 'revision',
  provider: 'openai',
  primaryModel: 'fictional',
  extractionModel: null,
  apiKey: 'not-a-real-key',
} as AiConfiguration;
beforeEach(() => call.mockReset());
it.each([
  [Buffer.from('%PDF-1.4 fictional'), 'document', 'application/pdf'],
  [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), 'image', 'image/png'],
  [Buffer.from([0xff, 0xd8, 0xff, 0]), 'image', 'image/jpeg'],
])(
  'sends detected content through the matching mocked provider format',
  async (buffer, type, mime) => {
    call.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '```json\n{"results":[{"test_name":"Fictional","value":"Negative"}]}\n```',
        },
      ],
    });
    expect(await parseTypedLabPdf(buffer as Buffer, config)).toMatchObject({
      results: [{ value: 'Negative' }],
    });
    expect(call.mock.calls[0][2].messages[0].content[0]).toMatchObject({
      type,
      source: { media_type: mime },
    });
    expect(call.mock.calls[0][2].system).toContain('Never skip a result');
  }
);
it('rejects invalid JSON safely instead of accepting partial records', async () => {
  call.mockResolvedValue({ content: [{ type: 'text', text: 'invalid extraction' }] });
  await expect(parseTypedLabPdf(Buffer.from('%PDF fictional'), config)).rejects.toBeInstanceOf(
    TypedLabExtractionError
  );
});
