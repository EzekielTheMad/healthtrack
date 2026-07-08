'use client';

import { useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { Profile } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GettingStartedChecklistProps {
  profile: Profile | null;
  medicationCount: number;
  conditionCount: number;
  vitalCount: number;
  labVisitCount: number;
  providerCount: number;
  loading: boolean;
}

interface ChecklistItem {
  id: string;
  label: string;
  href: string;
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'healthtrack-getting-started-dismissed';
const DISMISSED_ITEMS_KEY = 'healthtrack-getting-started-dismissed-items';

// ---------------------------------------------------------------------------
// localStorage as an external store
//
// The dismissal flags live in localStorage, so we read them through
// useSyncExternalStore instead of mirroring them into state from an effect.
// The `storage` event covers cross-tab writes; the custom event covers
// same-tab writes made through writeLocalStorage below.
// ---------------------------------------------------------------------------

const LOCAL_STORAGE_EVENT = 'healthtrack-local-storage';

function subscribeToLocalStorage(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(LOCAL_STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(LOCAL_STORAGE_EVENT, callback);
  };
}

function writeLocalStorage(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT));
}

function useLocalStorageItem(key: string, serverFallback: string | null = null) {
  return useSyncExternalStore(
    subscribeToLocalStorage,
    () => localStorage.getItem(key),
    () => serverFallback,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GettingStartedChecklist({
  profile,
  medicationCount,
  conditionCount,
  vitalCount,
  labVisitCount,
  providerCount,
  loading,
}: GettingStartedChecklistProps) {
  // Server fallback 'true' keeps the checklist hidden until hydration to
  // avoid a flash (same as the old `useState(true)` default).
  const dismissed = useLocalStorageItem(DISMISS_KEY, 'true') === 'true';
  const dismissedItemsRaw = useLocalStorageItem(DISMISSED_ITEMS_KEY);
  const dismissedItems = useMemo(() => {
    if (!dismissedItemsRaw) return new Set<string>();
    try {
      return new Set<string>(JSON.parse(dismissedItemsRaw));
    } catch {
      // ignore bad data
      return new Set<string>();
    }
  }, [dismissedItemsRaw]);

  const items: ChecklistItem[] = [
    {
      id: 'profile',
      label: 'Complete your profile',
      href: '/settings',
      complete: !!(profile?.display_name && profile?.date_of_birth),
    },
    {
      id: 'medication',
      label: 'Add your first medication',
      href: '/medications',
      complete: medicationCount > 0,
    },
    {
      id: 'condition',
      label: 'Log a health condition',
      href: '/conditions',
      complete: conditionCount > 0,
    },
    {
      id: 'vital',
      label: 'Record a vital sign',
      href: '/vitals',
      complete: vitalCount > 0,
    },
    {
      id: 'lab',
      label: 'Upload lab results',
      href: '/labs',
      complete: labVisitCount > 0,
    },
    {
      id: 'provider',
      label: 'Add a healthcare provider',
      href: '/settings',
      complete: providerCount > 0,
    },
  ];

  const visibleItems = items.filter((i) => !dismissedItems.has(i.id));
  const completedCount = visibleItems.filter((i) => i.complete).length;
  const totalCount = visibleItems.length;
  const allComplete = totalCount > 0 && completedCount === totalCount;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

  // Celebration state is fully derived: it shows while everything is
  // complete and the card hasn't been dismissed yet.
  const celebrating = allComplete && !dismissed;

  // Auto-dismiss when all complete
  useEffect(() => {
    if (allComplete && !dismissed) {
      const timer = setTimeout(() => {
        writeLocalStorage(DISMISS_KEY, 'true');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [allComplete, dismissed]);

  const handleDismiss = useCallback(() => {
    writeLocalStorage(DISMISS_KEY, 'true');
  }, []);

  const handleDismissItem = useCallback((itemId: string) => {
    let items: string[] = [];
    const stored = localStorage.getItem(DISMISSED_ITEMS_KEY);
    if (stored) {
      try {
        items = JSON.parse(stored);
      } catch {
        // ignore bad data
      }
    }
    if (!items.includes(itemId)) items.push(itemId);
    writeLocalStorage(DISMISSED_ITEMS_KEY, JSON.stringify(items));
  }, []);

  // Don't render if dismissed, no visible items, or still loading
  if (dismissed || loading || totalCount === 0) return null;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      {/* Progress bar */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: 'var(--color-cream)' }}
      >
        <div
          className="h-1 transition-all duration-500 ease-out rounded-r"
          style={{
            backgroundColor: 'var(--color-sage)',
            width: `${progressPercent}%`,
          }}
        />
      </div>

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2
              className="text-lg font-semibold"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'DM Sans, sans-serif' }}
            >
              Getting Started
            </h2>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{
                color: 'var(--color-sage)',
                backgroundColor: 'rgba(74, 222, 128, 0.12)',
              }}
            >
              {completedCount} of {totalCount} complete
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="text-xs font-medium px-2 py-1 rounded transition-colors hover:opacity-80"
            style={{
              color: 'var(--color-text-muted)',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>

        {/* Celebration message */}
        {celebrating && (
          <div
            className="rounded-lg px-4 py-3 text-sm font-medium text-center"
            style={{
              backgroundColor: 'rgba(74, 222, 128, 0.12)',
              color: 'var(--color-sage)',
            }}
          >
            You&apos;re all set! 🎉
          </div>
        )}

        {/* Checklist items */}
        {!celebrating && (
          <ul className="space-y-1">
            {visibleItems.map((item) => (
              <li key={item.id}>
                {item.complete ? (
                  <div
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                    style={{ backgroundColor: 'rgba(74, 222, 128, 0.06)' }}
                  >
                    {/* Green check circle */}
                    <div
                      className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: 'var(--color-sage)' }}
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="var(--bg-primary)"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <span
                      className="text-sm"
                      style={{ color: 'var(--color-sage)', textDecoration: 'line-through', opacity: 0.7 }}
                    >
                      {item.label}
                    </span>
                  </div>
                ) : (
                  <div
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--color-cream)' }}
                  >
                    <Link
                      href={item.href}
                      className="flex items-center gap-3 flex-1 no-underline hover:opacity-90"
                    >
                      {/* Empty circle */}
                      <div
                        className="shrink-0 w-5 h-5 rounded-full border-2"
                        style={{ borderColor: 'var(--color-terracotta)' }}
                      />
                      <span
                        className="text-sm font-medium"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {item.label}
                      </span>
                      {/* Arrow icon */}
                      <svg
                        className="shrink-0 w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="var(--color-terracotta)"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </Link>
                    {/* Per-item dismiss button */}
                    <button
                      onClick={() => handleDismissItem(item.id)}
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full transition-colors hover:opacity-70 cursor-pointer"
                      style={{ color: 'var(--color-text-muted)', backgroundColor: 'transparent', border: 'none' }}
                      aria-label={`Dismiss "${item.label}"`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
