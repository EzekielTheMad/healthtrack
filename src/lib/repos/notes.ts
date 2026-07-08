/**
 * notes repository.
 *
 * Authorization (003/012, encoded in src/lib/authz): owner full; NOT
 * shareable (003 has no has_health_share policy on notes); delegates read
 * (read_only+), insert/update (read_write+), delete (admin).
 *
 * notes has NO updated_at column; severity's `check (between 1 and 5)` is
 * enforced here at the repository boundary (see schema comment).
 */
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { notes } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type NoteRow = typeof notes.$inferSelect;

// Unknown keys (id, user_id, dependent_id, created_at…) are stripped —
// row scope is never client-controlled.
const noteInputSchema = z
  .object({
    content: z.string().trim().min(1),
    noteType: z.enum(['symptom', 'observation', 'general']).default('general'),
    severity: z.number().int().min(1).max(5).nullish(),
    tags: z.array(z.string()).default([]),
    recordedAt: z.string().min(1).optional(),
  })
  .strip();

export type NoteInput = z.input<typeof noteInputSchema>;

export async function listNotes(actorId: string, scope: ListScope): Promise<NoteRow[]> {
  await requireListAuthz(actorId, scope, 'notes', 'read');
  return db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.userId, scope.ownerId),
        dependentFilter(notes.dependentId, scope.dependentId),
      ),
    )
    .orderBy(desc(notes.recordedAt));
}

export async function createNote(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<NoteRow> {
  await requireAuthz(actorId, scope, 'notes', 'write');
  const values = noteInputSchema.parse(input);
  const [row] = await db
    .insert(notes)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

export async function deleteNote(actorId: string, id: string): Promise<void> {
  const rows = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError();
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'notes',
    'delete',
  );
  await db.delete(notes).where(eq(notes.id, id));
}
