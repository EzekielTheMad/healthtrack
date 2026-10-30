export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiTask = 'primary' | 'extraction';
export interface AiModel {
  id: string;
  label: string;
  /** Discovery is advisory. A successful synthetic task test is required to save. */
  documents: 'supported' | 'unsupported' | 'test_required';
}
export interface AiProvenance {
  provider: AiProvider;
  model: string;
  configuration_revision: string;
}
/** Server-only value. Never serialize this object or attach it to an error. */
export interface AiConfiguration {
  userId: string;
  revision: string;
  provider: AiProvider;
  primaryModel: string;
  extractionModel: string | null;
  apiKey: string;
}
export interface AiContent {
  type: 'text' | 'document' | 'image';
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}
export interface AiMessageInput {
  system: string;
  max_tokens: number;
  messages: { role: 'user'; content: string | AiContent[] }[];
}
export function aiProvenance(config: AiConfiguration, task: AiTask = 'primary'): AiProvenance {
  return {
    provider: config.provider,
    model:
      task === 'extraction' ? (config.extractionModel ?? config.primaryModel) : config.primaryModel,
    configuration_revision: config.revision,
  };
}
