'use client';
import Link from 'next/link';
import ProfileSwitcher from '@/components/shared/ProfileSwitcher';
import { useIntegrationHealth } from '@/hooks/useIntegrationHealth';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { needsIntegrationAttention } from '@/lib/integrations/presentation';
export default function MobileHeader() {
  const { integrations, loading, error } = useIntegrationHealth();
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const attention = integrations.some(needsIntegrationAttention);
  return (
    <header className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold md:hidden">HealthTrack</span>
        <div className="ml-auto">
          <ProfileSwitcher />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:hidden">
        <Link
          href="/mobile/doctor"
          className="flex min-h-11 items-center rounded-lg border px-3 text-sm"
          style={{ borderColor: 'var(--border-card)' }}
        >
          Doctor Essentials
        </Link>
        <Link
          href="/mobile/devices"
          className="flex min-h-11 items-center rounded-lg border px-3 text-sm"
          style={{ borderColor: 'var(--border-card)' }}
        >
          {dependentId || delegateOwnerId
            ? 'Phone sync · account owner'
            : loading
              ? 'Sync · checking'
              : error
                ? 'Sync · unavailable'
                : attention
                  ? 'Sync · review needed'
                  : 'Sync status'}
        </Link>
      </div>
    </header>
  );
}
