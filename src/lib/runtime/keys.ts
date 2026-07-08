/**
 * Secret management.
 *
 * Secrets are sourced in priority order:
 *   1. Environment variable (AUTH_SECRET / ENCRYPTION_KEY) — always wins.
 *   2. Existing file at KEYS_DIR/<name>.
 *   3. Freshly generated 32 random bytes (hex), persisted to KEYS_DIR/<name>
 *      with mode 0600 (best effort on Windows).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ensureDataDirs, getKeysDir } from './paths';

const ENV_OVERRIDES = {
  auth_secret: 'AUTH_SECRET',
  encryption_key: 'ENCRYPTION_KEY',
} as const;

export type SecretName = keyof typeof ENV_OVERRIDES;

export function getOrCreateSecret(name: SecretName): string {
  const fromEnv = process.env[ENV_OVERRIDES[name]];
  if (fromEnv) return fromEnv;

  ensureDataDirs();
  const file = path.join(getKeysDir(), name);

  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}
