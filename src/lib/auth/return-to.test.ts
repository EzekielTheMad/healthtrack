import { describe, it, expect } from 'vitest';
import { safeReturnTo } from './return-to';
describe('login return destinations', () => {
  it.each([
    '/mobile/pair?request_id=public-id',
    '/mobile/browser?path=%2Flabs&dependent_id=child&account_id=originating-account',
    '/settings?tab=integrations#health-connect',
  ])('preserves an application destination %s', (value) => expect(safeReturnTo(value)).toBe(value));
  it.each([
    'https://evil.invalid',
    '//evil.invalid',
    '/\\evil.invalid',
    '/%5cevil.invalid',
    '/api/account/delete',
    '/login?returnTo=/login',
    '/mobile/%2e%2e/api/auth/sign-out',
    '/mobile?x=%0aevil',
    '/unknown',
    null,
  ])('rejects external, unsafe, auth or non-app destination %s', (value) =>
    expect(safeReturnTo(value)).toBe('/dashboard')
  );
});
