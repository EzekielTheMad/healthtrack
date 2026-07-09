'use client';

import React, { useState } from 'react';

interface CategorySectionProps {
  /** Section heading, e.g. CATEGORY_LABELS[category]. */
  title: string;
  /** Number of metrics with data in this category (shown next to the title). */
  count: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

/**
 * Collapsible vitals category section (registry-driven — one per
 * MetricCategory with data). Collapse state is local and not persisted.
 */
export default function CategorySection({
  title,
  count,
  defaultExpanded = true,
  children,
}: CategorySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 mb-3 cursor-pointer text-left"
        style={{ color: 'var(--color-text-primary)' }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 transition-transform"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            color: 'var(--color-text-muted)',
          }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <h2 className="text-lg font-semibold">{title}</h2>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            color: 'var(--color-text-muted)',
          }}
        >
          {count} {count === 1 ? 'metric' : 'metrics'}
        </span>
      </button>
      {expanded && <div className="space-y-4">{children}</div>}
    </section>
  );
}
