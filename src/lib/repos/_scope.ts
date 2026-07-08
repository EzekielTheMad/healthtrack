/**
 * Shared scope helpers for repository modules.
 *
 * List scoping mirrors what the client hooks did against PostgREST:
 *   - dependentId === null   → the owner's own rows (dependent_id IS NULL)
 *   - dependentId === <id>   → exactly that dependent's rows
 *   - dependentId === 'all'  → NO dependent filter. The hooks use this in
 *     delegate mode (a delegate viewing an owner sees own + dependent rows,
 *     because the 012 delegate policies key on user_id with no dependent
 *     condition). Only the owner or an accepted, unexpired delegate may list
 *     unfiltered: health shares are dependent-exact (014), so a share must
 *     never grant an unfiltered listing.
 */
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { db } from '@/db';
import { delegates } from '@/db/schema';
import { requireAuthz, NotFoundError, type Section, type Access } from '@/lib/authz';

export type DependentSelector = string | null | 'all';

export interface ListScope {
  ownerId: string;
  dependentId: DependentSelector;
}

function isUnexpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return true;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t > Date.now();
}

/**
 * Authorize a list operation. For exact dependent scopes this defers entirely
 * to requireAuthz. For 'all' (no dependent filter) it admits only the owner
 * or an accepted, unexpired delegate (any level grants read — 012).
 */
export async function requireListAuthz(
  actorId: string,
  scope: ListScope,
  section: Section,
  access: Access = 'read',
): Promise<void> {
  if (scope.dependentId !== 'all') {
    await requireAuthz(
      actorId,
      { ownerId: scope.ownerId, dependentId: scope.dependentId },
      section,
      access,
    );
    return;
  }

  if (!actorId || !scope.ownerId) throw new NotFoundError();
  if (actorId === scope.ownerId) return;

  // Delegate check (read): accepted + unexpired, matched by delegate_user_id.
  // Kept deliberately narrow — writes/deletes always go through requireAuthz
  // with an exact row scope.
  if (access !== 'read') throw new NotFoundError();
  const rows = await db
    .select({ expiresAt: delegates.expiresAt })
    .from(delegates)
    .where(
      and(
        eq(delegates.ownerId, scope.ownerId),
        eq(delegates.delegateUserId, actorId),
        eq(delegates.status, 'accepted'),
      ),
    );
  if (!rows.some((d) => isUnexpired(d.expiresAt))) throw new NotFoundError();
}

/** WHERE fragment for the dependent scope ('all' → no filter). */
export function dependentFilter(
  column: SQLiteColumn,
  dependentId: DependentSelector,
): SQL | undefined {
  if (dependentId === 'all') return undefined;
  return dependentId === null ? isNull(column) : eq(column, dependentId);
}

/**
 * Resolve a list scope from route query params, mirroring the hooks:
 * `owner_id` set (delegate mode) → that owner, no dependent filter;
 * otherwise the actor's own data, exact `dependent_id` (or null) filter.
 */
export function scopeFromParams(
  actorId: string,
  searchParams: URLSearchParams,
): ListScope {
  const ownerId = searchParams.get('owner_id');
  if (ownerId && ownerId !== actorId) return { ownerId, dependentId: 'all' };
  return { ownerId: actorId, dependentId: searchParams.get('dependent_id') };
}

/**
 * Resolve the write scope for a create, mirroring the hooks' insert payloads:
 * delegate mode writes to the owner's own scope (dependent_id null); otherwise
 * the actor's active profile (dependent or self).
 */
export function createScopeFromBody(
  actorId: string,
  body: { ownerId?: unknown; dependentId?: unknown },
): { ownerId: string; dependentId: string | null } {
  const ownerId = typeof body.ownerId === 'string' && body.ownerId ? body.ownerId : actorId;
  if (ownerId !== actorId) return { ownerId, dependentId: null };
  const dependentId =
    typeof body.dependentId === 'string' && body.dependentId ? body.dependentId : null;
  return { ownerId: actorId, dependentId };
}
