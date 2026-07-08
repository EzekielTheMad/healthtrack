/**
 * providers repository.
 *
 * Authorization (verified against the SQL):
 *   003: owner-only CRUD; providers has NO has_health_share policy → health
 *        shares never grant providers, at any dependent scope.
 *   012: providers_delegate_read (read_only+), providers_delegate_write/
 *        providers_delegate_update (read_write+), providers_delegate_delete
 *        (admin). Encoded in src/lib/authz (providers ∉ SHAREABLE_SECTIONS,
 *        ∈ DELEGATE_WRITABLE/DELETABLE).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { providers } from '@/db/schema';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type ProviderRow = typeof providers.$inferSelect;

const providerTypeEnum = [
  'pcp',
  'specialist',
  'lab',
  'imaging',
  'urgent_care',
  'hospital',
  'pharmacy',
  'therapist',
  'dentist',
  'other',
] as const;

// CHECK-constraint parity with 001; unknown keys (user_id, dependent_id,
// id, timestamps…) are stripped — scope is never client-controlled here.
const providerInputSchema = z
  .object({
    name: z.string().trim().min(1),
    providerType: z.enum(providerTypeEnum).nullish(),
    specialty: z.string().nullish(),
    organization: z.string().nullish(),
    phone: z.string().nullish(),
    fax: z.string().nullish(),
    address: z.string().nullish(),
    city: z.string().nullish(),
    state: z.string().nullish(),
    zip: z.string().nullish(),
    portalUrl: z.string().nullish(),
    notes: z.string().nullish(),
    isFavorite: z.boolean().optional(),
    specialtyTaxonomy: z.string().nullish(),
  })
  .strip();

const providerUpdateSchema = providerInputSchema.partial();

export type ProviderInput = z.infer<typeof providerInputSchema>;

export async function listProviders(
  actorId: string,
  scope: ListScope,
): Promise<ProviderRow[]> {
  await requireListAuthz(actorId, scope, 'providers', 'read');
  return db
    .select()
    .from(providers)
    .where(
      and(
        eq(providers.userId, scope.ownerId),
        dependentFilter(providers.dependentId, scope.dependentId),
      ),
    )
    .orderBy(desc(providers.isFavorite), asc(providers.name));
}

export async function createProvider(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<ProviderRow> {
  await requireAuthz(actorId, scope, 'providers', 'write');
  const values = providerInputSchema.parse(input);
  const [row] = await db
    .insert(providers)
    .values({ ...values, userId: scope.ownerId, dependentId: scope.dependentId })
    .returning();
  return row;
}

/** Row scope comes from the row itself (RLS parity for by-id operations). */
async function loadRow(id: string): Promise<ProviderRow> {
  const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
  if (!rows[0]) throw new NotFoundError();
  return rows[0];
}

export async function updateProvider(
  actorId: string,
  id: string,
  updates: unknown,
): Promise<ProviderRow> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'providers',
    'write',
  );
  const values = providerUpdateSchema.parse(updates);
  const [updated] = await db
    .update(providers)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(providers.id, id))
    .returning();
  return updated;
}

export async function deleteProvider(actorId: string, id: string): Promise<void> {
  const row = await loadRow(id);
  await requireAuthz(
    actorId,
    { ownerId: row.userId, dependentId: row.dependentId },
    'providers',
    'delete',
  );
  await db.delete(providers).where(eq(providers.id, id));
}
