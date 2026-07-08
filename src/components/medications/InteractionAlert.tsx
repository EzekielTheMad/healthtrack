'use client';

import { useState } from 'react';
import type { InteractionAlert as InteractionAlertType } from '@/lib/types';

interface InteractionAlertProps {
  alert: InteractionAlertType;
  onDismiss?: (id: string) => void;
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

export default function InteractionAlert({ alert, onDismiss }: InteractionAlertProps) {
  const [dismissed, setDismissed] = useState(alert.dismissed);

  if (dismissed) return null;

  const styles = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) {
      onDismiss(alert.id);
    }
  };

  return (
    <div
      className="rounded-xl border p-4 flex items-start gap-3"
      style={{
        backgroundColor: styles.bg,
        borderColor: styles.border,
      }}
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

      {/* Dismiss button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 rounded transition-colors cursor-pointer"
        style={{ color: 'var(--color-text-muted)' }}
        aria-label="Dismiss alert"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
