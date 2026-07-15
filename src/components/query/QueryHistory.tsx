'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { QueryHistoryEntry } from '@/lib/types';

interface QueryHistoryProps {
  history: QueryHistoryEntry[];
  loading: boolean;
}

// The AI answer is trusted, free-form markdown (bold, lists, headings, the odd
// table). We render it with react-markdown — no raw HTML is allowed, so this is
// injection-safe — and style each element to the app's design system rather
// than relying on a prose plugin (keeps it consistent with the CSS variables).
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1.5 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1.5 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h4>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
      style={{ color: 'var(--color-sage)' }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code
      className="rounded px-1 py-0.5 text-[0.85em] font-mono"
      style={{ backgroundColor: 'var(--bg-subtle)' }}
    >
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote
      className="border-l-2 pl-3 my-2 italic"
      style={{ borderColor: 'var(--border-card)', color: 'var(--color-text-secondary)' }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3" style={{ borderColor: 'var(--border-card)' }} />,
  // Tables can be wide — let them scroll horizontally rather than break layout.
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border px-2 py-1 text-left font-semibold" style={{ borderColor: 'var(--border-card)' }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border px-2 py-1" style={{ borderColor: 'var(--border-card)' }}>
      {children}
    </td>
  ),
};

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
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {entry.response_text}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}
