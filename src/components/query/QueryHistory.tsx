'use client';

import type { QueryHistoryEntry } from '@/lib/types';

interface QueryHistoryProps {
  history: QueryHistoryEntry[];
  loading: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString();
}

function renderResponseText(text: string) {
  // Split into paragraphs and render with spacing
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs.map((para, i) => {
    // Handle single newlines within a paragraph as line breaks
    const lines = para.split('\n');
    return (
      <p key={i} className="mb-2 last:mb-0">
        {lines.map((line, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {line}
          </span>
        ))}
      </p>
    );
  });
}

export default function QueryHistory({ history, loading }: QueryHistoryProps) {
  if (loading) {
    return (
      <div
        className="rounded-xl border p-8 text-center"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <div className="flex items-center justify-center gap-2">
          <svg
            className="animate-spin h-4 w-4"
            style={{ color: 'var(--color-text-muted)' }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Loading query history...
          </span>
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div
        className="rounded-xl border p-8 text-center"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No queries yet. Ask a question about your health data to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {history.map((entry) => (
        <div
          key={entry.id || entry.created_at}
          className="rounded-xl border p-4"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          {/* Query */}
          <div className="mb-3">
            <p className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
              {entry.query_text}
            </p>
            <span className="text-xs mt-1 block" style={{ color: 'var(--color-text-muted)' }}>
              {formatRelativeTime(entry.created_at)}
            </span>
          </div>

          {/* Divider */}
          <div className="mb-3" style={{ borderTop: '1px solid var(--border-card)' }} />

          {/* Response */}
          <div className="text-sm leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
            {renderResponseText(entry.response_text)}
          </div>
        </div>
      ))}
    </div>
  );
}
