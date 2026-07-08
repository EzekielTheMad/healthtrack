// @vitest-environment node
/**
 * Session-freshness gate for sensitive actions (export-data). Better Auth
 * edition: freshness = session.createdAt within the 5-minute window that the
 * old last_sign_in_at check used.
 */
import { describe, it, expect } from 'vitest';
import { isRecentlyAuthenticated } from './require-recent-auth';

describe('isRecentlyAuthenticated', () => {
  it('accepts a session created within the last 5 minutes', () => {
    expect(isRecentlyAuthenticated({ createdAt: new Date() })).toBe(true);
    expect(
      isRecentlyAuthenticated({
        createdAt: new Date(Date.now() - 4 * 60 * 1000),
      }),
    ).toBe(true);
    // ISO string form works too (serialized sessions)
    expect(
      isRecentlyAuthenticated({
        createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
    ).toBe(true);
  });

  it('rejects stale or invalid createdAt values', () => {
    expect(
      isRecentlyAuthenticated({
        createdAt: new Date(Date.now() - 6 * 60 * 1000),
      }),
    ).toBe(false);
    expect(isRecentlyAuthenticated({ createdAt: 'not-a-date' })).toBe(false);
  });
});
