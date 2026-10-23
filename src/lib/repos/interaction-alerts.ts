/**
 * interaction_alerts + interaction_checks repository.
 *
 * Authorization (003): strictly owner-only, keyed on user_id — 012 added NO
 * delegate policies and shares never covered this table. RLS-parity details
 * preserved deliberately:
 *   - a non-owner listing (delegate mode sends ?owner_id=) gets an EMPTY
 *     array, not an error — exactly what the PostgREST query returned;
 *   - a non-owner snooze is a silent no-op — the RLS UPDATE matched 0 rows
 *     and PostgREST still reported success.
 *
 * 006 model: dismissal is a *temporary snooze* (`snoozed_until`), not a
 * permanent boolean. An alert is "active" (shown) when snoozed_until is null or
 * already in the past. Re-checks reconcile by `signature` (a stable key for one
 * interaction) so an existing alert's snooze survives unrelated med changes.
 * `interaction_checks` records the outcome of the latest check per scope so the
 * UI can persist an "no interactions found" state.
 */
import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { db, type DB } from '@/db';
import { interactionAlerts, interactionChecks, medications } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import { dependentFilter, type ListScope } from './_scope';

export type InteractionAlertRow = typeof interactionAlerts.$inferSelect;

export interface NewInteractionAlert {
  triggerMedicationId: string;
  alertText: string;
  severity: 'info' | 'warning' | 'critical';
  medicationSnapshot: Record<string, unknown>;
  signature?: string | null;
  dependentId?: string | null;
}

/** One detected interaction, keyed by `signature` for reconcile matching. */
export interface DetectedInteraction {
  signature: string;
  triggerMedicationId: string;
  alertText: string;
  severity: 'info' | 'warning' | 'critical';
  medicationSnapshot: Record<string, unknown>;
}

type InteractionConnection = Pick<DB, 'select' | 'insert' | 'update' | 'delete'>;

type CheckedMedication = Pick<
  typeof medications.$inferSelect,
  'id' | 'name' | 'dosage' | 'frequency' | 'active' | 'rxcui'
>;

function medicationSnapshot(rows: CheckedMedication[]): string {
  return JSON.stringify(
    rows
      .map((row) => [row.id, row.name, row.dosage, row.frequency, row.active, row.rxcui])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  );
}

/** Active (currently un-snoozed) alerts, newest check first. Non-owner → []. */
export async function listActiveInteractionAlerts(
  actorId: string,
  scope: ListScope
): Promise<InteractionAlertRow[]> {
  if (!actorId) throw new NotFoundError();
  if (actorId !== scope.ownerId) return []; // RLS-empty parity, see header
  const now = new Date().toISOString();
  return db
    .select()
    .from(interactionAlerts)
    .where(
      and(
        eq(interactionAlerts.userId, actorId),
        dependentFilter(interactionAlerts.dependentId, scope.dependentId),
        or(isNull(interactionAlerts.snoozedUntil), lte(interactionAlerts.snoozedUntil, now))
      )
    )
    .orderBy(desc(interactionAlerts.checkedAt));
}

/** Count of currently-snoozed alerts (snoozed_until still in the future). */
export async function countSnoozedInteractionAlerts(
  actorId: string,
  scope: ListScope
): Promise<number> {
  if (!actorId) throw new NotFoundError();
  if (actorId !== scope.ownerId) return 0;
  const now = new Date().toISOString();
  const rows = await db
    .select({ id: interactionAlerts.id })
    .from(interactionAlerts)
    .where(
      and(
        eq(interactionAlerts.userId, actorId),
        dependentFilter(interactionAlerts.dependentId, scope.dependentId),
        gt(interactionAlerts.snoozedUntil, now)
      )
    );
  return rows.length;
}

/** Max snooze per severity: a real interaction can't be buried for a month. */
export const SNOOZE_MAX_DAYS: Record<string, number> = {
  info: 30,
  warning: 7,
  critical: 7,
};

/**
 * Snooze an alert for `days`, clamped to the severity cap (warnings max out at
 * 7 days). Owner-only; a non-owner or unknown id is a silent no-op (RLS
 * parity). Returns the applied `snoozed_until`, or null if nothing was updated.
 */
export async function snoozeInteractionAlert(
  actorId: string,
  id: string,
  days: number
): Promise<string | null> {
  if (!actorId) throw new NotFoundError();
  const [row] = await db
    .select({ severity: interactionAlerts.severity })
    .from(interactionAlerts)
    .where(and(eq(interactionAlerts.id, id), eq(interactionAlerts.userId, actorId)))
    .limit(1);
  if (!row) return null;
  const cap = SNOOZE_MAX_DAYS[row.severity] ?? 7;
  const effective = Math.min(Math.max(Math.floor(days), 1), cap);
  const until = new Date(Date.now() + effective * 86_400_000).toISOString();
  await db
    .update(interactionAlerts)
    .set({ snoozedUntil: until })
    .where(and(eq(interactionAlerts.id, id), eq(interactionAlerts.userId, actorId)));
  return until;
}

/** Insert freshly generated alerts for the actor; returns the new ids. */
export async function createInteractionAlerts(
  actorId: string,
  alerts: NewInteractionAlert[]
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
        signature: a.signature ?? null,
        dependentId: a.dependentId ?? null,
        checkedAt: now,
        medicationSnapshot: a.medicationSnapshot,
      }))
    )
    .returning({ id: interactionAlerts.id });
  return rows.map((r) => r.id);
}

/**
 * Reconcile the stored alerts for a scope against a freshly-detected set:
 *   - a detected interaction that matches an existing `signature` updates that
 *     row in place (text/severity/checkedAt) and **preserves its snooze**;
 *   - a new signature is inserted (un-snoozed);
 *   - an existing row whose interaction is no longer detected (or a legacy
 *     row with no signature) is deleted.
 * This is what makes an alert "stay" across unrelated med changes instead of
 * being wiped and regenerated.
 */
