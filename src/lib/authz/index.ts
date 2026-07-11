/**
 * Central authorization module — replaces Postgres RLS for medical data.
 *
 * Semantics are a faithful translation of the policy SQL in
 * the legacy RLS migration SQL (source of truth):
 *   003_rls_policies.sql   owner-only CRUD; has_health_share() in SELECT only
 *   005/008                allergies/procedures/vaccines share SELECT policies
 *   012_delegate_access.sql  has_delegate_access() level lattice + per-table
 *                            INSERT/UPDATE/DELETE delegate policies
 *   014_health_shares_dependent_scope.sql  exact dependent_id matching
 *
 * Grant model (in evaluation order):
 *  1. Owner (actorId === scope.ownerId): full read/write/delete on their own
 *     scope and their own dependents' scopes. Dependent-scoped rows carry the
 *     parent's user_id (004_dependents.sql), so scope validity requires the
 *     dependent to belong to scope.ownerId.
 *  2. Health share: READ ONLY — has_health_share() appears exclusively in
 *     SELECT policies, so a share never grants write/delete regardless of the
 *     health_shares.access_level column. Requires shared_with_id === actor
 *     (email-matched but unlinked shares grant nothing), accepted = true,
 *     unexpired, section in shared_sections, and share.dependent_id exactly
 *     equal to scope.dependentId (null == null, 014). Only sections that have
 *     a has_health_share SELECT policy are shareable at all:
 *     medications, conditions, allergies, labs, vitals, procedures, vaccines.
 *  3. Delegate: matched by delegate_user_id only (012 — email-matched but
 *     unlinked invites grant NO data access), status = 'accepted', unexpired.
 *     Levels: read_only → read; read_write → read+write; admin →
 *     read+write+delete. Delegate policies key on the row's user_id, and
 *     dependent rows carry the owner's user_id, so delegate grants extend to
 *     the owner's dependent scopes.
 *
 * Deliberate deviations from a literal 012 reading (documented, conservative):
 *  - labs: 012 gives delegates an INSERT policy on lab_visits/lab_results but
 *    NO UPDATE and NO DELETE policy. Our 3-level Access model cannot split
 *    insert from update, so 'write' on labs is DENIED for delegates (least
 *    privilege — granting it would allow updates RLS forbade). 'delete' on
 *    labs is likewise denied (matches 012 exactly).
 *  - profile: 012 has profiles_delegate_read only → delegate write/delete on
 *    'profile' denied at every permission level (matches 012 exactly).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { dependents, healthShares, delegates } from '@/db/schema';

export type Access = 'read' | 'write' | 'delete';

export type Section =
  | 'medications'
  | 'conditions'
  | 'allergies'
  | 'labs'
  | 'vitals'
  | 'procedures'
  | 'vaccines'
  | 'appointments'
  | 'notes'
  | 'providers'
  | 'profile'
  | 'fitness';

export interface AuthzScope {
  /** The user whose data is being accessed (row user_id / profiles.id). */
  ownerId: string;
  /** null = the owner's own data; set = that dependent's data only. */
  dependentId: string | null;
}

export const ALL_SECTIONS: readonly Section[] = [
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
  // 'fitness' (workouts/exercises/check-ins/goals) is a NEW domain with no
  // legacy RLS policy — conservative grants: owner full; delegates read-only
  // (not in the writable/deletable sets); not shareable.
  'fitness',
];

/** Sections with a has_health_share() SELECT policy (003/005/008/014). */
const SHAREABLE_SECTIONS: ReadonlySet<Section> = new Set<Section>([
  'medications',
  'conditions',
  'allergies',
  'labs',
  'vitals',
  'procedures',
  'vaccines',
]);

/**
 * Sections delegates may write (012 INSERT+UPDATE policies) — everything
 * except labs (INSERT-only in 012 → conservative deny, see header) and
 * profile (read-only for delegates).
 */
const DELEGATE_WRITABLE_SECTIONS: ReadonlySet<Section> = new Set<Section>([
  'medications',
  'conditions',
  'allergies',
  'vitals',
  'procedures',
  'vaccines',
  'appointments',
  'notes',
  'providers',
]);

/** Sections admin delegates may delete (012 DELETE policies) — same list. */
const DELEGATE_DELETABLE_SECTIONS: ReadonlySet<Section> =
  DELEGATE_WRITABLE_SECTIONS;

