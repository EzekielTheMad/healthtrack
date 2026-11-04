// Execute an immutable release artifact before its digest can reach named tags.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readMigrationByteManifest } from './prepare-migration-artifacts.mjs';

const execute = promisify(execFile);
const label = 'org.healthtrack.release-verifier';
const requireCheck = (value, message) => { if (!value) throw new Error(message); };

export function dockerRunner(signal) {
  return async (args, timeout = 30000) => {
    try {
      const result = await execute('docker', args, {
        timeout, signal, windowsHide: true, maxBuffer: 1024 * 1024,
      });
      return result.stdout.trim();
    } catch (cause) {
      // Do not reflect Docker output, container logs, environment or credentials.
      const error = new Error(String(cause.stderr).includes('UNAUTHENTICATED_SUCCESS')
        ? 'UNAUTHENTICATED_SUCCESS' : `Docker ${args[0]} operation failed`);
      error.missing = /No such (?:container|volume|object)\b/i.test(String(cause.stderr));
      throw error;
    }
  };
}

function validate({ revision, platform, pins }) {
  requireCheck(/^[a-f0-9]{40}$/.test(revision), 'Expected an exact source revision');
  requireCheck(['linux/amd64', 'linux/arm64'].includes(platform), 'Unsupported platform');
  requireCheck(Array.isArray(pins) && pins.length > 1, 'Missing migration pins');
  requireCheck(new Set(pins.map(p => p.path)).size === pins.length &&
    pins.some(p => p.path === 'meta/_journal.json') && pins.every(p =>
      /^(?:[a-zA-Z0-9_-]+\.sql|meta\/_journal\.json)$/.test(p.path) &&
      /^[a-f0-9]{64}$/.test(p.runtime_sha256)), 'Invalid migration pins');
}

