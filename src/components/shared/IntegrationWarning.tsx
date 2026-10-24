'use client';

import Link from 'next/link';
import { useIntegrationHealth } from '@/hooks/useIntegrationHealth';
import {
  integrationLink,
  integrationWarning,
  needsIntegrationAttention,
} from '@/lib/integrations/presentation';
import { useActiveProfile } from './ActiveProfileProvider';

export default function IntegrationWarning() {
  const { integrations, error } = useIntegrationHealth();
  const { dependentId, delegateOwnerId } = useActiveProfile();
  if (dependentId || delegateOwnerId || error) return null;
  const affected = integrations.filter(needsIntegrationAttention);
  if (!affected.length) return null;
  return (
    <div
      role="status"
      className="border rounded-lg px-4 py-2 text-sm mb-4 space-y-1"
      style={{ borderColor: 'var(--color-warning)', color: 'var(--color-text-primary)' }}
    >
      {affected.map((item) => (
        <p key={item.source}>
          {integrationWarning(item)}{' '}
          <Link href={integrationLink(item.source)} className="underline inline-block py-2">
            Review {item.label}
          </Link>
        </p>
      ))}
    </div>
  );
}
