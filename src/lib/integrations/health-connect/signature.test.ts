// @vitest-environment node
/**
 * HMAC verification. The load-bearing property is that the signature covers
 * the EXACT raw bytes: re-serialized JSON (different key order or spacing)
 * must NOT verify, which is what forces the route to hash before parsing.
 */
import crypto from 'crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  allowsUnsigned,
  bodyDigest,
  computeSignature,
  generateHmacSecret,
  verifySignature,
} from './signature';

const SECRET = 'a'.repeat(64);
const BODY = '{"timestamp":"2026-09-01T16:00:00Z","source":"health_connect","app_version":"1.8.0"}';

describe('computeSignature', () => {
  it('matches the companion app formula (sha256=<lowercase hex>)', () => {
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(BODY, 'utf8').digest('hex');
    expect(computeSignature(BODY, SECRET)).toBe(expected);
    expect(computeSignature(BODY, SECRET)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(BODY, SECRET, computeSignature(BODY, SECRET))).toBe(true);
  });

  it('rejects a missing signature', () => {
    expect(verifySignature(BODY, SECRET, null)).toBe(false);
    expect(verifySignature(BODY, SECRET, undefined)).toBe(false);
    expect(verifySignature(BODY, SECRET, '')).toBe(false);
  });

  it('rejects a malformed signature (no prefix, wrong length, junk)', () => {
    const valid = computeSignature(BODY, SECRET);
    expect(verifySignature(BODY, SECRET, valid.slice('sha256='.length))).toBe(false);
    expect(verifySignature(BODY, SECRET, valid + 'ff')).toBe(false);
    expect(verifySignature(BODY, SECRET, 'sha256=zzzz')).toBe(false);
    expect(verifySignature(BODY, SECRET, 'garbage')).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifySignature(BODY, SECRET, computeSignature(BODY, 'b'.repeat(64)))).toBe(false);
  });

  it('rejects a signature over RESERIALIZED json — the raw bytes are the message', () => {
    // Bytes as a client might actually send them: different key order and
    // spacing from what JSON.stringify would produce for the same value.
    const rawBytes = '{ "source":"health_connect" ,  "timestamp":"2026-09-01T16:00:00Z" }';
    const reserialized = JSON.stringify(JSON.parse(rawBytes));
    expect(reserialized).not.toBe(rawBytes);
    expect(verifySignature(rawBytes, SECRET, computeSignature(reserialized, SECRET))).toBe(false);
    // …and the phone's signature over the real bytes does verify.
    expect(verifySignature(rawBytes, SECRET, computeSignature(rawBytes, SECRET))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = computeSignature(BODY, SECRET);
    expect(verifySignature(BODY.replace('1.8.0', '1.8.1'), SECRET, signature)).toBe(false);
  });

  it('handles multi-byte bodies as UTF-8', () => {
    const body = '{"note":"café 🥑"}';
    expect(verifySignature(body, SECRET, computeSignature(body, SECRET))).toBe(true);
  });
});

describe('generateHmacSecret', () => {
  it('produces a distinct 64-hex-character secret each time', () => {
    const a = generateHmacSecret();
    const b = generateHmacSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('bodyDigest', () => {
  it('is the sha256 hex of the raw bytes', () => {
    expect(bodyDigest(BODY)).toBe(crypto.createHash('sha256').update(BODY, 'utf8').digest('hex'));
  });
});

describe('allowsUnsigned', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is never allowed in production, even with the flag set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HEALTH_CONNECT_ALLOW_UNSIGNED', 'true');
    expect(allowsUnsigned()).toBe(false);
  });

  it('requires an explicit opt-in outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HEALTH_CONNECT_ALLOW_UNSIGNED', '');
    expect(allowsUnsigned()).toBe(false);
    vi.stubEnv('HEALTH_CONNECT_ALLOW_UNSIGNED', 'true');
    expect(allowsUnsigned()).toBe(true);
  });
});
