// @vitest-environment node
import { afterEach, describe, it, expect, vi } from 'vitest';
import { GET } from './route';
afterEach(() => vi.unstubAllEnvs());
describe('Digital Asset Links', () => {
  it('requires an actual configured certificate identity', async () => {
    vi.stubEnv('ANDROID_CERT_SHA256', '');
    expect(GET().status).toBe(404);
  });
  it('publishes only exact valid package and certificate identities', async () => {
    const cert = Array(32).fill('AB').join(':');
    vi.stubEnv('ANDROID_CERT_SHA256', `${cert},${cert}`);
    vi.stubEnv('ANDROID_APP_PACKAGE', 'com.omnihealthtracker.app');
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.omnihealthtracker.app',
          sha256_cert_fingerprints: [cert],
        },
      },
    ]);
  });
  it.each(['AB:CD', 'invalid', 'AB,'.repeat(32)])('rejects a malformed fingerprint %s', (cert) => {
    vi.stubEnv('ANDROID_CERT_SHA256', cert);
    expect(GET().status).toBe(404);
  });
});
