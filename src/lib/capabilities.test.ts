// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCapabilities } from './capabilities';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'OURA_CLIENT_ID',
  'OURA_CLIENT_SECRET',
  'SIGNUPS_ENABLED',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('getCapabilities', () => {
  it('everything optional is off with a bare env; signups default invite-only (not open)', () => {
    expect(getCapabilities()).toEqual({
      ai: false,
      googleAuth: false,
      oura: false,
      signupsEnabled: false,
    });
  });

  it('ai flips on with ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(getCapabilities().ai).toBe(true);
  });

  it('googleAuth requires BOTH client id and secret', () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    expect(getCapabilities().googleAuth).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    expect(getCapabilities().googleAuth).toBe(true);
  });

  it('oura requires BOTH client id and secret', () => {
    process.env.OURA_CLIENT_SECRET = 'secret';
    expect(getCapabilities().oura).toBe(false);
    process.env.OURA_CLIENT_ID = 'id';
    expect(getCapabilities().oura).toBe(true);
  });

  it("signupsEnabled (open registration) is true only for the literal 'true'", () => {
    process.env.SIGNUPS_ENABLED = 'false';
    expect(getCapabilities().signupsEnabled).toBe(false);
    process.env.SIGNUPS_ENABLED = 'true';
    expect(getCapabilities().signupsEnabled).toBe(true);
    // Anything else (unset, '0', '1') is the invite-only default — not open.
    process.env.SIGNUPS_ENABLED = '0';
    expect(getCapabilities().signupsEnabled).toBe(false);
  });

  it('reads env at call time (no snapshot)', () => {
    expect(getCapabilities().ai).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(getCapabilities().ai).toBe(true);
  });
});
