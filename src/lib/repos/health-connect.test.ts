// @vitest-environment node
/**
 * health_connect_* repository — integration lifecycle, encrypted secret
 * handling, exact-package approval rules, inventory, and the retention
 * choice on delete.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

type Repo = typeof import('./health-connect');
type Crypto = typeof import('@/lib/crypto/decrypt');

let ctx: RepoTestDb;
let repo: Repo;
let cryptoLib: Crypto;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-hc-repo-');
  [repo, cryptoLib] = await Promise.all([
    import('./health-connect'),
    import('@/lib/crypto/decrypt'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

function rows(sql: string, ...params: unknown[]) {
  return ctx.sqlite.prepare(sql).all(...params) as Record<string, unknown>[];
}

describe('createIntegration', () => {
  it('starts in inventory with nothing approved, and reveals the secret once', async () => {
    const { integration, secret } = await repo.createIntegration(OWNER);
    expect(integration.status).toBe('inventory');
    expect(integration.enabledTypes).toEqual([]);
    expect(integration.allowedSources).toEqual({});
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    // The view never carries the secret in any form.
    expect(JSON.stringify(integration)).not.toContain(secret);
    expect(JSON.stringify(integration)).not.toContain('hmacSecret');
  });

  it('stores the secret encrypted at rest', async () => {
    const { secret } = await repo.createIntegration(OWNER);
    const stored = String(rows('select * from health_connect_integrations')[0].hmac_secret_encrypted);
    expect(stored).not.toContain(secret);
    expect(stored.split(':')).toHaveLength(3); // iv:ciphertext:authTag
    expect(cryptoLib.decrypt(stored)).toBe(secret);
  });

  it('allows only one integration per user', async () => {
    await repo.createIntegration(OWNER);
    await expect(repo.createIntegration(OWNER)).rejects.toThrow(repo.IntegrationExistsError);
    // A different user is unaffected.
    await expect(repo.createIntegration(VIEWER)).resolves.toBeTruthy();
  });
});

describe('updateIntegration', () => {
  it('refuses to enable a package-gated type without an exact approval', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    await expect(
      repo.updateIntegration(OWNER, integration.id, { enabledTypes: ['nutrition'] }),
    ).rejects.toThrow(/requires at least one approved source package/);
  });

  it('allows daily_totals without a package (the aggregate API has no owner app)', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    const updated = await repo.updateIntegration(OWNER, integration.id, {
      enabledTypes: ['daily_totals'],
      status: 'active',
    });
    expect(updated.enabledTypes).toEqual(['daily_totals']);
    expect(updated.status).toBe('active');
  });

  it('accepts a partial approval map and rejects unknown record types', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    const updated = await repo.updateIntegration(OWNER, integration.id, {
      allowedSources: { nutrition: ['com.sbs.diet'] },
    });
    expect(updated.allowedSources).toEqual({ nutrition: ['com.sbs.diet'] });
    await expect(
      repo.updateIntegration(OWNER, integration.id, {
        allowedSources: { sleep: ['com.ouraring.oura'] },
      }),
    ).rejects.toThrow();
  });

  it('never lets a caller set the reserved error status', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    await expect(
      // @ts-expect-error — 'error' is deliberately outside the patch type.
      repo.updateIntegration(OWNER, integration.id, { status: 'error' }),
    ).rejects.toThrow();
  });

  it('404s for another user’s integration (RLS parity)', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    await expect(
      repo.updateIntegration(VIEWER, integration.id, { name: 'stolen' }),
    ).rejects.toThrow();
    await expect(repo.getInventory(VIEWER, integration.id)).rejects.toThrow();
    await expect(repo.listIngestRuns(VIEWER, integration.id)).rejects.toThrow();
  });
});

describe('rotateSecret', () => {
  it('replaces the stored secret immediately, with no overlap window', async () => {
    const { integration, secret } = await repo.createIntegration(OWNER);
    const rotated = await repo.rotateSecret(OWNER, integration.id);
    expect(rotated).not.toBe(secret);
    const stored = String(rows('select * from health_connect_integrations')[0].hmac_secret_encrypted);
    expect(cryptoLib.decrypt(stored)).toBe(rotated);
  });
});

describe('deleteIntegration', () => {
  function seedRaw(integrationId: string) {
    ctx.sqlite
      .prepare(
        `insert into health_connect_raw_records
           (id, integration_id, user_id, record_type, source_package, source_uuid,
            identity_kind, recorded_start_at, payload_json, first_seen_at, last_seen_at)
         values (?, ?, ?, 'nutrition', 'com.sbs.diet', ?, 'uuid', ?, '{}', ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        integrationId,
        OWNER,
        'uuid-1',
        '2026-09-01T14:00:00Z',
        '2026-09-01T14:00:00Z',
        '2026-09-01T14:00:00Z',
      );
    ctx.sqlite
      .prepare(
        `insert into nutrition_daily (id, user_id, date, source_package, calories, record_count, metadata_json, created_at, updated_at)
         values (?, ?, '2026-09-01', 'com.sbs.diet', 1260, 1, '{}', ?, ?)`,
      )
      .run(crypto.randomUUID(), OWNER, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
  }

  it('deletes raw data when asked, and never the canonical data', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    seedRaw(integration.id);
    const result = await repo.deleteIntegration(OWNER, integration.id, true);
    expect(result.rawRecordsDeleted).toBe(1);
    expect(rows('select * from health_connect_raw_records')).toHaveLength(0);
    expect(rows('select * from health_connect_integrations')).toHaveLength(0);
    // Canonical nutrition survives the integration.
    expect(rows('select * from nutrition_daily')).toHaveLength(1);
  });

  it('retains orphaned raw data when the user chooses to keep it', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    seedRaw(integration.id);
    await repo.deleteIntegration(OWNER, integration.id, false);
    const raw = rows('select * from health_connect_raw_records');
    expect(raw).toHaveLength(1);
    expect(raw[0].integration_id).toBeNull(); // ON DELETE SET NULL
    expect(raw[0].user_id).toBe(OWNER);
    expect(rows('select * from nutrition_daily')).toHaveLength(1);
  });
});

describe('upsertRawRecord', () => {
  it('inserts, updates on change, and reports an unchanged repeat as a duplicate', async () => {
    const { integration } = await repo.createIntegration(OWNER);
    const { db } = await import('@/db');
    const base = {
      recordType: 'nutrition',
      sourcePackage: 'com.sbs.diet',
      sourceUuid: 'u1',
      identityKind: 'uuid' as const,
      recordedStartAt: '2026-09-01T14:00:00.000Z',
      recordedEndAt: null,
      sourceLastModifiedAt: null,
      payload: { calories: 100 },
    };

    expect(repo.upsertRawRecord(db, OWNER, integration.id, 'ingest-1', base).outcome).toBe('inserted');
    expect(repo.upsertRawRecord(db, OWNER, integration.id, 'ingest-2', base).outcome).toBe('duplicate');

    const moved = {
      ...base,
      payload: { calories: 150 },
      recordedStartAt: '2026-09-02T14:00:00.000Z',
    };
    const result = repo.upsertRawRecord(db, OWNER, integration.id, 'ingest-3', moved);
    expect(result.outcome).toBe('updated');
    // The previous start instant is reported so the old day can be recomputed.
    expect(result.previousStartAt).toBe('2026-09-01T14:00:00.000Z');
    expect(rows('select * from health_connect_raw_records')).toHaveLength(1);
  });
});