export async function reconcileInteractionAlerts(
  actorId: string,
  dependentId: string | null,
  detected: DetectedInteraction[]
): Promise<void> {
  if (!actorId) throw new NotFoundError();
  db.transaction((tx) => reconcileAlerts(tx, actorId, dependentId, detected));
}

function reconcileAlerts(
  connection: InteractionConnection,
  actorId: string,
  dependentId: string | null,
  detected: DetectedInteraction[]
): void {
  const now = new Date().toISOString();

  const existing = connection
    .select()
    .from(interactionAlerts)
    .where(
      and(
        eq(interactionAlerts.userId, actorId),
        dependentFilter(interactionAlerts.dependentId, dependentId)
      )
    )
    .all();
  const existingBySig = new Map(
    existing.filter((e) => e.signature).map((e) => [e.signature as string, e])
  );
  const detectedSigs = new Set(detected.map((d) => d.signature));

  for (const d of detected) {
    const prior = existingBySig.get(d.signature);
    if (prior) {
      connection
        .update(interactionAlerts)
        .set({
          alertText: d.alertText,
          severity: d.severity,
          triggerMedicationId: d.triggerMedicationId,
          medicationSnapshot: d.medicationSnapshot,
          checkedAt: now,
          // snoozedUntil deliberately preserved
        })
        .where(eq(interactionAlerts.id, prior.id))
        .run();
    } else {
      connection
        .insert(interactionAlerts)
        .values({
          userId: actorId,
          dependentId,
          triggerMedicationId: d.triggerMedicationId,
          alertText: d.alertText,
          severity: d.severity,
          signature: d.signature,
          checkedAt: now,
          medicationSnapshot: d.medicationSnapshot,
        })
        .run();
    }
  }

  const toDelete = existing
    .filter((e) => !e.signature || !detectedSigs.has(e.signature))
    .map((e) => e.id);
  if (toDelete.length > 0) {
    connection
      .delete(interactionAlerts)
      .where(and(eq(interactionAlerts.userId, actorId), inArray(interactionAlerts.id, toDelete)))
      .run();
  }
}

// ── interaction_checks: last-check status per scope ────────────────────────

export interface InteractionCheckStatus {
  checkedAt: string;
  hasInteractions: boolean;
}

/** A medication change makes the prior outcome stale, while prior warnings stay visible. */
export function invalidateInteractionCheck(
  ownerId: string,
  dependentId: string | null,
  connection: Pick<DB, 'delete'> = db
): void {
  connection
    .delete(interactionChecks)
    .where(
      and(
        eq(interactionChecks.userId, ownerId),
        dependentFilter(interactionChecks.dependentId, dependentId)
      )
    )
    .run();
}

/** The latest check outcome for a scope, or null if never checked. */
export async function getInteractionCheck(
  actorId: string,
  scope: ListScope
): Promise<InteractionCheckStatus | null> {
  if (!actorId) throw new NotFoundError();
  if (actorId !== scope.ownerId) return null;
  const [row] = await db
    .select()
    .from(interactionChecks)
    .where(
      and(
        eq(interactionChecks.userId, actorId),
        dependentFilter(interactionChecks.dependentId, scope.dependentId)
      )
    )
    .orderBy(desc(interactionChecks.checkedAt))
    .limit(1);
  return row ? { checkedAt: row.checkedAt, hasInteractions: row.hasInteractions } : null;
}

/** Upsert the latest check outcome for a scope (one row per scope). */
export async function recordInteractionCheck(
  actorId: string,
  dependentId: string | null,
  hasInteractions: boolean
): Promise<void> {
  if (!actorId) throw new NotFoundError();
  db.transaction((tx) => recordCheck(tx, actorId, dependentId, hasInteractions));
}

function recordCheck(
  connection: InteractionConnection,
  actorId: string,
  dependentId: string | null,
  hasInteractions: boolean
): void {
  const now = new Date().toISOString();
  const [existing] = connection
    .select({ id: interactionChecks.id })
    .from(interactionChecks)
    .where(
      and(
        eq(interactionChecks.userId, actorId),
        dependentFilter(interactionChecks.dependentId, dependentId)
      )
    )
    .limit(1)
    .all();
  if (existing) {
    connection
      .update(interactionChecks)
      .set({ hasInteractions, checkedAt: now })
      .where(eq(interactionChecks.id, existing.id))
      .run();
  } else {
    connection
      .insert(interactionChecks)
      .values({ userId: actorId, dependentId, hasInteractions, checkedAt: now })
      .run();
  }
}

/** Store a result only if the selected patient's active medications still match. */
export function commitInteractionCheck(
  actorId: string,
  dependentId: string | null,
  expectedMedications: CheckedMedication[],
  detected: DetectedInteraction[],
  hasInteractions: boolean
): boolean {
  if (!actorId) throw new NotFoundError();
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(medications)
      .where(
        and(
          eq(medications.userId, actorId),
          dependentFilter(medications.dependentId, dependentId),
          eq(medications.active, true)
        )
      )
      .all();
    if (medicationSnapshot(expectedMedications) !== medicationSnapshot(current)) return false;
    reconcileAlerts(tx, actorId, dependentId, detected);
    recordCheck(tx, actorId, dependentId, hasInteractions);
    return true;
  });
}

/** Build the stable signature for an interaction from its medication names. */
export function interactionSignature(medicationNames: string[]): string {
  return [...medicationNames]
    .map((n) => n.trim().toLowerCase())
    .sort()
    .join('|');
}
