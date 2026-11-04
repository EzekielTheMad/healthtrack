'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth/client';
import { useCapabilities } from '@/hooks/useCapabilities';

const tabs = [
  { label: 'Today', href: '/dashboard', glyph: '⌂' },
  { label: 'Health', href: '/health', glyph: '♡' },
  { label: 'Fitness', href: '/fitness', glyph: '↗' },
  { label: 'Nutrition', href: '/nutrition', glyph: '◒' },
];
const healthRoutes = [
  '/health',
  '/medications',
  '/conditions',
  '/allergies',
  '/procedures',
  '/vaccines',
  '/labs',
  '/vitals',
  '/mobile/doctor',
];
const moreLinks = [
  { label: 'Doctor Essentials', href: '/mobile/doctor' },
  { label: 'Appointments', href: '/appointments' },
  { label: 'Notes', href: '/notes' },
  { label: 'Health Query', href: '/query' },
  { label: 'Phone & sync', href: '/mobile/devices' },
  { label: 'Settings', href: '/settings' },
];

export default function BottomNav({ activePath }: { activePath: string }) {
  const { capabilities } = useCapabilities();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const visibleMoreLinks = moreLinks.filter(
    (link) => capabilities?.ai !== false || link.href !== '/query'
  );
  useEffect(() => {
    if (!moreOpen) return;
    closeRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        moreRef.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [moreOpen]);
  return (
    <>
      {moreOpen && (
        <button
          type="button"
          aria-label="Dismiss more navigation"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}
      {moreOpen && (
        <section
          id="mobile-more"
          aria-label="More navigation"
          className="fixed bottom-[calc(68px+env(safe-area-inset-bottom))] left-2 right-2 z-50 md:hidden rounded-xl border overflow-y-auto max-h-[70dvh] p-2"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <div className="flex items-center justify-between px-3">
            <h2 className="font-semibold">More</h2>
            <button
              ref={closeRef}
              className="min-h-11 px-3"
              type="button"
              onClick={() => {
                setMoreOpen(false);
                moreRef.current?.focus();
              }}
            >
              Close
            </button>
          </div>
          {visibleMoreLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMoreOpen(false)}
              className="flex min-h-11 items-center rounded-lg px-3 py-3 text-sm"
              aria-current={activePath === link.href ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            className="min-h-11 w-full px-3 text-left text-sm"
            style={{ color: 'var(--color-terracotta)' }}
            onClick={async () => {
              await authClient.signOut();
              // Full navigation discards account/subject state after session revocation.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = '/login';
            }}
          >
            Log out
          </button>
        </section>
      )}
      <nav
        aria-label="Primary mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around px-1 pt-1 pb-[max(4px,env(safe-area-inset-bottom))]"
        style={{ backgroundColor: 'var(--bg-card)', borderTop: '1px solid var(--border-card)' }}
      >
        {tabs.map((tab) => {
          const active =
            tab.href === '/health'
              ? healthRoutes.some(
                  (route) => activePath === route || activePath.startsWith(`${route}/`)
                )
              : activePath === tab.href || activePath.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 px-1"
              style={{ color: active ? 'var(--color-sage)' : 'var(--color-text-muted)' }}
            >
              <span aria-hidden="true" className="text-xl leading-6">
                {tab.glyph}
              </span>
              <span className="text-[11px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
        <button
          ref={moreRef}
          type="button"
          aria-expanded={moreOpen}
          aria-controls="mobile-more"
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex min-h-14 min-w-14 flex-col items-center justify-center gap-0.5 px-1"
          style={{ color: moreOpen ? 'var(--color-sage)' : 'var(--color-text-muted)' }}
        >
          <span aria-hidden="true" className="text-xl leading-6">
            ···
          </span>
          <span className="text-[11px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
}
