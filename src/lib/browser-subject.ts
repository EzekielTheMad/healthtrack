import type { Delegate, Dependent } from '@/lib/types';

/** Public selection IDs never confer access. Resolve names/permissions from current authorized lists. */
export async function validateBrowserSubject(
  params: URLSearchParams,
  signal: AbortSignal,
  actorId: string | null
) {
  if (
    ['browser_subject', 'dependent_id', 'owner_id', 'account_id'].some(
      (key) => params.getAll(key).length > 1
    )
  )
    throw new Error('The selected person is ambiguous.');
  if (!actorId || !params.get('account_id') || params.get('account_id') !== actorId)
    throw new Error('This handoff must be opened with the same account that started it.');
  const kind = params.get('browser_subject');
  const dependentId = params.get('dependent_id');
  const ownerId = params.get('owner_id');
  if (kind === 'self' && !dependentId && !ownerId) return { kind: 'self' as const };
  if (kind === 'dependent' && dependentId && !ownerId) {
    const res = await fetch('/api/dependents', { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Could not verify the selected person.');
    const dependent = ((await res.json()) as Dependent[]).find((item) => item.id === dependentId);
    if (dependent) return { kind: 'dependent' as const, dependent };
  } else if (kind === 'owner' && ownerId && !dependentId) {
    const res = await fetch('/api/delegates?type=received', { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Could not verify the selected person.');
    const delegate = ((await res.json()) as Delegate[]).find(
      (item) =>
        item.owner_id === ownerId &&
        item.status === 'accepted' &&
        (!item.expires_at || Date.parse(item.expires_at) > Date.now())
    );
    if (delegate) return { kind: 'owner' as const, delegate };
  }
  throw new Error(
    'This person is unavailable or your access has changed. Choose a person again in HealthTrack.'
  );
}
