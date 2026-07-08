/**
 * appointments repository.
 *
 * Authorization (003/012, encoded in src/lib/authz): owner full; NOT
 * shareable (003 has no has_health_share policy on appointments); delegates
 * read (read_only+), insert/update (read_write+), delete (admin).
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { appointments } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type AppointmentRow = typeof appointments.$inferSelect;

// Unknown keys (id, user_id, dependent_id, timestamps…) are stripped —
// row scope is never client-controlled.
const appointmentInputSchema = z
  .object({
    providerId: z.string().nullish(),
    appointmentDate: z.string().min(1),
    reason: z.string().nullish(),
    notes: z.string().nullish(),
    followUpDate: z.string().nullish(),
    labVisitId: z.string().nullish(),
  })
  .strip();

const appointmentUpdateSchema = appointmentInputSchema.partial();

export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

export async function listAppointments(
  actorId: string,
  scope: ListScope,
): Promise<AppointmentRow[]> {
  await requireListAuthz(actorId, scope, 'appointments', 'read');
  return db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.userId, scope.ownerId),
        dependentFilter(appointments.dependentId, scope.dependentId),
      ),
    )
    .orderBy(desc(appointments.appointmentDate));
}

export async function createAppointment(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<AppointmentRow> {
  await requireAuthz(actorId, scope, 'appointments', 'write');
  const values = appointmentInputSchema.parse(input);
  const [row] = await db
    .insert(appointments)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (RLS parity for by-id operations). */
async function loadRow(id: string): Promise<AppointmentRow> {
  const rows = await db
    .select()
    .from(appointments)
    .where(eq(appointments.id, id))
    .limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateAppointment(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<AppointmentRow> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'appointments',
    'write',
  );
  const values = appointmentUpdateSchema.parse(updates);
  const [updated] = await db
    .update(appointments)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(appointments.id, id))
    .returning();
  return updated;
}

export async function deleteAppointment(actorId: string, id: string): Promise<void> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'appointments',
    'delete',
  );
  await db.delete(appointments).where(eq(appointments.id, id));
}
