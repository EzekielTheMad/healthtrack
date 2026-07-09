/**
 * Model used for all Claude-powered features (summaries, queries, interaction
 * checks, PDF parsing).
 *
 * Overridable via the ANTHROPIC_MODEL env var so an operator can switch models
 * — or react to a model deprecation — without waiting for a new image. The
 * default tracks the current Sonnet generation; Anthropic retires dated model
 * snapshots periodically (the previous hardcoded `claude-sonnet-4-20250514`
 * reached end-of-life and began returning 404), so pin a specific snapshot here
 * only if you have a reason to.
 */
export const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5';
