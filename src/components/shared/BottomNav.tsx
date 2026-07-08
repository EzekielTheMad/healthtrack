'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth/client';
import { useCapabilities } from '@/hooks/useCapabilities';

interface BottomNavProps {
  activePath: string;
}

const iconSize = 18;

const moreLinks = [
  {
    label: 'Medications',
    href: '/medications',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.5 1.5l3 3-8.5 8.5a3 3 0 01-4.24-4.24l8.5-8.5z" transform="translate(4 4) scale(0.85)" />
        <path d="M4 20h16" />
      </svg>
    ),
  },
  {
    label: 'Allergies',
    href: '/allergies',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
        <path d="M12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    label: 'Procedures',
    href: '/procedures',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'Vaccines',
    href: '/vaccines',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19.5 4.5l-1 1M17.5 6.5l-8 8M6 18l-2 2M3 21l3-3M9.5 14.5l-4 4" />
        <path d="M11 6.5l6.5 6.5" />
        <path d="M16.5 2L22 7.5l-2 2L14.5 4l2-2z" />
      </svg>
    ),
  },
  {
    label: 'Appointments',
    href: '/appointments',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    label: 'Notes',
    href: '/notes',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    label: 'Query',
    href: '/query',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
];

const tabs = [
  {
    label: 'Home',
    href: '/dashboard',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12L12 3l9 9" />
        <path d="M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9" />
      </svg>
    ),
  },
  {
    label: 'Health',
    href: '/conditions',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
      </svg>
    ),
  },
  {
    label: 'Labs',
    href: '/labs',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6v6l4 8H5l4-8V3z" />
        <path d="M9 3h6" />
      </svg>
    ),
  },
  {
    label: 'Vitals',
    href: '/vitals',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

export default function BottomNav({ activePath }: BottomNavProps) {
  const { capabilities } = useCapabilities();
  const [moreOpen, setMoreOpen] = useState(false);
  // /query is AI-backed — hide it when the instance has no ANTHROPIC_API_KEY.
  const visibleMoreLinks =
    capabilities?.ai === false
      ? moreLinks.filter((l) => l.href !== '/query')
      : moreLinks;

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.href = '/login';
  };

  return (
    <>
      {/* Backdrop for More menu */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More slide-up sheet */}
      {moreOpen && (
        <div
          className="fixed bottom-[56px] left-2 right-2 z-50 md:hidden rounded-xl border overflow-hidden max-h-[70vh] overflow-y-auto"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-card)',
            boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.3)',
          }}
        >
          {visibleMoreLinks.map((link, i) => (
            <React.Fragment key={link.href}>
              {i > 0 && <div style={{ borderTop: '1px solid var(--border-card)' }} />}
              <Link
                href={link.href}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 px-5 py-3 text-sm font-medium no-underline transition-colors"
                style={{ color: activePath === link.href ? 'var(--color-sage)' : 'var(--color-text-primary)' }}
              >
                {link.icon}
                {link.label}
              </Link>
            </React.Fragment>
          ))}
          <div style={{ borderTop: '1px solid var(--border-card)' }} />
          <button
            onClick={handleLogout}
            type="button"
            className="flex w-full items-center gap-3 px-5 py-3 text-sm font-medium cursor-pointer transition-colors"
            style={{ color: 'var(--color-terracotta)', backgroundColor: 'transparent' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log Out
          </button>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around px-2 py-2"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderTop: '1px solid var(--border-card)',
        }}
      >
        {tabs.map((tab) => {
          const isActive = activePath === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center gap-0.5 px-2 py-1 transition-colors"
              style={{ color: isActive ? 'var(--color-sage)' : 'var(--color-text-muted)' }}
            >
              {tab.icon}
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
        {/* More button */}
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex flex-col items-center gap-0.5 px-2 py-1 transition-colors cursor-pointer"
          style={{
            color: moreOpen || visibleMoreLinks.some((l) => activePath === l.href)
              ? 'var(--color-sage)'
              : 'var(--color-text-muted)',
            background: 'none',
            border: 'none',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
}
