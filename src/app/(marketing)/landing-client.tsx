'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Feature data                                                       */
/* ------------------------------------------------------------------ */
const features = [
  {
    icon: '🧪',
    title: 'Lab PDF Parsing',
    description:
      'Upload lab PDFs and let AI extract results automatically. No more manual data entry.',
    color: 'var(--color-sage)',
  },
  {
    icon: '💊',
    title: 'Medication Tracking',
    description:
      'Track dosages, interactions, and refill dates. Get reminders so you never miss a dose.',
    color: 'var(--accent-purple)',
  },
  {
    icon: '📈',
    title: 'Vital Signs',
    description:
      'Connect your Oura Ring or manually log vitals. See trend charts over time.',
    color: 'var(--color-sage)',
  },
  {
    icon: '🤖',
    title: 'Health Query AI',
    description:
      'Ask questions about your health data in plain English and get clear, sourced answers.',
    color: 'var(--color-warning)',
  },
  {
    icon: '👨‍👩‍👧‍👦',
    title: 'Family Profiles',
    description:
      "Track dependents' health with age-based transitions. One account for the whole family.",
    color: 'var(--color-terracotta)',
  },
  {
    icon: '🔗',
    title: 'Secure Sharing',
    description:
      'Share specific health sections with providers or family members — on your terms.',
    color: 'var(--color-sage)',
  },
];

const steps = [
  {
    number: '01',
    title: 'Create your profile',
    description:
      'Sign in with your account or invite link, then add basic info like age, sex, and any known conditions.',
  },
  {
    number: '02',
    title: 'Add your health data',
    description:
      'Import medications, upload lab PDFs, log vitals, and track conditions — all in one place.',
  },
  {
    number: '03',
    title: 'Get AI-powered insights',
    description:
      'See trends, ask questions, and share reports with your care team.',
  },
];

