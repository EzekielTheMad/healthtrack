'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Welcome } from '@/components/onboarding/Welcome';
import { AuthStep } from '@/components/onboarding/AuthStep';
import { ProfileStep } from '@/components/onboarding/ProfileStep';
import { ConnectSourcesStep } from '@/components/onboarding/ConnectSourcesStep';
import { DashboardStatsStep } from '@/components/onboarding/DashboardStatsStep';
import { LabsMedsStep } from '@/components/onboarding/LabsMedsStep';

const TOTAL_STEPS = 6;

const STEP_LABELS = [
  'Welcome',
  'Authentication',
  'Profile',
  'Connect Sources',
  'Dashboard Stats',
  'Labs & Medications',
] as const;

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const router = useRouter();

  const handleNext = useCallback(() => {
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1);
    } else {
      router.push('/dashboard');
    }
  }, [step, router]);

  const handleBack = useCallback(() => {
    if (step > 1) {
      setStep((s) => s - 1);
    }
  }, [step]);

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Progress bar */}
      <nav aria-label="Onboarding progress" className="mb-8 w-full max-w-xl">
        <ol className="flex items-center justify-center gap-3">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const stepNum = i + 1;
            const isCompleted = stepNum < step;
            const isCurrent = stepNum === step;

            return (
              <li key={stepNum} className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-3 h-3 rounded-full transition-colors ${
                      isCompleted
                        ? 'bg-accent-green'
                        : isCurrent
                          ? 'bg-accent-green ring-2 ring-accent-green/40 ring-offset-2 ring-offset-bg-primary'
                          : 'bg-bg-subtle'
                    }`}
                    aria-current={isCurrent ? 'step' : undefined}
                  />
                  <span className="sr-only">
                    {STEP_LABELS[i]}
                    {isCompleted ? ' (completed)' : isCurrent ? ' (current)' : ''}
                  </span>
                </div>
                {stepNum < TOTAL_STEPS && (
                  <div
                    className={`w-8 h-0.5 ${
                      isCompleted ? 'bg-accent-green' : 'bg-bg-subtle'
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>
        <p className="text-center text-sm mt-3" style={{ color: 'var(--color-text-muted)' }}>
          Step {step} of {TOTAL_STEPS}: {STEP_LABELS[step - 1]}
        </p>
      </nav>

      {/* Step content */}
      <div className="w-full max-w-xl flex-1">
        {step === 1 && <Welcome onNext={handleNext} onBack={handleBack} />}
        {step === 2 && <AuthStep onNext={handleNext} onBack={handleBack} />}
        {step === 3 && <ProfileStep onNext={handleNext} onBack={handleBack} />}
        {step === 4 && <ConnectSourcesStep onNext={handleNext} onBack={handleBack} />}
        {step === 5 && <DashboardStatsStep onNext={handleNext} onBack={handleBack} />}
        {step === 6 && <LabsMedsStep onNext={handleNext} onBack={handleBack} />}
      </div>

      {/* Navigation buttons */}
      <div className="w-full max-w-xl flex justify-between mt-8">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 1}
          className="px-6 py-2.5 rounded-[var(--radius-md)] text-sm font-semibold transition-all hover:-translate-y-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            color: 'var(--color-bark)',
            backgroundColor: 'var(--color-cream)',
            border: '2px solid var(--color-soft-peach)',
          }}
        >
          Back
        </button>
        {step < TOTAL_STEPS && (
          <button
            type="button"
            onClick={handleNext}
            className="px-6 py-2.5 rounded-full text-sm font-bold transition-all hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
              color: 'white',
              boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
            }}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