// Self-contained: serialized into the container, never installed in the image.
export async function runtimeProbe(spec) {
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire('/app/server.js');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const check = (value, message) => { if (!value) throw new Error(message); };
  const arch = spec.platform === 'linux/amd64' ? 'x64' : 'arm64';
  check(process.arch === arch && process.env.BUILD_REVISION === spec.revision,
    'Runtime source or architecture mismatch');
  for (const pin of spec.pins)
    check(hash(fs.readFileSync('/app/drizzle/' + pin.path)) === pin.runtime_sha256,
      'Runtime migration checksum mismatch');
  const journal = JSON.parse(fs.readFileSync('/app/drizzle/meta/_journal.json', 'utf8'));
  const deadline = Date.now() + 45000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3000/api/health', {
        signal: AbortSignal.timeout(2000), redirect: 'error',
      });
      if (response.status === 200 && (await response.json()).status === 'ok') {
        healthy = true;
        break;
      }
    } catch { /* Startup is bounded by the deadline and the outer exec timeout. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check(healthy, 'Image did not become healthy');
  for (const endpoint of ['/api/medications', '/api/v1/context?days=30']) {
    const response = await fetch('http://127.0.0.1:3000' + endpoint, {
      signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    check(response.status === 401, response.status === 200
      ? 'UNAUTHENTICATED_SUCCESS' : 'Protected endpoint did not return401');
  }
  const Database = require('better-sqlite3');
  const database = new Database('/data/healthtrack.db', { readonly: true });
  try {
    const ledger = database.prepare('select id,hash,created_at from __drizzle_migrations order by id').all();
    check(ledger.length === journal.entries.length, 'Migration ledger length mismatch');
    for (const [i, entry] of journal.entries.entries()) {
      const pin = spec.pins.find(p => p.path === entry.tag + '.sql');
      check(pin && ledger[i].hash === pin.runtime_sha256 && ledger[i].created_at === entry.when,
        'Migration ledger does not match pinned runtime');
    }
    for (const table of ['user', 'session', 'api_keys'])
      check(database.prepare(`select count(*) as n from ${table}`).get().n === 0,
        'Fixture contains accounts, sessions or API keys');
    check(database.pragma('integrity_check', { simple: true }) === 'ok', 'SQLite integrity failed');
    return { revision: spec.revision, architecture: process.arch,
      migrationFiles: spec.pins.length, ledgerRows: ledger.length,
      ledgerDigest: hash(JSON.stringify(ledger)), accounts: 0, sessions: 0, apiKeys: 0,
      protectedStatuses: [401, 401], integrity: 'ok' };
  } finally { database.close(); }
}

async function inspectLabels(run, type, name) {
  const format = type === 'container' ? '{{json .Config.Labels}}' : '{{json .Labels}}';
  try { return JSON.parse(await run([type, 'inspect', '--format', format, name])) ?? {}; }
  catch (error) { if (error.missing) return null; throw error; }
}

// Also used for the explicit local-image fixture proof; it never pulls or tags.
export async function smokeImage(spec, {
  run = dockerRunner(), cleanupRun = run, report = console.log,
} = {}) {
  validate(spec);
  requireCheck(/^sha256:[a-f0-9]{64}$/.test(spec.imageId), 'Expected an immutable local image ID');
  const instance = randomUUID();
  const name = `ht-release-smoke-${instance}`;
  const volume = `${name}-data`;
  requireCheck(await inspectLabels(run, 'container', name) === null &&
    await inspectLabels(run, 'volume', volume) === null, 'Fixture name already exists');
  report(JSON.stringify({ fixture: name, volume, imageId: spec.imageId,
    startedAt: new Date().toISOString(), ports: [], network: 'none' }));
  const removeOwned = async (type, target) => {
    const labels = await inspectLabels(cleanupRun, type, target);
    if (labels === null) return;
    requireCheck(labels?.[label] === instance, 'Refusing cleanup of an unowned resource');
    await cleanupRun(type === 'container'
      ? ['container', 'rm', '--force', '--volumes', target] : ['volume', 'rm', target]);
    requireCheck(await inspectLabels(cleanupRun, type, target) === null, 'Fixture cleanup incomplete');
  };
  let result;
  try {
    await run(['volume', 'create', '--label', `${label}=${instance}`, volume]);
    await run(['container', 'create', '--name', name, '--label', `${label}=${instance}`,
      '--network', 'none', '--restart', 'no', '--memory', '1g', '--cpus', '1',
      '--pids-limit', '256', '--mount', `type=volume,source=${volume},target=/data`,
      '--env', 'APP_URL=http://127.0.0.1:3000', '--env', 'OURA_SYNC_ENABLED=false',
      '--env', 'TZ=UTC', spec.imageId]);
    await run(['container', 'start', name]);
    const host = JSON.parse(await run(['container', 'inspect', '--format', '{{json .HostConfig}}', name]));
    requireCheck(host.NetworkMode === 'none' && !Object.keys(host.PortBindings ?? {}).length &&
      host.Memory === 1073741824 && host.NanoCpus === 1000000000,
    'Fixture isolation or resource limits mismatch');
    const probe = async () => {
      const code = `(${runtimeProbe.toString()})(JSON.parse(process.argv[1])).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;})`;
      const output = JSON.parse(await run(['exec', name, 'node', '-e', code,
        JSON.stringify({ revision: spec.revision, platform: spec.platform, pins: spec.pins })], 60000));
      requireCheck(output.revision === spec.revision &&
        output.architecture === (spec.platform === 'linux/amd64' ? 'x64' : 'arm64') &&
        output.migrationFiles === spec.pins.length && output.ledgerRows === spec.pins.length - 1 &&
        /^[a-f0-9]{64}$/.test(output.ledgerDigest) && output.accounts === 0 &&
        output.sessions === 0 && output.apiKeys === 0 && output.integrity === 'ok' &&
        JSON.stringify(output.protectedStatuses) === '[401,401]', 'Invalid runtime verification result');
      return output;
    };
    const first = await probe();
    await run(['container', 'restart', '--time', '10', name]);
    const restarted = await probe();
    requireCheck(first.ledgerDigest === restarted.ledgerDigest, 'Ledger changed across restart');
    result = { imageId: spec.imageId, fixture: name, volume, ...restarted };
  } finally {
    const errors = [];
    for (const [type, target] of [['container', name], ['volume', volume]]) {
      try { await removeOwned(type, target); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new Error('Fixture cleanup failed; inspect the recorded owned names');
  }
  return { ...result, cleanup: 'complete' };
}

export async function verifyReleaseImage(spec, options = {}) {
  validate(spec);
  requireCheck(/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(spec.image),
    'Expected an immutable GHCR digest reference');
  const run = options.run ?? dockerRunner();
  await run(['pull', '--platform', spec.platform, spec.image], 120000);
  const images = JSON.parse(await run(['image', 'inspect', spec.image]));
  const image = images[0];
  requireCheck(images.length === 1 && image?.RepoDigests?.includes(spec.image), 'Pulled digest mismatch');
  requireCheck(image.Os === 'linux' && `linux/${image.Architecture}` === spec.platform,
    'Image platform mismatch');
  requireCheck(image.Config?.Env?.includes(`BUILD_REVISION=${spec.revision}`) &&
    image.Config?.Labels?.['org.opencontainers.image.revision'] === spec.revision,
    'Image source revision mismatch');
  const result = await smokeImage({ ...spec, imageId: image.Id }, { ...options, run });
  return { digest: spec.image, ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  // Leave two minutes for independent cleanup within the eight-minute step.
  const deadline = setTimeout(stop, 300000);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const [image, revision, platform, ...extra] = process.argv.slice(2);
  try {
    requireCheck(!extra.length, 'Usage: verify-release-image.mjs IMAGE@DIGEST REVISION PLATFORM');
    const result = await verifyReleaseImage({ image, revision, platform,
      pins: readMigrationByteManifest().entries }, {
      run: dockerRunner(abort.signal), cleanupRun: dockerRunner(),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