const trustItems = [
  { icon: '🔒', label: 'End-to-end encryption' },
  { icon: '🏥', label: 'Privacy-first design' },
  { icon: '🛡️', label: 'Per-user data isolation' },
  { icon: '⏱️', label: 'Auto-logout after inactivity' },
  { icon: '✅', label: 'Your data, your control' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
/**
 * Client half of the landing page. `signupPolicy` comes from the server
 * wrapper (page.tsx): 'open' shows the classic "Get Started" flow, while
 * 'invite'/'closed' switch the CTAs to Sign In + an invite/self-host note —
 * otherwise visitors get marched into a registration form that rejects them.
 */
export default function LandingClient({
  signupPolicy,
}: {
  signupPolicy: 'open' | 'invite' | 'closed';
}) {
  const signupsOpen = signupPolicy === 'open';
  const featuresRef = useRef<HTMLDivElement>(null);

  // Signed-in redirect happens server-side in page.tsx — no client auth gate,
  // so the full page SSRs (content for crawlers, no spinner flash).

  /* Intersection-observer fade-in */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('fade-in-visible');
          }
        });
      },
      { threshold: 0.1 },
    );
    document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ background: 'var(--bg-primary)', color: 'var(--color-text-primary)' }}>
      {/* ---------- Inline styles for fade-in animation ---------- */}
      <style>{`
        .fade-in {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        }
        .fade-in-visible {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>

      {/* ---------- Nav ---------- */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md"
        style={{
          background: 'rgba(255, 251, 247, 0.85)',
          borderBottom: '1px solid var(--border-card)',
        }}
      >
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span
            className="text-xl font-bold"
            style={{ color: 'var(--color-sage)' }}
          >
            Health
          </span>
          <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            Track
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/EzekielTheMad/healthtrack"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-sm font-medium no-underline hover:underline"
            style={{ color: 'var(--color-text-muted)' }}
          >
            GitHub
          </a>
          <Link
            href="/login"
            className="px-5 py-2 rounded-full text-sm font-semibold no-underline transition-all hover:-translate-y-0.5"
            style={{
              background: 'transparent',
              color: 'var(--color-terracotta)',
              border: '2px solid var(--color-terracotta)',
            }}
          >
            Sign In
          </Link>
        </div>
      </nav>

      {/* ---------- Hero ---------- */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 pt-32 pb-20 md:pt-44 md:pb-28 overflow-hidden">
        {/* Gradient glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full blur-[160px] opacity-20 pointer-events-none"
          style={{ background: 'var(--color-soft-peach)' }}
        />

        <p
          className="text-sm font-semibold tracking-widest uppercase mb-4"
          style={{ color: 'var(--color-terracotta)' }}
        >
          Your health, organized
        </p>
        <h1 className="text-4xl md:text-6xl font-bold leading-tight max-w-3xl">
          Your Complete{' '}
          <span style={{ color: 'var(--color-terracotta)' }}>Health Dashboard</span>
        </h1>
        <p
          className="mt-6 text-lg md:text-xl max-w-2xl leading-relaxed"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Track medications, labs, vitals, and conditions — all in one secure
          place. Powered by AI so you can understand your health better.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mt-10">
          <Link
            href="/login"
            className="px-8 py-3.5 rounded-full text-base font-bold no-underline transition-all hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
          >
            {signupsOpen ? 'Get Started Free' : 'Sign In'}
          </Link>
          <button
            onClick={() =>
              featuresRef.current?.scrollIntoView({ behavior: 'smooth' })
            }
            className="px-8 py-3.5 rounded-[var(--radius-md)] text-base font-semibold cursor-pointer transition-all hover:-translate-y-0.5"
            style={{
              background: 'var(--color-cream)',
              color: 'var(--color-bark)',
              border: '2px solid var(--color-soft-peach)',
            }}
          >
            Learn More
          </button>
        </div>

        {!signupsOpen && (
          <p className="mt-6 text-sm max-w-md" style={{ color: 'var(--color-text-muted)' }}>
            {signupPolicy === 'invite'
              ? 'New accounts on this instance are invite-only — ask the person who runs it for an invite link.'
              : 'Registration on this instance is closed.'}{' '}
            Want your own?{' '}
            <a
              href="https://github.com/EzekielTheMad/healthtrack"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-80"
              style={{ color: 'var(--color-sage)' }}
            >
              HealthTrack is free and open source
            </a>
            .
          </p>
        )}

        {/* Mini dashboard mockup */}
        <div className="mt-16 w-full max-w-3xl grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Heart Rate', value: '72 bpm', color: 'var(--color-terracotta)' },
            { label: 'Sleep Score', value: '87', color: 'var(--accent-purple)' },
            { label: 'Medications', value: '3 active', color: 'var(--color-sage)' },
            { label: 'Lab Results', value: '12 tracked', color: 'var(--color-sage)' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl p-4 text-left"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
              }}
            >
              <p className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                {stat.label}
              </p>
              <p
                className="text-lg font-bold font-data"
                style={{ color: stat.color }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section
        ref={featuresRef}
        id="features"
        className="px-6 py-20 md:py-28"
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 fade-in">
            <p
              className="text-sm font-semibold tracking-widest uppercase mb-3"
              style={{ color: 'var(--color-sage)' }}
            >
              Features
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Everything you need to manage your health
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="fade-in rounded-xl p-6 transition-transform hover:-translate-y-1"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  transitionDelay: `${i * 80}ms`,
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl mb-4"
                  style={{ background: `${f.color}15` }}
                >
                  {f.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How It Works ---------- */}
      <section
        className="px-6 py-20 md:py-28"
        style={{ background: 'var(--bg-subtle)' }}
      >
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16 fade-in">
            <p
              className="text-sm font-semibold tracking-widest uppercase mb-3"
              style={{ color: 'var(--color-sage)' }}
            >
              How it works
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Get started in three simple steps
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <div
                key={s.number}
                className="fade-in text-center md:text-left"
                style={{ transitionDelay: `${i * 120}ms` }}
              >
                <span
                  className="inline-block text-4xl font-bold mb-4 font-data"
                  style={{ color: 'var(--color-sage)', opacity: 0.3 }}
                >
                  {s.number}
                </span>
                <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Trust / Security ---------- */}
      <section className="px-6 py-20 md:py-28">
        <div className="max-w-4xl mx-auto text-center">
          <div className="fade-in mb-12">
            <p
              className="text-sm font-semibold tracking-widest uppercase mb-3"
              style={{ color: 'var(--color-sage)' }}
            >
              Security & Privacy
            </p>
            <h2 className="text-3xl md:text-4xl font-bold">
              Built with privacy at the core
            </h2>
            <p
              className="mt-4 text-base max-w-xl mx-auto"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Your health data is sensitive. We designed HealthTrack from the
              ground up to keep it safe.
            </p>
          </div>

          <div className="fade-in flex flex-wrap justify-center gap-4">
            {trustItems.map((t) => (
              <div
                key={t.label}
                className="flex items-center gap-2 px-5 py-3 rounded-full text-sm font-medium"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                }}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA Banner ---------- */}
      <section className="px-6 py-20 md:py-28">
        <div
          className="fade-in max-w-4xl mx-auto rounded-2xl p-10 md:p-16 text-center relative overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
          }}
        >
          {/* Glow */}
          <div
            className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full blur-[120px] opacity-15 pointer-events-none"
            style={{ background: 'var(--color-sage)' }}
          />
          <h2 className="text-3xl md:text-4xl font-bold mb-4 relative z-10">
            Start tracking your health today
          </h2>
          <p
            className="text-base mb-8 max-w-md mx-auto relative z-10"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {signupsOpen
              ? 'Join HealthTrack and take control of your medications, labs, vitals, and more — completely free.'
              : 'Sign in to your account — or self-host your own free, open-source HealthTrack instance for your family.'}
          </p>
          <div className="relative z-10 flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/login"
              className="inline-block px-8 py-3.5 rounded-full text-base font-bold no-underline transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
            >
              {signupsOpen ? 'Get Started Free' : 'Sign In'}
            </Link>
            {!signupsOpen && (
              <a
                href="https://github.com/EzekielTheMad/healthtrack"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-8 py-3.5 rounded-full text-base font-semibold no-underline transition-all hover:-translate-y-0.5"
                style={{
                  background: 'var(--color-cream)',
                  color: 'var(--color-bark)',
                  border: '2px solid var(--color-soft-peach)',
                }}
              >
                Self-Host Your Own
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer
        className="px-6 py-8 text-center text-sm"
        style={{
          borderTop: '1px solid var(--border-card)',
          color: 'var(--color-text-muted)',
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="font-bold" style={{ color: 'var(--color-sage)' }}>
              Health
            </span>
            <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Track
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/privacy" className="no-underline hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Privacy Policy
            </Link>
            <Link href="/terms" className="no-underline hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Terms of Service
            </Link>
            <a
              href="https://github.com/EzekielTheMad/healthtrack"
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline hover:underline"
              style={{ color: 'var(--color-text-muted)' }}
            >
              GitHub
            </a>
            <a
              href="https://github.com/EzekielTheMad/healthtrack/blob/main/SECURITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline hover:underline"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Security
            </a>
            <a
              href="https://github.com/EzekielTheMad/healthtrack/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline hover:underline"
              style={{ color: 'var(--color-text-muted)' }}
            >
              MIT License
            </a>
          </div>
          <p className="max-w-xl mx-auto">
            HealthTrack helps you organize health information. It is not a medical device and does
            not provide medical advice — always consult a qualified healthcare professional.
          </p>
          <p>Built with privacy in mind</p>
          <p>&copy; 2026 HealthTrack. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
