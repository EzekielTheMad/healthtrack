/**
 * interaction_alerts repository.
 *
 * Authorization (003): strictly owner-only, keyed on user_id — 012 added NO
 * delegate policies and shares never covered this table. RLS-parity details
 * preserved deliberately:
 *   - a non-owner listing (delegate mode sends ?owner_id=) gets an EMPTY
 *     array, not an error — exactly what the PostgREST query returned;
 *   - a non-owner dismiss is a silent no-op — the RLS UPDATE matched 0 rows
 *     and PostgREST still reported success.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { interactionAlerts } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import { dependentFilter, type ListScope } from './_scope';

export type InteractionAlertRow = typeof interactionAlerts.$inferSelect;

export interface NewInteractionAlert {
  triggerMedicationId: string;
  alertText: string;
  severity: 'info' | 'warning' | 'critical';
  medicationSnapshot: Record<string, unknown>;
}

/** Active (non-dismissed) alerts, newest check first. Non-owner scope → []. */
export async function listActiveInteractionAlerts(
  actorId: string,
  scope: ListScope,
): Promise<InteractionAlertRow[]> {
  if (!actorId) throw new NotFoundError();
  if (actorId !== scope.ownerId) return []; // RLS-empty parity, see header
  return db
    .select()
    .from(interactionAlerts)
    .where(
      and(
        eq(interactionAlerts.userId, actorId),
        eq(interactionAlerts.dismissed, false),
        dependentFilter(interactionAlerts.dependentId, scope.dependentId),
      ),
    )
    .orderBy(desc(interactionAlerts.checkedAt));
}

/** Dismiss by id. Owner-only; non-owner is a silent no-op (RLS parity). */
export async function dismissInteractionAlert(
  actorId: string,
  id: string,
): Promise<void> {
  if (!actorId) throw new NotFoundError();
  await db
    .update(interactionAlerts)
    .set({ dismissed: true })
    .where(and(eq(interactionAlerts.id, id), eq(interactionAlerts.userId, actorId)));
}

/** Clear the actor's non-dismissed alerts (pre-insert step of a re-check). */
export async function clearActiveInteractionAlerts(actorId: string): Promise<void> {
  if (!actorId) throw new NotFoundError();
  await db
    .delete(interactionAlerts)
    .where(
      and(
        eq(interactionAlerts.userId, actorId),
        eq(interactionAlerts.dismissed, false),
      ),
    );
}

/** Insert freshly generated alerts for the actor; returns the new ids. */
export async function createInteractionAlerts(
  actorId: string,
  alerts: NewInteractionAlert[],
): Promise<string[]> {
  if (!actorId) throw new NotFoundError();
  if (alerts.length === 0) return [];
  const now = new Date().toISOString();
  const rows = await db
    .insert(interactionAlerts)
    .values(
      alerts.map((a) => ({
        userId: actorId,
        triggerMedicationId: a.triggerMedicationId,
        alertText: a.alertText,
        severity: a.severity,
        dismissed: false,
        checkedAt: now,
        medicationSnapshot: a.medicationSnapshot,
      })),
    )
    .returning({ id: interactionAlerts.id });
  return rows.map((r) => r.id);
}
