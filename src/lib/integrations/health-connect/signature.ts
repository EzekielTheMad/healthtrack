/**
 * Raw-body HMAC verification for the Health Connect webhook.
 *
 * The Life Dashboard companion computes (WebhookSupport.kt, pinned commit):
 *   X-Signature: sha256=<lowercase hex of HMAC-SHA256(secret_utf8, raw_body_utf8)>
 *
 * The signature covers the EXACT bytes the phone sent. Re-serializing parsed
 * JSON changes key order, number formatting and whitespace, so the body must
 * be read as text and hashed BEFORE any JSON parsing (PRD §6.2 step 1).
 */
import crypto from 'crypto';

export const SIGNATURE_HEADER = 'X-Signature';
const PREFIX = 'sha256=';

/** Generate a 32-byte hex HMAC secret for a new (or rotated) integration. */
export function generateHmacSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** The header value the phone is expected to send for this exact body. */
export function computeSignature(rawBody: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  hmac.update(Buffer.from(rawBody, 'utf8'));
  return PREFIX + hmac.digest('hex');
}

/** sha256 hex of the raw body — the payload-level retry key. */
export function bodyDigest(rawBody: string): string {
  return crypto.createHash('sha256').update(Buffer.from(rawBody, 'utf8')).digest('hex');
}

/**
 * Constant-time comparison of a presented signature against the expected one.
 * Lengths are checked first because timingSafeEqual throws on a length
 * mismatch — and a length difference is not secret information anyway.
 */
export function verifySignature(
  rawBody: string,
  secret: string,
  presented: string | null | undefined,
): boolean {
  if (!presented) return false;
  const expected = computeSignature(rawBody, secret);
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Whether an unsigned delivery may be accepted. Production ALWAYS requires a
 * signature (PRD §9). Outside production it can be waived with
 * HEALTH_CONNECT_ALLOW_UNSIGNED=true for local curl testing — a PRESENT
 * signature is still verified in every environment.
 */
export function allowsUnsigned(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.HEALTH_CONNECT_ALLOW_UNSIGNED === 'true';
}
