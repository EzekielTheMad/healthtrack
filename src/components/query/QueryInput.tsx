'use client';

import { useState, useCallback } from 'react';

const QUICK_QUERIES = [
  'Current medications',
  'Last lab results',
  'Sleep trends',
  'APAP compliance',
  'Drug interactions',
];

interface QueryInputProps {
  onSubmit: (query: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export default function QueryInput({ onSubmit, loading, error }: QueryInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = useCallback(
    async (text?: string) => {
      const queryText = (text ?? inputValue).trim();
      if (!queryText || loading) return;
      await onSubmit(queryText);
      setInputValue('');
    },
    [inputValue, loading, onSubmit]
  );

  const handlePillClick = useCallback(
    (pillText: string) => {
      setInputValue(pillText);
      handleSubmit(pillText);
    },
    [handleSubmit]
  );

  return (
    <div>
      {/* Input area */}
      <div
        className="rounded-xl border flex items-center gap-2 p-1"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
      >
        <input
          type="text"
          placeholder="Ask about your health data..."
          className="flex-1 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-text-muted"
          style={{ color: 'var(--color-text-primary)' }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={loading}
        />
        <button
          onClick={() => handleSubmit()}
          disabled={loading || inputValue.trim().length === 0}
          className="flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40"
          style={{
            backgroundColor: 'var(--color-sage)',
            color: 'var(--color-bark)',
          }}
        >
          {loading ? (
            <svg
              className="animate-spin h-4 w-4"
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
          ) : (
            'Ask'
          )}
        </button>
      </div>

      {/* Quick query pills */}
      <div className="flex flex-wrap gap-2 mt-3">
        {QUICK_QUERIES.map((q) => (
          <button
            key={q}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer hover:opacity-80"
            style={{
              backgroundColor: 'var(--bg-card)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--border-card)',
            }}
            onClick={() => handlePillClick(q)}
            disabled={loading}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Error display — calm, non-alarming. A failed AI query is a temporary
          hiccup, not a broken page, so use muted styling (not a red alert)
          and offer a quiet Retry. */}
      {error && (
        <div
          className="mt-3 rounded-lg px-4 py-3 text-sm flex items-center justify-between"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span>{error}</span>
          <button
            className="ml-3 text-xs font-medium underline hover:opacity-80"
            style={{ color: 'var(--color-text-muted)' }}
            onClick={() => handleSubmit()}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
