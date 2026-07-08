import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';

/**
 * Generate a new personal access token.
 * Format: ohts_pat_<48 random chars>
 * Returns the plaintext token (shown once) and the prefix for display.
 */
export function generateApiKey(): { token: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(36).toString('base64url'); // ~48 chars
  const token = `ohts_pat_${random}`;
  const prefix = token.slice(0, 16); // "ohts_pat_<first 7>"
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, prefix, hash };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface ApiKeyContext {
  userId: string;
  scopes: string[];
  keyId: string;
}

/**
 * Validates an API token from the Authorization header.
 * Returns the user_id and scopes if valid, null otherwise.
 * Updates last_used_at as a side effect.
 */
export async function validateApiKey(authHeader: string | null): Promise<ApiKeyContext | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token.startsWith('ohts_pat_')) return null;

  const tokenHash = hashToken(token);

  // token_hash is UNIQUE — hashing is unchanged (sha256 hex of the full
  // token), so existing tokens keep working after import.
  const rows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tokenHash, tokenHash))
    .limit(1);

  const data = rows[0];
  if (!data) return null;
  if (data.revokedAt) return null;
  if (data.expiresAt && new Date(data.expiresAt) < new Date()) return null;

  // Update last_used_at (side effect; synchronous with better-sqlite3)
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, data.id));

  return {
    userId: data.userId,
    scopes: data.scopes,
    keyId: data.id,
  };
}

/**
 * Check whether a context has a given scope.
 * `read:all` and `write:all` grant all read/write respectively.
 */
export function hasScope(ctx: ApiKeyContext, required: string): boolean {
  if (ctx.scopes.includes(required)) return true;
  if (required.startsWith('read:') && ctx.scopes.includes('read:all')) return true;
  if (required.startsWith('write:') && ctx.scopes.includes('write:all')) return true;
  return false;
}

/**
 * Available scopes for the API — defined in the client-safe module
 * src/lib/api-scopes.ts and re-exported here for server callers.
 */
export { AVAILABLE_SCOPES, type ScopeValue } from './api-scopes';

/**
 * Standard JSON response for API errors.
 */
export function apiError(message: string, status: number = 400) {
  return Response.json({ error: message }, { status });
}

/**
 * Standard 401 unauthorized response.
 */
export function unauthorized(message: string = 'Invalid or missing API key') {
  return Response.json({ error: message }, { status: 401 });
}

/**
 * Standard 403 forbidden response.
 */
export function forbidden(scope: string) {
  return Response.json(
    { error: `Insufficient permissions. Required scope: ${scope}` },
    { status: 403 }
  );
}
