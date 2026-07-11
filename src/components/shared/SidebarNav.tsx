'use client';

import React from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth/client';
import { useCapabilities } from '@/hooks/useCapabilities';

interface SidebarNavProps {
  activePath: string;
}

const mainLinks = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    label: 'Medications',
    href: '/medications',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.5 1.5l3 3-8.5 8.5a3 3 0 01-4.24-4.24l8.5-8.5z" transform="translate(4 4) scale(0.85)" />
        <path d="M4 20h16" />
      </svg>
    ),
  },
  {
    label: 'Labs',
    href: '/labs',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3h6v6l4 8H5l4-8V3z" />
        <path d="M9 3h6" />
      </svg>
    ),
  },
  {
    label: 'Vitals',
    href: '/vitals',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    label: 'Fitness',
    href: '/fitness',
    icon: (
      // Dumbbell
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 6.5v11M17.5 6.5v11" />
        <path d="M3 9v6M21 9v6" />
        <path d="M6.5 12h11" />
      </svg>
    ),
  },
  {
    label: 'Conditions',
    href: '/conditions',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
      </svg>
    ),
  },
  {
    label: 'Allergies',
    href: '/allergies',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
        <path d="M12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  {
    label: 'Procedures',
    href: '/procedures',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    label: 'Notes',
    href: '/notes',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
];

const settingsLink = {
  label: 'Settings',
  href: '/settings',
  icon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
};

function NavLink({ href, label, icon, isActive }: { href: string; label: string; icon: React.ReactNode; isActive: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
      style={{
        color: isActive ? 'var(--color-sage)' : 'var(--color-text-muted)',
        backgroundColor: isActive ? 'rgba(129, 178, 154, 0.1)' : 'transparent',
      }}
    >
      {icon}
      {label}
    </Link>
  );
}

export default function SidebarNav({ activePath }: SidebarNavProps) {
  const { capabilities } = useCapabilities();
  // /query is AI-backed — hide it when the instance has no ANTHROPIC_API_KEY.
  const links =
    capabilities?.ai === false
      ? mainLinks.filter((l) => l.href !== '/query')
      : mainLinks;

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.href = '/login';
  };

  return (
    <aside
      className="hidden md:flex fixed left-0 top-0 bottom-0 w-60 flex-col z-40"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRight: '1px solid var(--border-card)',
      }}
    >
      {/* App name */}
      <div className="px-5 py-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Health<span style={{ color: 'var(--color-sage)' }}>Track</span>
        </h1>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {links.map((link) => (
          <NavLink
            key={link.href}
            href={link.href}
            label={link.label}
            icon={link.icon}
            isActive={activePath === link.href}
          />
        ))}
      </nav>

      {/* Settings & Logout at bottom */}
      <div className="px-3 pb-4 space-y-1" style={{ borderTop: '1px solid var(--border-card)', paddingTop: '12px' }}>
        <NavLink
          href={settingsLink.href}
          label={settingsLink.label}
          icon={settingsLink.icon}
          isActive={activePath === settingsLink.href}
        />
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
          style={{ color: 'var(--color-terracotta)', backgroundColor: 'transparent' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(224, 122, 95, 0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Log Out
        </button>
      </div>
    </aside>
  );
}
