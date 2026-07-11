/**
 * exercises repository — per-user exercise catalog.
 *
 * Authorization: 'fitness' section (new domain, no legacy RLS): owner full;
 * delegates read-only; not shareable. The catalog has no dependent column —
 * rows are strictly per-user.
 *
 * Name resolution (spec §exercises): case-insensitive over name + aliases.
 * Resolution uniqueness is enforced at write time — a new name/alias may not
 * collide with any existing name/alias for that user. Unknown names arriving
 * through workout writes auto-create `unreviewed` entries (never bounce a
 * write) — see resolveOrCreateExerciseSync.
 */
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  exercises,
  EXERCISE_MODES,
  EXERCISE_REVIEW_STATUSES,
  type ExerciseReviewStatus,
} from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { FitnessWriteError, parseFitness, type FitnessDb } from './_fitness';

export type ExerciseRow = typeof exercises.$inferSelect;

const MAX_NAME_CHARS = 120;
const MAX_ALIASES = 50;

const nameSchema = z.string().trim().min(1).max(MAX_NAME_CHARS);

// Unknown keys (id, user_id, timestamps…) are stripped — row scope is never
// client-controlled.
const exerciseInputSchema = z
  .object({
    name: nameSchema,
    variant: nameSchema.nullish(),
    mode: z.enum(EXERCISE_MODES).default('weight'),
    aliases: z.array(nameSchema).max(MAX_ALIASES).default([]),
    reviewStatus: z.enum(EXERCISE_REVIEW_STATUSES).default('confirmed'),
  })
  .strip();

const exerciseUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    variant: nameSchema.nullish(),
    mode: z.enum(EXERCISE_MODES).optional(),
    aliases: z.array(nameSchema).max(MAX_ALIASES).optional(),
    reviewStatus: z.enum(EXERCISE_REVIEW_STATUSES).optional(),
  })
  .strip();

export type ExerciseInput = z.input<typeof exerciseInputSchema>;

export interface ListExercisesOptions {
  reviewStatus?: ExerciseReviewStatus;
}

export async function listExercises(
  actorId: string,
  ownerId: string = actorId,
  opts: ListExercisesOptions = {},
): Promise<ExerciseRow[]> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'read');
  const rows = await db
    .select()
    .from(exercises)
    .where(eq(exercises.userId, ownerId))
    .orderBy(asc(exercises.name));
  return opts.reviewStatus ? rows.filter((r) => r.reviewStatus === opts.reviewStatus) : rows;
}

/** Every resolution key (name + aliases, lowercased) an exercise claims. */
function resolutionKeys(row: Pick<ExerciseRow, 'name' | 'aliases'>): string[] {
  return [row.name, ...row.aliases].map((n) => n.trim().toLowerCase());
}

/**
 * Resolution-uniqueness guard: none of `candidates` (the exercise's own name
 * + aliases) may collide, case-insensitively, with any other exercise's name
 * or aliases for this user — or with each other. Throws FitnessWriteError.
 */
function assertNoResolutionCollision(
  dbh: FitnessDb,
  userId: string,
  candidates: string[],
  excludeExerciseId?: string,
): void {
  const seen = new Map<string, string>();
  for (const c of candidates) {
    const key = c.trim().toLowerCase();
    if (seen.has(key)) {
      throw new FitnessWriteError(
        `Duplicate name/alias '${c}' — names and aliases must be unique (case-insensitive).`,
      );
    }
    seen.set(key, c);
  }
  const rows = dbh.select().from(exercises).where(eq(exercises.userId, userId)).all();
  for (const row of rows) {
    if (row.id === excludeExerciseId) continue;
    for (const key of resolutionKeys(row)) {
      const clash = seen.get(key);
      if (clash !== undefined) {
        throw new FitnessWriteError(
          `Name/alias '${clash}' collides with existing exercise '${row.name}'` +
            `${row.variant ? ` (${row.variant})` : ''} — names and aliases must resolve uniquely.`,
        );
      }
    }
  }
}

export async function createExercise(
  actorId: string,
  ownerId: string,
  input: unknown,
): Promise<ExerciseRow> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'write');
  const values = parseFitness(exerciseInputSchema, input, 'exercise');
  assertNoResolutionCollision(db, ownerId, [values.name, ...values.aliases]);
  const [row] = await db
    .insert(exercises)
    .values({ ...values, userId: ownerId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (parity with by-id ops elsewhere). */
async function loadRow(id: string): Promise<ExerciseRow> {
  const rows = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function getExercise(actorId: string, id: string): Promise<ExerciseRow> {
  const row = await loadRow(id);
  await requireAuthz(actorId, { ownerId: row.userId, dependentId: null }, 'fitness', 'read');
  return row;
}

export async function updateExercise(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<ExerciseRow> {
  const row = await loadRow(id);
  await requireAuthz(actorId, { ownerId: row.userId, dependentId: null }, 'fitness', 'write');
  const values = parseFitness(exerciseUpdateSchema, updates, 'exercise');
  if (values.name !== undefined || values.aliases !== undefined) {
    assertNoResolutionCollision(
      db,
      row.userId,
      [values.name ?? row.name, ...(values.aliases ?? row.aliases)],
      row.id,
    );
  }
  const [updated] = await db
    .update(exercises)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(exercises.id, id))
    .returning();
  return updated;
}

/**
 * Resolve an exercise name for a workout write: case-insensitive match over
 * every catalog name + alias; unknown names AUTO-CREATE an `unreviewed`
 * weight-mode entry so drift becomes visible and fixable instead of bouncing
 * the write (spec decision 3). Synchronous so workout creation can run inside
 * one better-sqlite3 transaction. NO authz — callers authorize the session
 * write; userId is the already-authorized owner.
 */
export function resolveOrCreateExerciseSync(
  dbh: FitnessDb,
  userId: string,
  name: string,
): { exercise: ExerciseRow; created: boolean } {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_NAME_CHARS) {
    throw new FitnessWriteError(
      `exercise_name must be 1-${MAX_NAME_CHARS} characters (got '${name.slice(0, MAX_NAME_CHARS)}…').`,
    );
  }
  const key = trimmed.toLowerCase();
  const rows = dbh.select().from(exercises).where(eq(exercises.userId, userId)).all();
  const match = rows.find((r) => resolutionKeys(r).includes(key));
  if (match) return { exercise: match, created: false };
  const created = dbh
    .insert(exercises)
    .values({ userId, name: trimmed, mode: 'weight', aliases: [], reviewStatus: 'unreviewed' })
    .returning()
    .get();
  return { exercise: created, created: true };
}
