/** Only fixed messages cross the API boundary. Never retain provider bodies/causes. */
const messages = {
  not_configured: 'Choose and test an AI provider in Settings → AI before using this feature.',
  changed: 'AI settings changed while this request was running. Reload and try again.',
  draft_expired: 'This settings draft expired or was replaced. Refresh models and test again.',
  authentication:
    'The provider rejected this API key or its permissions. Check the key and account access.',
  quota: 'The provider rate limit or spending quota was reached. Check billing or try again later.',
  model_unavailable:
    'The selected model is unavailable for this account or task. Refresh models and test another selection.',
  network: 'The AI provider could not be reached. Check connectivity and try again.',
  timeout: 'The AI provider took too long to respond. Try again.',
  invalid_response:
    'The provider returned an incomplete or unsupported response. Try again or test another model.',
  test_required: 'Test this exact model selection successfully before saving.',
  key_unreadable:
    'The saved API key cannot be decrypted. Restore the matching server encryption key or replace this account’s API key.',
  invalid_settings: 'Check the provider, API key and selected models, then try again.',
} as const;
export class AiError extends Error {
  readonly code: keyof typeof messages;
  readonly status: number;
  constructor(code: keyof typeof messages) {
    super(messages[code]);
    this.name = 'AiError';
    this.code = code;
    this.status =
      code === 'not_configured'
        ? 501
        : ['changed', 'draft_expired'].includes(code)
          ? 409
          : code === 'quota'
            ? 429
            : code === 'timeout'
              ? 504
              : ['invalid_settings', 'test_required'].includes(code)
                ? 400
                : 502;
  }
}
