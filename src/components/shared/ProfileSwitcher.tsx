'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { useDependents } from '@/hooks/useDependents';
import { useDelegates } from '@/hooks/useDelegates';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import Link from 'next/link';
import type { DelegatePermissionLevel } from '@/lib/types';

const RELATIONSHIP_COLORS: Record<string, { bg: string; text: string }> = {
  child: { bg: 'rgba(167, 139, 250, 0.15)', text: 'var(--accent-purple)' },
  spouse: { bg: 'rgba(96, 165, 250, 0.15)', text: 'var(--color-sage)' },
  parent: { bg: 'rgba(129, 178, 154, 0.15)', text: 'var(--color-sage)' },
  sibling: { bg: 'rgba(251, 191, 36, 0.15)', text: 'var(--color-warning)' },
  other: { bg: 'rgba(155, 155, 155, 0.15)', text: 'var(--color-text-muted)' },
};

function permissionLabel(level: DelegatePermissionLevel): string {
  if (level === 'read_only') return 'Read Only';
  if (level === 'read_write') return 'Read & Write';
  return 'Admin';
}

export default function ProfileSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { dependents, loading, getAge, needsTransition } = useDependents();
  const { receivedDelegates, loading: delegatesLoading } = useDelegates();
  const {
    dependentId,
    dependentName,
    setActiveProfile,
    delegateOwnerId,
    delegateOwnerName,
    setDelegateProfile,
  } = useActiveProfile();
  const router = useRouter();

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const acceptedDelegates = receivedDelegates.filter((d) => d.status === 'accepted');

  // Determine display name
  let displayName = 'My Health';
  if (delegateOwnerName) {
    displayName = `${delegateOwnerName}'s Health`;
  } else if (dependentName) {
    displayName = dependentName;
  }

  const isOwnProfile = !dependentId && !delegateOwnerId;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        type="button"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          color: 'var(--color-text-primary)',
        }}
      >
        {/* Profile icon */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="5" r="3" stroke="var(--color-text-muted)" strokeWidth="1.5" />
          <path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>{displayName}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease',
          }}
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 w-64 rounded-xl border py-2 z-40"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-card)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* My Health (self) */}
          <button
            onClick={() => {
              setActiveProfile(null, null);
              setOpen(false);
            }}
            type="button"
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm cursor-pointer transition-colors"
            style={{
              backgroundColor: isOwnProfile ? 'var(--border-card)' : 'transparent',
              color: 'var(--color-text-primary)',
            }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
            >
              Me
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">My Health</div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Primary account
              </div>
            </div>
            {isOwnProfile && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5L6.5 12L13 4" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          {/* Divider */}
          {dependents.length > 0 && (
            <div className="my-1 mx-4" style={{ borderTop: '1px solid var(--border-card)' }} />
          )}

          {/* Dependent list */}
          {loading && (
            <div className="px-4 py-3">
              <div className="animate-pulse h-4 rounded" style={{ backgroundColor: 'var(--color-cream)' }} />
            </div>
          )}

          {!loading &&
            dependents.map((dep) => {
              const age = getAge(dep);
              const hasTransitionAlert = needsTransition(dep);
              const colors = RELATIONSHIP_COLORS[dep.relationship] ?? RELATIONSHIP_COLORS.other;

              return (
                <button
                  key={dep.id}
                  onClick={() => {
                    setActiveProfile(dep.id, dep.name);
                    setOpen(false);
                  }}
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm cursor-pointer transition-colors"
                  style={{
                    backgroundColor: dependentId === dep.id ? 'var(--border-card)' : 'transparent',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 relative"
                    style={{ backgroundColor: colors.bg, color: colors.text }}
                  >
                    {dep.name.charAt(0).toUpperCase()}
                    {hasTransitionAlert && (
                      <span
                        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: 'var(--color-warning)', border: '2px solid #171D2E' }}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {dep.name}
                      <span
                        className="inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: colors.bg, color: colors.text }}
                      >
                        {dep.relationship}
                      </span>
                    </div>
                    <div className="text-xs font-mono" style={{ color: 'var(--color-text-muted)' }}>
                      Age {age}
                    </div>
                  </div>
                  {dependentId === dep.id && (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5L6.5 12L13 4" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}

          {/* Delegated Accounts section */}
          {(delegatesLoading || acceptedDelegates.length > 0) && (
            <>
              <div className="my-1 mx-4" style={{ borderTop: '1px solid var(--border-card)' }} />
              <div
                className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Delegated Accounts
              </div>
            </>
          )}

          {delegatesLoading && acceptedDelegates.length === 0 && (
            <div className="px-4 py-3">
              <div className="animate-pulse h-4 rounded" style={{ backgroundColor: 'var(--color-cream)' }} />
            </div>
          )}

          {!delegatesLoading &&
            acceptedDelegates.map((del) => {
              const ownerName = del.owner_display_name ?? `User (${del.owner_id.slice(0, 8)}...)`;
              const isActive = delegateOwnerId === del.owner_id;

              return (
                <button
                  key={del.id}
                  onClick={() => {
                    setDelegateProfile(del.owner_id, ownerName, del.permission_level);
                    setOpen(false);
                  }}
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm cursor-pointer transition-colors"
                  style={{
                    backgroundColor: isActive ? 'var(--border-card)' : 'transparent',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, var(--color-sage), #4a7c69)', color: 'white' }}
                  >
                    {ownerName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {ownerName}&apos;s Health
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {permissionLabel(del.permission_level)}
                    </div>
                  </div>
                  {isActive && (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8.5L6.5 12L13 4" stroke="var(--color-sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}

          {/* Manage link */}
          <div className="mt-1 mx-4" style={{ borderTop: '1px solid var(--border-card)' }} />
          <Link
            href="/settings#dependents"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm transition-colors"
            style={{ color: 'var(--color-sage)' }}
          >
            Manage Dependents
          </Link>

          {/* Log Out */}
          <div className="mx-4" style={{ borderTop: '1px solid var(--border-card)' }} />
          <button
            onClick={async () => {
              setOpen(false);
              await authClient.signOut();
              window.location.href = '/login';
            }}
            type="button"
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium cursor-pointer transition-colors"
            style={{ color: 'var(--color-terracotta)', backgroundColor: 'transparent' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
