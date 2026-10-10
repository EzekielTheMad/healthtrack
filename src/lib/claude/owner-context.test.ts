// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { makeOwnerAiContext, supportsOwnerAiContext } from './owner-context';

const OWNER = 'synthetic-owner';
const check = (query = '', body?: Record<string, unknown>) =>
  supportsOwnerAiContext(OWNER, new URLSearchParams(query), body);

describe('explicit owner AI boundary', () => {
  it('defaults omitted scope to self and accepts explicit owner/self selectors', () => {
    expect(check()).toBe(true);
    expect(check('dependent_id=self&owner_id=synthetic-owner')).toBe(true);
    expect(check('', { dependent_id: null, owner_id: OWNER })).toBe(true);
    expect(check('', { dependentId: 'self', ownerId: OWNER })).toBe(true);
    expect(makeOwnerAiContext(OWNER)).toEqual({
      ownerId: OWNER,
      dependentId: null,
      contextVersion: 1,
    });
  });
  it.each(['dependent_id', 'dependentId'])('rejects every non-self %s selector type', (key) => {
    for (const value of ['', 'all', 'dependent-one', 1, false, {}, [], ['self']]) {
      expect(check('', { [key]: value })).toBe(false);
    }
    expect(check(`${key}=`)).toBe(false);
    expect(check(`${key}=self&${key}=self`)).toBe(false);
  });
  it.each(['owner_id', 'ownerId', 'user_id', 'userId'])(
    'rejects foreign and malformed %s selectors',
    (key) => {
      for (const value of ['', 'other-owner', null, [], 1])
        expect(check('', { [key]: value })).toBe(false);
    }
  );
  it.each([
    'delegate_id',
    'delegateId',
    'delegate_owner_id',
    'delegateOwnerId',
    'profile_id',
    'profileId',
    'profile',
    'activeProfile',
    'scope',
    'context',
    'context_version',
    'contextVersion',
  ])('rejects unsupported %s, including null/empty', (key) => {
    expect(check(`${key}=`)).toBe(false);
    expect(check('', { [key]: null })).toBe(false);
  });
  it('requires both body and URL selectors to agree with self', () => {
    expect(check('dependent_id=all', { dependent_id: 'self' })).toBe(false);
    expect(check('dependent_id=self', { dependent_id: 'dependent-one' })).toBe(false);
  });
});
