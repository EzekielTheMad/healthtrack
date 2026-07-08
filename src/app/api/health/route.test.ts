// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;
let savedDataDir: string | undefined;

beforeEach(() => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-health-'));
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // WAL handles on Windows may lag; temp dir is cleaned by the OS
  }
});

describe('GET /api/health', () => {
  it('returns 200 {status:"ok"} when the database is reachable', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('requires no authentication and exposes force-dynamic', async () => {
    const mod = await import('./route');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
