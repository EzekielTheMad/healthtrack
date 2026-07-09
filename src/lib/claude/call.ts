import Anthropic from '@anthropic-ai/sdk';
import { FALLBACK_MODEL } from './model';

/**
 * Graceful model-fallback wrapper around `client.messages.create`.
 *
 * Anthropic retires dated model snapshots periodically, and an operator can
 * point ANTHROPIC_MODEL / ANTHROPIC_MODEL_EXTRACTION at an ID that no longer
 * exists. A retired or unknown model returns 404 (`Anthropic.NotFoundError`).
 * Rather than hard-fail every AI feature until the env is fixed, we retry once
 * on FALLBACK_MODEL (a hardcoded known-good current model) and warn loudly so
 * the misconfiguration shows up in logs.
 *
 * Any other error (rate limit, auth, overload, network, ...) is rethrown — the
 * routes handle those as soft failures.
 */
export async function createMessage(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Messages.Message> {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (
      err instanceof Anthropic.NotFoundError &&
      params.model !== FALLBACK_MODEL
    ) {
      console.warn(
        `[claude] model "${params.model}" is unavailable (404). Check the ANTHROPIC_MODEL / ANTHROPIC_MODEL_EXTRACTION env var. Falling back to "${FALLBACK_MODEL}".`,
      );
      return await client.messages.create({ ...params, model: FALLBACK_MODEL });
    }
    throw err;
  }
}
