/**
 * Claude model configuration, split by task type.
 *
 * There are two kinds of AI work in this app:
 *   - **Reasoning** — health summaries, natural-language queries, and
 *     medication interaction checks. These benefit from a more capable model.
 *   - **Extraction** — parsing lab and vaccine PDFs into structured JSON. This
 *     is mechanical transcription, so a cheaper/faster model is usually fine.
 *
 * Operators override either independently via env vars:
 *   - ANTHROPIC_MODEL            → reasoning model. Set to `claude-opus-4-8`
 *     for maximum-intelligence reasoning.
 *   - ANTHROPIC_MODEL_EXTRACTION → extraction model. Set to a cheaper model
 *     such as `claude-haiku-4-5` for PDF parsing.
 *
 * These are functions (not module-load constants) so the env is read at call
 * time — a container restart with new env is enough to switch models, and
 * tests can set process.env per-case.
 *
 * Anthropic retires dated model snapshots periodically (the previous hardcoded
 * `claude-sonnet-4-20250514` reached end-of-life and began returning 404), so
 * pin a specific snapshot here only if you have a reason to.
 */

/** Reasoning model — health summary, query, interaction checks. */
export function reasoningModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5';
}

/** Extraction model — lab + vaccine PDF parsing (mechanical extraction). */
export function extractionModel(): string {
  return process.env.ANTHROPIC_MODEL_EXTRACTION?.trim() || 'claude-sonnet-5';
}

/**
 * Hardcoded known-good current model. Used only by the fallback wrapper
 * (src/lib/claude/call.ts) when the configured model is unavailable — e.g. an
 * operator set ANTHROPIC_MODEL to a retired ID that now returns 404.
 */
export const FALLBACK_MODEL = 'claude-sonnet-5';
