'use client';

interface WelcomeProps {
  onNext: () => void;
  onBack: () => void;
}

const FEATURES = [
  {
    title: 'Medical History',
    description: 'Track medications, conditions, and appointments',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    title: 'Lab Results',
    description: 'Upload PDFs, track trends, spot flags',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: 'Smart Insights',
    description: 'Ask questions about your health data',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
] as const;

export function Welcome({ onNext }: WelcomeProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-4xl font-bold mb-2" style={{ color: 'var(--color-sage)' }}>
        HealthTrack
      </h1>
      <p className="text-lg mb-10" style={{ color: 'var(--color-text-muted)' }}>
        Your health data, unified.
      </p>

      <div className="grid gap-4 w-full mb-10">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="flex items-start gap-4 p-5 rounded-xl border text-left"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-card)',
            }}
          >
            <div className="shrink-0 mt-0.5" style={{ color: 'var(--color-sage)' }}>
              {feature.icon}
            </div>
            <div>
              <h2 className="font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {feature.title}
              </h2>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {feature.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onNext}
        className="px-8 py-3 rounded-lg font-medium text-sm transition-colors hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
      >
        Get Started
      </button>
    </div>
  );
}
