import { AiError } from './errors';
import type { AiContent, AiMessageInput, AiModel, AiProvider } from './types';

// These origins and paths are fixed. No user-supplied URLs or redirect credentials.
const roots = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
} as const;
const validModel = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function request(
  provider: AiProvider,
  apiKey: string,
  path: string,
  body?: unknown
): Promise<Json> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider === 'gemini') headers['x-goog-api-key'] = apiKey;
  else headers.Authorization = `Bearer ${apiKey}`;
  try {
    const response = await fetch(`${roots[provider]}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AiError(
        [401, 403].includes(response.status)
          ? 'authentication'
          : response.status === 429
            ? 'quota'
            : [400, 404, 422].includes(response.status)
              ? 'model_unavailable'
              : 'network'
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AiError('invalid_response');
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new AiError('invalid_response');
      }
      chunks.push(value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof SyntaxError) throw new AiError('invalid_response');
    throw new AiError(
      error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'timeout'
        : 'network'
    );
  }
}

/** Discovery never submits clinical data. All pages are bounded, never silently truncated. */
export async function discoverModels(
  provider: AiProvider,
  apiKey: string,
  assertActive: () => void
): Promise<AiModel[]> {
  const models = new Map<string, AiModel>();
  let cursor = '';
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const path =
      provider === 'anthropic'
        ? `/models?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`
        : provider === 'gemini'
          ? `/models?pageSize=100${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`
          : '/models';
    assertActive();
    const result = await request(provider, apiKey, path);
    const entries = array(provider === 'gemini' ? result.models : result.data);
    for (const raw of entries) {
      const item = object(raw);
      const id = String(provider === 'gemini' ? (item.name ?? '') : (item.id ?? '')).replace(
        /^models\//,
        ''
      );
      if (!validModel.test(id)) continue;
      if (provider === 'anthropic' && (!id.startsWith('claude-') || item.lifecycle === 'retired'))
        continue;
      // OpenAI lists non-generation endpoints too; compatibility is established by explicit tests.
      if (
        provider === 'openai' &&
        (!/^(gpt-|o\d)/.test(id) ||
          /audio|realtime|image|transcri|tts|search|embedding|codex|chat-latest/i.test(id))
      )
        continue;
      if (
        provider === 'gemini' &&
        (!id.startsWith('gemini-') ||
          !array(item.supportedGenerationMethods).includes('generateContent') ||
          /image|tts|live|audio|robotics/i.test(id))
      )
        continue;
      const caps = object(item.capabilities);
      const pdf = object(caps.pdf_input).supported;
      const image = object(caps.image_input).supported;
      models.set(id, {
        id,
        label: String(item.display_name ?? item.displayName ?? id).slice(0, 200),
        documents:
          pdf === false || image === false
            ? 'unsupported'
            : pdf === true && image === true
              ? 'supported'
              : 'test_required',
      });
      if (models.size > 2000) throw new AiError('invalid_response');
    }
    const next =
      provider === 'anthropic' && result.has_more
        ? String(result.last_id ?? '')
        : provider === 'gemini'
          ? String(result.nextPageToken ?? '')
          : '';
    if (!next) {
      if (!models.size) throw new AiError('model_unavailable');
      return [...models.values()].sort((a, b) => a.label.localeCompare(b.label));
    }
    if (seen.has(next) || models.size > 2000) throw new AiError('invalid_response');
    seen.add(next);
    cursor = next;
  }
  throw new AiError('invalid_response');
}

export async function generateText(
  provider: AiProvider,
  apiKey: string,
  model: string,
  input: AiMessageInput
): Promise<string> {
  if (!validModel.test(model)) throw new AiError('invalid_settings');
  const content: AiContent[] = input.messages.flatMap((m) =>
    typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content
  );
  let result: Json;
  let text = '';
  if (provider === 'anthropic') {
    result = await request(provider, apiKey, '/messages', { model, ...input });
    if (result.stop_reason !== 'end_turn') throw new AiError('invalid_response');
    text = array(result.content)
      .map(object)
      .filter((c) => c.type === 'text')
      .map((c) => String(c.text ?? ''))
      .join('\n');
  } else if (provider === 'openai') {
    result = await request(provider, apiKey, '/responses', {
      model,
      store: false,
      instructions: input.system,
      max_output_tokens: input.max_tokens,
      input: [
        {
          role: 'user',
          content: content.map((c) =>
            c.type === 'text'
              ? { type: 'input_text', text: c.text }
              : c.type === 'image'
                ? {
                    type: 'input_image',
                    image_url: `data:${c.source!.media_type};base64,${c.source!.data}`,
                  }
                : {
                    type: 'input_file',
                    filename: 'document.pdf',
                    file_data: `data:application/pdf;base64,${c.source!.data}`,
                  }
          ),
        },
      ],
    });
    if (result.status !== 'completed') throw new AiError('invalid_response');
    text = array(result.output)
      .map(object)
      .filter((o) => o.type === 'message')
      .flatMap((o) => array(o.content))
      .map(object)
      .filter((c) => c.type === 'output_text')
      .map((c) => String(c.text ?? ''))
      .join('\n');
  } else {
    result = await request(
      provider,
      apiKey,
      `/models/${encodeURIComponent(model)}:generateContent`,
      {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [
          {
            role: 'user',
            parts: content.map((c) =>
              c.type === 'text'
                ? { text: c.text }
                : { inlineData: { mimeType: c.source!.media_type, data: c.source!.data } }
            ),
          },
        ],
        generationConfig: { maxOutputTokens: input.max_tokens },
      }
    );
    const candidate = object(array(result.candidates)[0]);
    if (candidate.finishReason !== 'STOP') throw new AiError('invalid_response');
    text = array(object(candidate.content).parts)
      .map(object)
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => String(p.text))
      .join('\n');
  }
  if (!text.trim()) throw new AiError('invalid_response');
  return text;
}
