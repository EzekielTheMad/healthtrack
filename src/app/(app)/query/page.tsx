'use client';

import { useCallback } from 'react';
import { useHealthQuery } from '@/hooks/useHealthQuery';
import { useCapabilities } from '@/hooks/useCapabilities';
import QueryInput from '@/components/query/QueryInput';
import QueryHistory from '@/components/query/QueryHistory';
import { OWNER_AI_NOTICE } from '@/hooks/useOwnerAiContext';

export default function QueryPage() {
  const { capabilities } = useCapabilities();
  const {
    queryHistory,
    loading,
    submitting,
    error,
    notice,
    canQuery,
    ownerId,
    isOwnerProfile,
    submitQuery,
    refreshLast,
  } = useHealthQuery(Boolean(capabilities?.ai));

  const handleRefresh = useCallback(async () => {
    await refreshLast();
  }, [refreshLast]);
  const handleSubmit = useCallback(
    async (query: string) => {
      await submitQuery(query);
    },
    [submitQuery]
  );

  if (!isOwnerProfile) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Health Query
        </h1>
        <p
          className="rounded-xl border p-6 text-sm"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-card)',
            color: 'var(--color-text-muted)',
          }}
        >
          {OWNER_AI_NOTICE}
        </p>
      </div>
    );
  }

  // AI not configured on this instance — the query UI would only ever 501.
  if (capabilities && !capabilities.ai) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Health Query
        </h1>
        <div
          className="rounded-xl border p-6 text-sm"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-card)',
            color: 'var(--color-text-muted)',
          }}
        >
          AI features are not configured on this instance. The administrator can enable health
          queries by setting the <code>ANTHROPIC_API_KEY</code> environment variable.
        </div>
      </div>
    );
  }

  if (!canQuery) {
    return (
      <p className="text-sm" role="status">
        Loading your My Health context...
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        Health Query
      </h1>

      {/* Desktop: two columns, Mobile: stacked */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* History - left on desktop, below on mobile */}
        <div className="order-2 lg:order-1 lg:flex-1 min-w-0">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            Query History
          </h2>
          <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            My Health answers use only your own records. Older answers are retained in storage but
            are not shown or reused because their profile context was not verified.
          </p>
          <QueryHistory history={queryHistory} loading={loading} />
        </div>

        {/* Input - right on desktop, top on mobile */}
        <div className="order-1 lg:order-2 lg:w-[400px] lg:flex-shrink-0">
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            Ask a Question
          </h2>
          <div
            className="rounded-xl border p-4 lg:sticky lg:top-4"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
          >
            <QueryInput key={ownerId} onSubmit={handleSubmit} loading={submitting} error={error} />

            {/* Dedupe notice: the answer came from saved history (no AI call).
                Offer a one-click fresh run in case the underlying data changed. */}
            {notice && !error && (
              <div
                className="mt-3 rounded-lg px-4 py-2.5 text-sm flex items-center justify-between gap-3"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--color-text-muted)',
                }}
              >
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={submitting}
                  className="text-xs font-medium underline hover:opacity-80 disabled:opacity-50 shrink-0"
                  style={{ color: 'var(--color-sage)' }}
                >
                  Get a fresh answer
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
