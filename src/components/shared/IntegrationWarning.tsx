'use client';

import Link from 'next/link';
import { useIntegrationHealth } from '@/hooks/useIntegrationHealth';
import { useActiveProfile } from './ActiveProfileProvider';

export default function IntegrationWarning() {
  const { integrations } = useIntegrationHealth();
  const { dependentId, delegateOwnerId } = useActiveProfile();
  if (dependentId || delegateOwnerId) return null;
  const affected = integrations.filter((item) =>
    [
      'reconnect_required',
      'failed',
      'partial',
      'backoff',
      'stale',
      'delivery_error',
      'not_configured',
    ].includes(item.status)
  );
  if (!affected.length) return null;
  return (
    <div
      role="status"
      className="border rounded-lg px-4 py-2 text-sm mb-4"
      style={{ borderColor: 'var(--color-warning)', color: 'var(--color-text-primary)' }}
    >
      {affected.some((item) => item.status === 'reconnect_required')
        ? 'A device connection needs authorization. '
        : 'Some health feeds need attention. '}
      <Link href="/settings#integration-health" className="underline">
        Review integration health
      </Link>
    </div>
  );
}
