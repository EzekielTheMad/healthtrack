'use client';

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
/** Legacy wrapper: online workflows now stay in the current website context. */
export default function BrowserHandoff({
  children,
}: {
  path: string;
  title: string;
  children?: React.ReactNode;
}) {
  return children;
}
