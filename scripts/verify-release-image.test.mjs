// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { verifyReleaseImage } from './verify-release-image.mjs';
import { readMigrationByteManifest } from './prepare-migration-artifacts.mjs';

const revision = 'a'.repeat(40);
const image = `ghcr.io/example/healthtrack@sha256:${'b'.repeat(64)}`;
const imageId = `sha256:${'c'.repeat(64)}`;
const spec = { image, revision, platform: 'linux/amd64', pins: readMigrationByteManifest().entries };
const label = 'org.healthtrack.release-verifier';
const missing = () => Object.assign(new Error('missing'), { missing: true });

function fixture(options = {}) {
  const calls = [];
  let volume, container, probes = 0;
  const good = { revision, architecture: 'x64', migrationFiles: 20, ledgerRows: 19,
    ledgerDigest: 'd'.repeat(64), accounts: 0, sessions: 0, apiKeys: 0,
    protectedStatuses: [401, 401], integrity: 'ok' };
  const run = async args => {
    calls.push(args);
    const [type, action] = args;
    if (type === 'pull') return image;
    if (type === 'image') return JSON.stringify([{ Id: imageId, Os: 'linux', Architecture: 'amd64',
      RepoDigests: [image], Config: { Env: [`BUILD_REVISION=${revision}`],
        Labels: { 'org.opencontainers.image.revision': revision } }, ...options.image }]);
    if (type === 'volume' && action === 'create') {
      volume = { [label]: args[3].split('=')[1] };
      return args.at(-1);
    }
    if (type === 'container' && action === 'create') {
      container = { [label]: args[5].split('=')[1] };
      if (options.createResponseLost) throw new Error('create response lost');
      return 'fictional-container-id';
    }
    if (action === 'inspect') {
      const value = type === 'volume' ? volume : container;
      if (!value) throw missing();
      if (args.includes('{{json .HostConfig}}')) return JSON.stringify({ NetworkMode: 'none',
        PortBindings: {}, Memory: 1073741824, NanoCpus: 1000000000, ...options.host });
      return JSON.stringify(options.foreignAfterProbe && probes ? {} : value);
    }
    if (type === 'exec') {
      probes++;
      if (options.probeFails) throw new Error('probe failed');
      return JSON.stringify({ ...good, ...options.probe,
        ...(options.ledgerChanges && probes === 2 ? { ledgerDigest: 'e'.repeat(64) } : {}) });
    }
    if (action === 'rm') {
      if (options.cleanupFails && type === 'container') throw new Error('cleanup failed');
      if (type === 'container') container = null;
      else volume = null;
      return 'removed';
    }
    if (type === 'container' && ['start', 'restart'].includes(action)) return 'started';
    throw new Error('Unexpected command');
  };
  return { calls, run, report: () => {}, resources: () => ({ container, volume }) };
}

describe('immutable release artifact gate', () => {
  it('pulls the exact platform digest, executes its image ID twice and removes only its fixture', async () => {
    const f = fixture();
    const result = await verifyReleaseImage(spec, f);
    expect(result.cleanup).toBe('complete');
    expect(result.digest).toBe(image);
    expect(f.calls[0]).toEqual(['pull', '--platform', 'linux/amd64', image]);
    const create = f.calls.find(a => a[0] === 'container' && a[1] === 'create');
    expect(create.at(-1)).toBe(imageId);
    expect(create).toEqual(expect.arrayContaining(['--network', 'none', '--memory', '1g', '--cpus', '1']));
    expect(create).not.toContain('-p');
    expect(f.calls.filter(a => a[0] === 'exec')).toHaveLength(2);
    expect(f.calls.some(a => a[1] === 'restart')).toBe(true);
    expect(f.resources()).toEqual({ container: null, volume: null });
  });

  it.each([
    { image: 'ghcr.io/example/healthtrack:latest' },
    { revision: 'main' },
    { platform: 'linux/386' },
    { pins: [{ path: '../unsafe.sql', runtime_sha256: 'a'.repeat(64) }] },
  ])('rejects unbound input before any Docker operation: %j', async change => {
    const f = fixture();
    await expect(verifyReleaseImage({ ...spec, ...change }, f)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    { RepoDigests: [`ghcr.io/example/healthtrack@sha256:${'f'.repeat(64)}`] },
    { Architecture: 'arm64' },
    { Config: { Env: [`BUILD_REVISION=${'f'.repeat(40)}`], Labels: {} } },
  ])('rejects a mismatched pulled artifact before creating a fixture: %j', async metadata => {
    const f = fixture({ image: metadata });
    await expect(verifyReleaseImage(spec, f)).rejects.toThrow();
    expect(f.calls.some(a => a[1] === 'create')).toBe(false);
  });

  it('fails on changed persisted ledger and still removes both owned resources', async () => {
    const f = fixture({ ledgerChanges: true });
    await expect(verifyReleaseImage(spec, f)).rejects.toThrow('Ledger changed');
    expect(f.resources()).toEqual({ container: null, volume: null });
  });

  it('rejects anonymous success instead of accepting a plausible probe payload', async () => {
    const f = fixture({ probe: { protectedStatuses: [200, 401] } });
    await expect(verifyReleaseImage(spec, f)).rejects.toThrow('Invalid runtime');
    expect(f.resources()).toEqual({ container: null, volume: null });
  });

  it('rejects accidental network exposure and cleans up before probing', async () => {
    const f = fixture({ host: { NetworkMode: 'bridge' } });
    await expect(verifyReleaseImage(spec, f)).rejects.toThrow('isolation');
    expect(f.calls.some(a => a[0] === 'exec')).toBe(false);
    expect(f.resources()).toEqual({ container: null, volume: null });
  });

  it('cleans up after an uncertain create response by checking ownership', async () => {
    const f = fixture({ createResponseLost: true });
    await expect(verifyReleaseImage(spec, f)).rejects.toThrow('create response lost');
    expect(f.resources()).toEqual({ container: null, volume: null });
  });

  it('cleans up failed probes but refuses deletion when ownership differs', async () => {
    const failed = fixture({ probeFails: true });
    await expect(verifyReleaseImage(spec, failed)).rejects.toThrow('probe failed');
    expect(failed.resources()).toEqual({ container: null, volume: null });
    const foreign = fixture({ foreignAfterProbe: true });
    await expect(verifyReleaseImage(spec, foreign)).rejects.toThrow('cleanup failed');
    expect(foreign.calls.some(a => a[1] === 'rm')).toBe(false);
  });

  it('fails the gate when cleanup fails', async () => {
    const f = fixture({ cleanupFails: true });
    await expect(verifyReleaseImage(spec, f)).rejects.toThrow('cleanup failed');
  });

  it('keeps native verification before digest handoff and named-manifest promotion', () => {
    const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    expect(workflow.indexOf('Verify immutable image on native runner')).toBeLessThan(workflow.indexOf('name: Export digest'));
    expect(workflow).toContain('RELEASE_IMAGE: ${{ env.IMAGE }}@${{ steps.build.outputs.digest }}');
    expect(workflow).toContain('needs: build');
    expect(workflow).toContain('runner: ubuntu-24.04-arm');
    expect(workflow).toContain('latest=true');
  });
});
