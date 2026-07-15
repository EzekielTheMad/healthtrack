'use client';

import { useState } from 'react';
import type { InteractionAlert as InteractionAlertType } from '@/lib/types';

interface InteractionAlertProps {
  alert: InteractionAlertType;
  onSnooze?: (id: string, days: number) => void;
}

const SEVERITY_STYLES: Record<string, { border: string; bg: string; badgeColor: string; badgeBg: string }> = {
  info: {
    border: 'var(--color-sage)',
    bg: 'rgba(129, 178, 154, 0.05)',
    badgeColor: 'var(--color-sage)',
    badgeBg: 'rgba(129, 178, 154, 0.15)',
  },
  warning: {
    border: 'var(--color-warning)',
    bg: 'rgba(233, 196, 106, 0.05)',
    badgeColor: 'var(--color-warning)',
    badgeBg: 'rgba(233, 196, 106, 0.15)',
  },
  critical: {
    border: 'var(--color-terracotta)',
    bg: 'rgba(224, 122, 95, 0.05)',
    badgeColor: 'var(--color-terracotta)',
    badgeBg: 'rgba(224, 122, 95, 0.15)',
  },
};

// Snooze durations offered per severity. Warnings/critical cap at a week so a
// real interaction can't be hidden for a month (mirrors the server-side cap).
const SNOOZE_OPTIONS: { label: string; days: number }[] = [
  { label: '1 day', days: 1 },
  { label: '1 week', days: 7 },
  { label: '30 days', days: 30 },
];

function snoozeOptionsFor(severity: string) {
  return severity === 'info' ? SNOOZE_OPTIONS : SNOOZE_OPTIONS.filter((o) => o.days <= 7);
}

export default function InteractionAlert({ alert, onSnooze }: InteractionAlertProps) {
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (hidden) return null;

  const styles = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;

  const handleSnooze = (days: number) => {
    setMenuOpen(false);
    setHidden(true);
    onSnooze?.(alert.id, days);
  };

  return (
    <div
      className="rounded-xl border p-4 flex items-start gap-3"
      style={{ backgroundColor: styles.bg, borderColor: styles.border }}
      role="alert"
      aria-label={`${alert.severity} medication interaction alert`}
    >
      {/* Warning icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        style={{ color: styles.border }}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>

      <div className="flex-1 min-w-0">
        {/* Severity badge */}
        <span
          className="inline-block text-xs font-medium px-2 py-0.5 rounded-full uppercase mb-1"
          style={{ color: styles.badgeColor, backgroundColor: styles.badgeBg }}
        >
          {alert.severity}
        </span>

        <p className="text-sm mt-1" style={{ color: 'var(--color-text-primary)' }}>
          {alert.alert_text}
        </p>
      </div>

      {/* Snooze control */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="text-xs font-medium px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
          style={{ color: 'var(--color-text-muted)' }}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Snooze alert"
        >
          Snooze
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-1 z-10 rounded-lg border py-1 min-w-[7rem] shadow-lg"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            {snoozeOptionsFor(alert.severity).map((opt) => (
              <button
                key={opt.days}
                type="button"
                role="menuitem"
                onClick={() => handleSnooze(opt.days)}
                className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-80 cursor-pointer"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
