// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;
const savedEnv: Record<string, string | undefined> = {};

async function importKeys() {
  vi.resetModules();
  return import('./keys');
}

beforeEach(() => {
  savedEnv.DATA_DIR = process.env.DATA_DIR;
  savedEnv.AUTH_SECRET = process.env.AUTH_SECRET;
  savedEnv.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-keys-'));
  process.env.DATA_DIR = tmpDir;
  delete process.env.AUTH_SECRET;
  delete process.env.ENCRYPTION_KEY;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getOrCreateSecret', () => {
  it('generates a 64-char hex secret and persists it to KEYS_DIR', async () => {
    const { getOrCreateSecret } = await importKeys();
    const secret = getOrCreateSecret('auth_secret');
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = fs.readFileSync(path.join(tmpDir, 'keys', 'auth_secret'), 'utf8').trim();
    expect(onDisk).toBe(secret);
  });

  it('is stable across calls (same value returned every time)', async () => {
    const { getOrCreateSecret } = await importKeys();
    const first = getOrCreateSecret('auth_secret');
    const second = getOrCreateSecret('auth_secret');
    expect(second).toBe(first);
  });

  it('is stable across module reloads (reads existing file)', async () => {
    const { getOrCreateSecret } = await importKeys();
    const first = getOrCreateSecret('encryption_key');
    const { getOrCreateSecret: reloaded } = await importKeys();
    expect(reloaded('encryption_key')).toBe(first);
  });

  it('env override wins over generated file', async () => {
    const { getOrCreateSecret } = await importKeys();
    const generated = getOrCreateSecret('auth_secret');
    process.env.AUTH_SECRET = 'env-provided-secret';
    const { getOrCreateSecret: reloaded } = await importKeys();
    expect(reloaded('auth_secret')).toBe('env-provided-secret');
    expect(reloaded('auth_secret')).not.toBe(generated);
  });

  it('ENCRYPTION_KEY env override applies to encryption_key only', async () => {
    process.env.ENCRYPTION_KEY = 'env-encryption-key';
    const { getOrCreateSecret } = await importKeys();
    expect(getOrCreateSecret('encryption_key')).toBe('env-encryption-key');
    expect(getOrCreateSecret('auth_secret')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different names produce independent secrets', async () => {
    const { getOrCreateSecret } = await importKeys();
    expect(getOrCreateSecret('auth_secret')).not.toBe(getOrCreateSecret('encryption_key'));
  });
});