/**
 * Thrown by requireAuthz on denial. 404 (not 403) — parity with RLS, where a
 * cross-user probe sees empty results rather than a permission error, so the
 * existence of another user's resource is never confirmed.
 */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

function isKnownSection(section: string): section is Section {
  return (ALL_SECTIONS as readonly string[]).includes(section);
}

function isUnexpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return true;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t > Date.now();
}

/** The dependent must exist and belong to scope.ownerId (004: dependent rows
 *  are keyed by parent_user_id; data rows carry the parent's user_id). */
async function dependentBelongsToOwner(
  dependentId: string,
  ownerId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: dependents.id })
    .from(dependents)
    .where(and(eq(dependents.id, dependentId), eq(dependents.parentUserId, ownerId)))
    .limit(1);
  return rows.length > 0;
}

/** has_health_share(owner, viewer, section, dependent_id) — 014 semantics. */
async function hasHealthShare(
  actorId: string,
  scope: AuthzScope,
  section: Section,
): Promise<boolean> {
  if (!SHAREABLE_SECTIONS.has(section)) return false;
  const rows = await db
    .select({
      sharedSections: healthShares.sharedSections,
      expiresAt: healthShares.expiresAt,
      dependentId: healthShares.dependentId,
    })
    .from(healthShares)
    .where(
      and(
        eq(healthShares.ownerId, scope.ownerId),
        eq(healthShares.sharedWithId, actorId),
        eq(healthShares.accepted, true),
      ),
    );
  return rows.some(
    (share) =>
      isUnexpired(share.expiresAt) &&
      // exact dependent match: both null (owner's own data) or both equal
      (share.dependentId ?? null) === (scope.dependentId ?? null) &&
      // JSON string[] membership checked in JS (no SQL any() in SQLite)
      share.sharedSections.includes(section),
  );
}

/** has_delegate_access(owner, level) — 012 semantics, by delegate_user_id only. */
async function delegateAllows(
  actorId: string,
  scope: AuthzScope,
  section: Section,
  access: Access,
): Promise<boolean> {
  if (access === 'write' && !DELEGATE_WRITABLE_SECTIONS.has(section)) return false;
  if (access === 'delete' && !DELEGATE_DELETABLE_SECTIONS.has(section)) return false;
  const rows = await db
    .select({
      permissionLevel: delegates.permissionLevel,
      expiresAt: delegates.expiresAt,
    })
    .from(delegates)
    .where(
      and(
        eq(delegates.ownerId, scope.ownerId),
        // null delegate_user_id never matches: email-matched invites grant nothing
        eq(delegates.delegateUserId, actorId),
        eq(delegates.status, 'accepted'),
      ),
    );
  return rows.some((d) => {
    if (!isUnexpired(d.expiresAt)) return false;
    switch (access) {
      case 'read':
        return true; // any accepted level grants read
      case 'write':
        return d.permissionLevel === 'read_write' || d.permissionLevel === 'admin';
      case 'delete':
        return d.permissionLevel === 'admin';
    }
  });
}

/**
 * Resolves whether `actorId` may access `scope` for `section` at `access`
 * level. Never throws on denial — returns false.
 */
export async function authorize(
  actorId: string,
  scope: AuthzScope,
  section: Section,
  access: Access,
): Promise<boolean> {
  // Defensive: unknown section strings deny for everyone.
  if (!isKnownSection(section)) return false;
  if (!actorId || !scope.ownerId) return false;

  // A dependent scope is only valid if the dependent belongs to the owner.
  if (scope.dependentId !== null && scope.dependentId !== undefined) {
    if (!(await dependentBelongsToOwner(scope.dependentId, scope.ownerId))) {
      return false;
    }
  }

  // 1. Owner: full access to own scope and own dependents' scopes.
  if (actorId === scope.ownerId) return true;

  // 2. Health shares: read-only grants, exact dependent scoping.
  if (access === 'read' && (await hasHealthShare(actorId, scope, section))) {
    return true;
  }

  // 3. Delegates: level-based grants; extend to the owner's dependent scopes.
  return delegateAllows(actorId, scope, section, access);
}

/**
 * Like authorize(), but throws NotFoundError on denial so routes surface 404
 * (not 403) for cross-user probes — parity with RLS empty results.
 */
export async function requireAuthz(
  actorId: string,
  scope: AuthzScope,
  section: Section,
  access: Access,
): Promise<void> {
  if (!(await authorize(actorId, scope, section, access))) {
    throw new NotFoundError();
  }
}
