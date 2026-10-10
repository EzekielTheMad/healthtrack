/** Trusted generation boundary, separate from the medication-interaction version. */
export const OWNER_AI_CONTEXT_VERSION = 1;

export interface OwnerAiContext {
  ownerId: string;
  dependentId: null;
  contextVersion: number;
}

export function makeOwnerAiContext(ownerId: string): OwnerAiContext {
  return { ownerId, dependentId: null, contextVersion: OWNER_AI_CONTEXT_VERSION };
}

export const OWNER_AI_ONLY_MESSAGE =
  'AI summaries and chat are available only for My Health, the signed-in account owner.';

/**
 * These features do not implement dependent/delegate context. Missing selectors
 * retain the original self-only API contract; explicit selectors must agree.
 * Check URL and JSON independently, including aliases and repeated parameters,
 * so an unsupported request never silently generates an answer for the owner.
 * Context/version are server-authored output, never caller-selected inputs.
 */
export function supportsOwnerAiContext(
  ownerId: string,
  params: URLSearchParams,
  body?: Record<string, unknown>
): boolean {
  const supported: Record<string, (value: unknown) => boolean> = {
    owner_id: (value) => value === ownerId,
    ownerId: (value) => value === ownerId,
    user_id: (value) => value === ownerId,
    userId: (value) => value === ownerId,
    dependent_id: (value) => value === null || value === 'self',
    dependentId: (value) => value === null || value === 'self',
  };
  const unsupported = [
    'delegate_id',
    'delegateId',
    'delegate_owner_id',
    'delegateOwnerId',
    'profile_id',
    'profileId',
    'activeProfile',
    'profile',
    'scope',
    'context',
    'context_version',
    'contextVersion',
  ];
  for (const [key, accepts] of Object.entries(supported)) {
    const values = params.getAll(key);
    if (values.length > 1 || (values.length === 1 && !accepts(values[0]))) return false;
    if (body && Object.hasOwn(body, key) && !accepts(body[key])) return false;
  }
  return !unsupported.some((key) => params.has(key) || (body && Object.hasOwn(body, key)));
}
