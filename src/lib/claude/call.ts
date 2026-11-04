import { generateText } from '@/lib/ai/provider';
import { assertCurrentAiConfiguration } from '@/lib/ai/settings';
import {
  aiProvenance,
  type AiConfiguration,
  type AiMessageInput,
  type AiTask,
} from '@/lib/ai/types';

/** Fixed official provider; no provider/model/key fallback. */
export async function createMessage(config: AiConfiguration, task: AiTask, input: AiMessageInput) {
  assertCurrentAiConfiguration(config);
  const provenance = aiProvenance(config, task);
  const text = await generateText(config.provider, config.apiKey, provenance.model, input);
  assertCurrentAiConfiguration(config);
  return { content: [{ type: 'text' as const, text }], provenance };
}
