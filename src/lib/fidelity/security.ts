import { createHash } from 'node:crypto';
/** Canonical serialization binds exact reviewed content, subject and record revisions. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(',')}}`;
}
export const contentRevision = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export const approvalDigest = (
  ownerId: string,
  dependentId: string | null,
  batchId: string,
  version: number,
  items: unknown
) =>
  contentRevision({
    owner_id: ownerId,
    dependent_id: dependentId,
    batch_id: batchId,
    version,
    items,
  });
/** Browser approval is owner-only; legacy sharing/delegate permissions do not change. */
export function requireIntakeOwner(actorId: string, ownerId: string): void {
  if (actorId !== ownerId)
    throw Object.assign(new Error('Owner approval required.'), { status: 403 });
}
