/**
 * goals repository — metric + frequency goal kinds (spec §goals).
 *
 * Authorization: 'fitness' section (owner full; delegates read-only; not
 * shareable). Goals are strictly per-user (no dependent column).
 *
 * Constraints enforced here (repo level, spec §goals):
 *  - kind is immutable after create;
 *  - metric goals: metricKey must exist in the closed metric registry;
 *  - at most ONE ACTIVE metric goal per metricKey and ONE ACTIVE frequency
 *    goal per sessionType — violations throw a 409-shaped
 *    FitnessConflictError naming the existing goal.
 */
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { goals, GOAL_DIRECTIONS, GOAL_KINDS, SESSION_TYPES } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { getMetric } from '@/lib/metrics/registry';
import { FitnessConflictError, FitnessWriteError, parseFitness } from './_fitness';

export type GoalRow = typeof goals.$inferSelect;

const targetDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

// Unknown keys (id, user_id, timestamps…) are stripped; the discriminated
// union keeps each kind to its own fields.
const metricGoalSchema = z
  .object({
    kind: z.literal('metric'),
    metricKey: z.string().trim().min(1).max(64),
    direction: z.enum(GOAL_DIRECTIONS),
    targetValue: z.number().positive().finite().nullish(),
    targetDate: targetDateSchema.nullish(),
    active: z.boolean().default(true),
  })
  .strip();

const frequencyGoalSchema = z
  .object({
    kind: z.literal('frequency'),
    sessionType: z.enum(SESSION_TYPES),
    perWeek: z.number().int().min(1).max(21),
    active: z.boolean().default(true),
  })
  .strip();

const goalCreateSchema = z.discriminatedUnion('kind', [metricGoalSchema, frequencyGoalSchema]);

const goalUpdateSchema = z
  .object({
    active: z.boolean().optional(),
    // metric kind
    metricKey: z.string().trim().min(1).max(64).optional(),
    direction: z.enum(GOAL_DIRECTIONS).optional(),
    targetValue: z.number().positive().finite().nullish(),
    targetDate: targetDateSchema.nullish(),
    // frequency kind
    sessionType: z.enum(SESSION_TYPES).optional(),
    perWeek: z.number().int().min(1).max(21).optional(),
  })
  .strip();

export type GoalInput = z.input<typeof goalCreateSchema>;

function assertKnownMetric(metricKey: string): void {
  if (!getMetric(metricKey)) {
    throw new FitnessWriteError(
      `Unknown metric key '${metricKey}'. The metric registry is closed — see /docs/api for the list of supported metrics.`,
    );
  }
}

/** At most one ACTIVE metric goal per metricKey / frequency goal per
    sessionType. `key` is the metricKey or sessionType for the goal's kind. */
async function assertNoActiveDuplicate(
  userId: string,
  kind: (typeof GOAL_KINDS)[number],
  key: string,
  excludeGoalId?: string,
): Promise<void> {
  const keyColumn = kind === 'metric' ? goals.metricKey : goals.sessionType;
  const rows = await db
    .select({ id: goals.id })
    .from(goals)
    .where(
      and(
        eq(goals.userId, userId),
        eq(goals.kind, kind),
        eq(goals.active, true),
        eq(keyColumn, key),
        excludeGoalId ? ne(goals.id, excludeGoalId) : undefined,
      ),
    )
    .limit(1);
  if (rows[0]) {
    const what = kind === 'metric' ? `metric goal for '${key}'` : `frequency goal for '${key}' sessions`;
    throw new FitnessConflictError(
      `An active ${what} already exists — deactivate it first or patch it instead.`,
      rows[0].id,
    );
  }
}

export interface ListGoalsOptions {
  active?: boolean;
  kind?: (typeof GOAL_KINDS)[number];
}

export async function listGoals(
  actorId: string,
  ownerId: string = actorId,
  opts: ListGoalsOptions = {},
): Promise<GoalRow[]> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'read');
  return db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.userId, ownerId),
        opts.active === undefined ? undefined : eq(goals.active, opts.active),
        opts.kind === undefined ? undefined : eq(goals.kind, opts.kind),
      ),
    )
    .orderBy(desc(goals.createdAt));
}

export async function createGoal(
  actorId: string,
  ownerId: string,
  input: unknown,
): Promise<GoalRow> {
  await requireAuthz(actorId, { ownerId, dependentId: null }, 'fitness', 'write');
  const values = parseFitness(goalCreateSchema, input, 'goal');
  if (values.kind === 'metric') {
    assertKnownMetric(values.metricKey);
    if (values.active) await assertNoActiveDuplicate(ownerId, 'metric', values.metricKey);
  } else if (values.active) {
    await assertNoActiveDuplicate(ownerId, 'frequency', values.sessionType);
  }
  const [row] = await db
    .insert(goals)
    .values({ ...values, userId: ownerId })
    .returning();
  return row;
}

async function loadRow(id: string): Promise<GoalRow> {
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

/**
 * PATCH — kind is immutable; fields must match the row's kind. Activating a
 * goal (or re-keying an active one) re-checks the at-most-one-active rule.
 */
export async function updateGoal(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<GoalRow> {
  const row = await loadRow(id);
  await requireAuthz(actorId, { ownerId: row.userId, dependentId: null }, 'fitness', 'write');
  const values = parseFitness(goalUpdateSchema, updates, 'goal');

  const metricFields = ['metricKey', 'direction', 'targetValue', 'targetDate'] as const;
  const frequencyFields = ['sessionType', 'perWeek'] as const;
  const wrongKindFields = (row.kind === 'metric' ? frequencyFields : metricFields).filter(
    (f) => values[f] !== undefined,
  );
  if (wrongKindFields.length > 0) {
    throw new FitnessWriteError(
      `${wrongKindFields.join(', ')} not valid for a ${row.kind} goal (kind is immutable).`,
    );
  }

  if (values.metricKey !== undefined) assertKnownMetric(values.metricKey);

  const nextActive = values.active ?? row.active;
  if (nextActive) {
    const key =
      row.kind === 'metric'
        ? (values.metricKey ?? row.metricKey)
        : (values.sessionType ?? row.sessionType);
    // Kind-specific key columns are non-null for rows written through this
    // repo; guard anyway.
    if (key) await assertNoActiveDuplicate(row.userId, row.kind, key, row.id);
  }

  const [updated] = await db
    .update(goals)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(goals.id, id))
    .returning();
  return updated;
}
