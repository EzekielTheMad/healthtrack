// @vitest-environment node
/**
 * Authz module test matrix — enumerated from the RLS policy SQL:
 *   003_rls_policies.sql          owner CRUD + has_health_share SELECT-only
 *   005/008 (allergies, procedures, vaccines share policies)
 *   012_delegate_access.sql       has_delegate_access levels + per-table grants
 *   014_health_shares_dependent_scope.sql  exact dependent_id matching
 *
 * Policy facts encoded here (the SQL is the source of truth):
 *  - has_health_share is used ONLY in SELECT policies → shares NEVER grant
 *    write/delete, regardless of health_shares.access_level.
 *  - Share-eligible sections are exactly: medications, labs, vitals,
 *    conditions, allergies, procedures, vaccines. No policy consults shares
 *    for appointments/notes/providers/profile → listing them grants nothing.
 *  - has_health_share matches viewer by shared_with_id → email-matched but
 *    unlinked shares grant NO data access.
 *  - 014: share.dependent_id must EXACTLY match the row scope (null==null).
 *  - has_delegate_access matches by delegate_user_id only; status='accepted';
 *    expires_at null or future. read_only→read; read_write→read+write;
 *    admin→read+write+delete.
 *  - 012 delegate INSERT policies include lab_visits/lab_results but UPDATE
 *    and DELETE policies omit labs; profiles has delegate READ only. With the
 *    3-level Access model we resolve labs 'write' conservatively: DENIED
 *    (least privilege — RLS granted insert but not update; granting 'write'
 *    would allow updates RLS forbade).
 *  - Delegate grants key on the row's user_id, and dependent rows carry the
 *    parent's user_id → delegate access extends to the owner's dependents.
 *    Shares do not (exact dependent_id match).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';

let tmpDir: string;
let savedDataDir: string | undefined;

type AuthzModule = typeof import('./index');

let sqlite: Database.Database;
let authorize: AuthzModule['authorize'];
let requireAuthz: AuthzModule['requireAuthz'];
let NotFoundError: AuthzModule['NotFoundError'];

const NOW = Date.now();
const PAST = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
const T = new Date(NOW).toISOString();

// Better-auth ids are 32-char strings, not UUIDs
const OWNER = 'owner-user-000000000000000000000';
const VIEWER = 'viewer-user-00000000000000000000';
const STRANGER = 'stranger-user-000000000000000000';
const OTHER_PARENT = 'other-parent-0000000000000000000';

const ALL_SECTIONS = [
  'medications',
  'conditions',
  'allergies',
  'labs',
  'vitals',
  'procedures',
  'vaccines',
  'appointments',
  'notes',
  'providers',
  'profile',
] as const;
type SectionName = (typeof ALL_SECTIONS)[number];

// Sections with a has_health_share() SELECT policy (003 + 005 + 008 + 014)
const SHAREABLE_SECTIONS: SectionName[] = [
  'medications',
  'conditions',
  'allergies',
  'labs',
  'vitals',
  'procedures',
  'vaccines',
];
const NON_SHAREABLE_SECTIONS: SectionName[] = [
  'appointments',
  'notes',
  'providers',
  'profile',
];

// 012: delegate INSERT+UPDATE policies (labs has INSERT only → conservatively
// excluded; profiles has no delegate write at all)
const DELEGATE_WRITABLE_SECTIONS: SectionName[] = [
  'medications',
  'conditions',
  'allergies',
  'vitals',
  'procedures',
  'vaccines',
  'appointments',
  'notes',
  'providers',
];
// 012: delegate DELETE policies (admin) — same table list as UPDATE
const DELEGATE_DELETABLE_SECTIONS: SectionName[] = DELEGATE_WRITABLE_SECTIONS;

function insertUser(id: string, email: string) {
  sqlite
    .prepare(
      `insert into user (id, name, email, emailVerified, role, createdAt, updatedAt)
       values (?, ?, ?, 0, 'user', ?, ?)`,
    )
    .run(id, id, email, NOW, NOW);
}

function insertDependent(id: string, parentUserId: string) {
  sqlite
    .prepare(
      `insert into dependents
         (id, parent_user_id, name, date_of_birth, relationship, transition_age, transitioned, created_at, updated_at)
       values (?, ?, 'Dep', '2015-01-01', 'child', 18, 0, ?, ?)`,
    )
    .run(id, parentUserId, T, T);
}

function insertShare(opts: {
  ownerId: string;
  sharedWithId?: string | null;
  sharedWithEmail?: string;
  sections: string[];
  accepted?: boolean;
  expiresAt?: string | null;
  dependentId?: string | null;
}) {
  sqlite
    .prepare(
      `insert into health_shares
         (id, owner_id, shared_with_email, shared_with_id, access_level,
          shared_sections, share_token, accepted, expires_at, dependent_id, created_at)
       values (?, ?, ?, ?, 'read', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      opts.ownerId,
      opts.sharedWithEmail ?? 'viewer@example.com',
      opts.sharedWithId === undefined ? VIEWER : opts.sharedWithId,
      JSON.stringify(opts.sections),
      crypto.randomUUID(),
      opts.accepted === false ? 0 : 1,
      opts.expiresAt ?? null,
      opts.dependentId ?? null,
      T,
    );
}

function insertDelegate(opts: {
  ownerId: string;
  delegateUserId?: string | null;
  delegateEmail?: string;
  permissionLevel?: 'read_only' | 'read_write' | 'admin';
  status?: 'pending' | 'accepted' | 'rejected';
  expiresAt?: string | null;
}) {
  sqlite
    .prepare(
      `insert into delegates
         (id, owner_id, delegate_user_id, delegate_email, permission_level,
          status, invited_at, accepted_at, expires_at, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      opts.ownerId,
      opts.delegateUserId === undefined ? VIEWER : opts.delegateUserId,
      opts.delegateEmail ?? 'viewer@example.com',
      opts.permissionLevel ?? 'read_only',
      opts.status ?? 'accepted',
      T,
      opts.status === 'accepted' || opts.status === undefined ? T : null,
      opts.expiresAt ?? null,
      T,
      T,
    );
}

beforeEach(async () => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-authz-'));
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  const [{ runMigrations }, dbMod, authzMod] = await Promise.all([
    import('@/db/migrate'),
    import('@/db'),
    import('./index'),
  ]);
  runMigrations();
  sqlite = dbMod.getSqlite();
  authorize = authzMod.authorize;
  requireAuthz = authzMod.requireAuthz;
  NotFoundError = authzMod.NotFoundError;

  insertUser(OWNER, 'owner@example.com');
  insertUser(VIEWER, 'viewer@example.com');
  insertUser(STRANGER, 'stranger@example.com');
  insertUser(OTHER_PARENT, 'other-parent@example.com');
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

const ownScope = { ownerId: OWNER, dependentId: null };

describe('owner access', () => {
  it('owner has read/write/delete on own scope for every section', async () => {
    for (const section of ALL_SECTIONS) {
      for (const access of ['read', 'write', 'delete'] as const) {
        expect(
          await authorize(OWNER, ownScope, section, access),
          `${section}/${access}`,
        ).toBe(true);
      }
    }
  });

  it('owner has read/write/delete on own dependent scope', async () => {
    const depId = crypto.randomUUID();
    insertDependent(depId, OWNER);
    const scope = { ownerId: OWNER, dependentId: depId };
    for (const access of ['read', 'write', 'delete'] as const) {
      expect(await authorize(OWNER, scope, 'medications', access)).toBe(true);
    }
  });

  it("owner is denied on a dependent scope whose dependent belongs to someone else", async () => {
    const foreignDep = crypto.randomUUID();
    insertDependent(foreignDep, OTHER_PARENT);
    const scope = { ownerId: OWNER, dependentId: foreignDep };
    for (const access of ['read', 'write', 'delete'] as const) {
      expect(await authorize(OWNER, scope, 'medications', access)).toBe(false);
    }
  });

  it('owner is denied on a nonexistent dependent scope', async () => {
    const scope = { ownerId: OWNER, dependentId: crypto.randomUUID() };
    expect(await authorize(OWNER, scope, 'medications', 'read')).toBe(false);
  });

  it('unknown section string is denied even for the owner (defensive)', async () => {
    expect(
      await authorize(OWNER, ownScope, 'bogus' as never, 'read'),
    ).toBe(false);
  });
});

describe('stranger', () => {
  it('stranger is denied read/write/delete on every section', async () => {
    for (const section of ALL_SECTIONS) {
      for (const access of ['read', 'write', 'delete'] as const) {
        expect(
          await authorize(STRANGER, ownScope, section, access),
          `${section}/${access}`,
        ).toBe(false);
      }
    }
  });

  it("stranger is denied on the owner's dependent scope", async () => {
    const depId = crypto.randomUUID();
    insertDependent(depId, OWNER);
    expect(
      await authorize(STRANGER, { ownerId: OWNER, dependentId: depId }, 'vitals', 'read'),
    ).toBe(false);
  });
});

describe('health shares', () => {
  it('accepted unexpired share grants read on every listed shareable section', async () => {
    insertShare({ ownerId: OWNER, sections: SHAREABLE_SECTIONS });
    for (const section of SHAREABLE_SECTIONS) {
      expect(await authorize(VIEWER, ownScope, section, 'read'), section).toBe(true);
    }
  });

  it('shares NEVER grant write or delete (RLS uses has_health_share in SELECT only)', async () => {
    insertShare({ ownerId: OWNER, sections: SHAREABLE_SECTIONS });
    for (const section of SHAREABLE_SECTIONS) {
      expect(await authorize(VIEWER, ownScope, section, 'write'), section).toBe(false);
      expect(await authorize(VIEWER, ownScope, section, 'delete'), section).toBe(false);
    }
  });

  it('pending (not accepted) share is denied', async () => {
    insertShare({ ownerId: OWNER, sections: ['medications'], accepted: false });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('share for a different section is denied', async () => {
    insertShare({ ownerId: OWNER, sections: ['labs'] });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('expired share is denied', async () => {
    insertShare({ ownerId: OWNER, sections: ['medications'], expiresAt: PAST });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('share with a future expiry is allowed', async () => {
    insertShare({ ownerId: OWNER, sections: ['medications'], expiresAt: FUTURE });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(true);
  });

  it("dependent-scoped share does NOT grant the owner's own scope", async () => {
    const depId = crypto.randomUUID();
    insertDependent(depId, OWNER);
    insertShare({ ownerId: OWNER, sections: ['medications'], dependentId: depId });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('owner-scoped share does NOT grant a dependent scope', async () => {
    const depId = crypto.randomUUID();
    insertDependent(depId, OWNER);
    insertShare({ ownerId: OWNER, sections: ['medications'], dependentId: null });
    expect(
      await authorize(VIEWER, { ownerId: OWNER, dependentId: depId }, 'medications', 'read'),
    ).toBe(false);
  });

  it('dependent-scoped share grants read on exactly that dependent', async () => {
    const depId = crypto.randomUUID();
    insertDependent(depId, OWNER);
    insertShare({ ownerId: OWNER, sections: ['medications'], dependentId: depId });
    expect(
      await authorize(VIEWER, { ownerId: OWNER, dependentId: depId }, 'medications', 'read'),
    ).toBe(true);
  });

  it('share for dependent A does not grant dependent B', async () => {
    const depA = crypto.randomUUID();
    const depB = crypto.randomUUID();
    insertDependent(depA, OWNER);
    insertDependent(depB, OWNER);
    insertShare({ ownerId: OWNER, sections: ['medications'], dependentId: depA });
    expect(
      await authorize(VIEWER, { ownerId: OWNER, dependentId: depB }, 'medications', 'read'),
    ).toBe(false);
  });

  it('non-shareable sections are denied even when listed in shared_sections', async () => {
    insertShare({ ownerId: OWNER, sections: [...NON_SHAREABLE_SECTIONS] });
    for (const section of NON_SHAREABLE_SECTIONS) {
      expect(await authorize(VIEWER, ownScope, section, 'read'), section).toBe(false);
    }
  });

  it('share matched by email but with no linked shared_with_id grants nothing', async () => {
    insertShare({
      ownerId: OWNER,
      sharedWithId: null,
      sharedWithEmail: 'viewer@example.com',
      sections: ['medications'],
    });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });
});

describe('delegates', () => {
  it('read_only delegate can read every delegate-readable section', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'read_only' });
    for (const section of ALL_SECTIONS) {
      expect(await authorize(VIEWER, ownScope, section, 'read'), section).toBe(true);
    }
  });

  it('read_only delegate cannot write or delete', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'read_only' });
    expect(await authorize(VIEWER, ownScope, 'medications', 'write')).toBe(false);
    expect(await authorize(VIEWER, ownScope, 'medications', 'delete')).toBe(false);
  });

  it('read_write delegate can write on writable sections but cannot delete', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'read_write' });
    for (const section of DELEGATE_WRITABLE_SECTIONS) {
      expect(await authorize(VIEWER, ownScope, section, 'write'), section).toBe(true);
    }
    expect(await authorize(VIEWER, ownScope, 'medications', 'delete')).toBe(false);
  });

  it('admin delegate can read, write, and delete', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'admin' });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(true);
    for (const section of DELEGATE_WRITABLE_SECTIONS) {
      expect(await authorize(VIEWER, ownScope, section, 'write'), section).toBe(true);
    }
    for (const section of DELEGATE_DELETABLE_SECTIONS) {
      expect(await authorize(VIEWER, ownScope, section, 'delete'), section).toBe(true);
    }
  });

  it('pending delegate is denied', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'admin', status: 'pending' });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('rejected delegate is denied', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'admin', status: 'rejected' });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('expired delegate is denied', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'admin', expiresAt: PAST });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('delegate with a future expiry is allowed', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'read_only', expiresAt: FUTURE });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(true);
  });

  it('email-matched invite with null delegate_user_id grants NO data access', async () => {
    insertDelegate({
      ownerId: OWNER,
      delegateUserId: null,
      delegateEmail: 'viewer@example.com',
      permissionLevel: 'admin',
    });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });

  it('labs: delegate read allowed; write/delete denied even for admin (012 has INSERT-only for labs — conservative deny)', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'admin' });
    expect(await authorize(VIEWER, ownScope, 'labs', 'read')).toBe(true);
    expect(await authorize(VIEWER, ownScope, 'labs', 'write')).toBe(false);
    expect(await authorize(VIEWER, ownScope, 'labs', 'delete')).toBe(false);
  });

  it('profile: delegate read allowed; write/delete denied even for admin (012 profiles_delegate_read only)', async () => {
    insertDelegate({ ownerId: OWNER, permissionLevel: 'admin' });
    expect(await authorize(VIEWER, ownScope, 'profile', 'read')).toBe(true);
    expect(await authorize(VIEWER, ownScope, 'profile', 'write')).toBe(false);
    expect(await authorize(VIEWER, ownScope, 'profile', 'delete')).toBe(false);
  });

  it("delegate access extends to the owner's dependent scopes (rows carry the owner's user_id)", async () => {
    const depId = crypto.randomUUID();
    insertDependent(depId, OWNER);
    insertDelegate({ ownerId: OWNER, permissionLevel: 'admin' });
    const scope = { ownerId: OWNER, dependentId: depId };
    expect(await authorize(VIEWER, scope, 'medications', 'read')).toBe(true);
    expect(await authorize(VIEWER, scope, 'medications', 'write')).toBe(true);
    expect(await authorize(VIEWER, scope, 'medications', 'delete')).toBe(true);
  });

  it('delegate grant for owner A gives nothing on owner B', async () => {
    insertDelegate({ ownerId: OTHER_PARENT, permissionLevel: 'admin' });
    expect(await authorize(VIEWER, ownScope, 'medications', 'read')).toBe(false);
  });
});

describe('requireAuthz', () => {
  it('resolves when access is allowed', async () => {
    await expect(
      requireAuthz(OWNER, ownScope, 'medications', 'read'),
    ).resolves.toBeUndefined();
  });

  it('throws NotFoundError (404 semantics) when access is denied', async () => {
    const promise = requireAuthz(STRANGER, ownScope, 'medications', 'read');
    await expect(promise).rejects.toBeInstanceOf(NotFoundError);
    await requireAuthz(STRANGER, ownScope, 'medications', 'read').catch((err) => {
      expect(err.status).toBe(404);
      expect(err.name).toBe('NotFoundError');
    });
  });
});
