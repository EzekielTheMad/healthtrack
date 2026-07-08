'use client';

import { useOura } from '@/hooks/useOura';

interface ConnectSourcesStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ConnectSourcesStep({ onNext }: ConnectSourcesStepProps) {
  const { connected, loading, connect } = useOura();

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        Connect Sources
      </h2>
      <p className="text-sm mb-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
        Link your health devices and apps for automatic data sync.
      </p>

      <div className="w-full space-y-3 mb-8">
        {/* Oura Ring */}
        <div
          className="flex items-center justify-between rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 mt-0.5" style={{ color: 'var(--color-sage)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                Oura Ring
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                Sleep, HRV, heart rate, and more
              </p>
            </div>
          </div>

          {loading ? (
            <span className="shrink-0 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Checking...
            </span>
          ) : connected ? (
            <span
              className="shrink-0 flex items-center gap-1.5 text-sm font-medium"
              style={{ color: 'var(--color-sage)' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Connected
            </span>
          ) : (
            <button
              type="button"
              onClick={connect}
              className="shrink-0 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer hover:opacity-90"
              style={{ backgroundColor: 'var(--color-sage)', color: 'var(--color-bark)' }}
            >
              Connect
            </button>
          )}
        </div>

        {/* Samsung Health */}
        <div
          className="flex items-center justify-between rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 mt-0.5" style={{ color: 'var(--color-sage)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                Samsung Health
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                Steps, heart rate, sleep via Health Connect
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled
            className="shrink-0 px-4 py-1.5 rounded-lg text-xs font-medium cursor-not-allowed opacity-50"
            style={{ backgroundColor: 'var(--color-cream)', color: 'var(--color-text-muted)' }}
          >
            Coming soon
          </button>
        </div>

        {/* Manual Entry */}
        <div
          className="flex items-center justify-between rounded-xl border p-5"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 mt-0.5" style={{ color: 'var(--color-sage)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                Manual Entry
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                Track any metric manually
              </p>
            </div>
          </div>
          <span
            className="shrink-0 flex items-center gap-1.5 text-sm font-medium"
            style={{ color: 'var(--color-sage)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Available
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onNext}
          className="px-8 py-3 rounded-lg font-medium text-sm transition-colors hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          Continue
        </button>
        <button
          type="button"
          onClick={onNext}
          className="text-sm underline transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
