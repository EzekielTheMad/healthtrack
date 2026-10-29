/**
 * Instance capabilities — which optional features this deployment has
 * configured. Integration flags are read from environment variables; AI readiness is supplied for the authenticated account
 * so saving AI settings needs no restart.
 *
 * Server components / route handlers call getCapabilities() directly;
 * client components use the useCapabilities() hook, which fetches
 * GET /api/capabilities (booleans only — never secrets).
 */

export interface Capabilities {
  /** Account-configured AI (summary, query, document parse, interactions). */
  ai: boolean;
  /** "Sign in with Google" button. */
  googleAuth: boolean;
  /** Oura Ring sync integration. */
  oura: boolean;
  /** New registrations are open (SIGNUPS_ENABLED !== 'false'). */
  signupsEnabled: boolean;
}

export function getCapabilities(aiConfigured = false): Capabilities {
  return {
    ai: aiConfigured,
    googleAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    oura: Boolean(process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET),
    // OPEN registration (operator opt-in). The default is invite-only — the
    // login page derives the full policy (open/invite/closed + first-user
    // bootstrap) from getSignupPolicy(), which also needs the user count.
    signupsEnabled: process.env.SIGNUPS_ENABLED === 'true',
  };
}

/** 501 body/message for AI routes called on an unconfigured instance. */
export const AI_NOT_CONFIGURED =
  'Choose and test an AI provider in Settings → AI before using this feature.';

/** 501 body/message for Oura routes called on an unconfigured instance. */
export const OURA_NOT_CONFIGURED =
  'Oura integration not configured. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET.';
