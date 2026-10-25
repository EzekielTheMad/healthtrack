'use client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useAndroidMode } from './AndroidMode';
import { useSession } from '@/lib/auth/client';

export function browserHandoffHref(
  path: string,
  dependentId: string | null,
  ownerId: string | null,
  accountId: string
) {
  const params = new URLSearchParams({ path, subject: 'self', account_id: accountId });
  if (dependentId) {
    params.set('dependent_id', dependentId);
    params.delete('subject');
  }
  if (ownerId) {
    params.set('owner_id', ownerId);
    params.delete('subject');
  }
  return `/mobile/browser?${params}`;
}
export default function BrowserHandoff({
  path,
  title,
  children,
}: {
  path: string;
  title: string;
  children?: React.ReactNode;
}) {
  const android = useAndroidMode();
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const { data: session, isPending } = useSession();
  if (!android) return children;
  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border-card)', backgroundColor: 'var(--bg-card)' }}
    >
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Continue in your browser for this workflow. The selected person is checked again before
        opening their records.
      </p>
      {session?.user.id ? (
        <a
          href={browserHandoffHref(path, dependentId, delegateOwnerId, session.user.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm"
          style={{ borderColor: 'var(--border-card)' }}
        >
          Open {title.toLowerCase()} in browser
        </a>
      ) : (
        <p role="status">
          {isPending ? 'Verifying account…' : 'Sign in again before opening a browser workflow.'}
        </p>
      )}
    </div>
  );
}
