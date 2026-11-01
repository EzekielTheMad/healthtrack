// @vitest-environment node
import { expect, it } from 'vitest';
import { hasScope } from '@/lib/api-auth';
it('never broadens historical wildcard/read/device tokens to HF writes', () => {
  for (const scopes of [['write:all'], ['read:all'], ['write:health_connect'], ['write:vitals']]) {
    const ctx = { userId: 'fictional', keyId: 'fixture', scopes };
    expect(hasScope(ctx, 'write:clinical_intake')).toBe(false);
    expect(hasScope(ctx, 'write:scans')).toBe(false);
  }
  expect(
    hasScope(
      { userId: 'fictional', keyId: 'fixture', scopes: ['write:clinical_intake'] },
      'write:clinical_intake'
    )
  ).toBe(true);
  expect(
    hasScope({ userId: 'fictional', keyId: 'fixture', scopes: ['write:all'] }, 'write:vitals')
  ).toBe(true);
});
