import { afterEach, describe, expect, it } from 'vitest';
import { getOuraRedirectUri } from './oauth-origin';

const savedAppUrl = process.env.APP_URL;

afterEach(() => {
  if (savedAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = savedAppUrl;
});

describe('getOuraRedirectUri', () => {
  it('uses APP_URL instead of a reverse proxy internal request origin', () => {
    process.env.APP_URL = 'https://omnihealthtracker.com';
    expect(getOuraRedirectUri()).toBe(
      'https://omnihealthtracker.com/api/oura/callback',
    );
  });

  it('normalizes an APP_URL path to its origin', () => {
    process.env.APP_URL = 'https://health.example.com/base/path';
    expect(getOuraRedirectUri()).toBe(
      'https://health.example.com/api/oura/callback',
    );
  });

  it('fails closed when APP_URL is absent or not HTTP', () => {
    delete process.env.APP_URL;
    expect(() => getOuraRedirectUri()).toThrow('APP_URL is required');
    process.env.APP_URL = 'ftp://health.example.com';
    expect(() => getOuraRedirectUri()).toThrow('http or https');
  });
});