"use client";

import { authClient } from "@/lib/auth/client";
import { useState } from "react";
import type { FormEvent } from "react";

type AuthMode = "login" | "signup";

interface LoginFormProps {
  /** Google OAuth is configured on the server (GOOGLE_CLIENT_ID/SECRET set). */
  googleEnabled: boolean;
  /** New registrations are open (SIGNUPS_ENABLED !== 'false'). */
  signupsEnabled: boolean;
}

export default function LoginForm({ googleEnabled, signupsEnabled }: LoginFormProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  async function handleOAuth(provider: "google") {
    setError(null);
    setLoadingProvider(provider);
    const { error: oauthError } = await authClient.signIn.social({
      provider,
      callbackURL: "/dashboard",
    });
    if (oauthError) {
      setError(oauthError.message ?? "Google sign-in failed.");
      setLoadingProvider(null);
    }
  }

  async function handleEmailAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoadingProvider("email");

    if (mode === "login") {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message ?? "Sign-in failed.");
        setLoadingProvider(null);
        return;
      }
    } else {
      const { error: signUpError } = await authClient.signUp.email({
        name: name.trim() || email.split("@")[0],
        email,
        password,
      });
      if (signUpError) {
        setError(signUpError.message ?? "Sign-up failed.");
        setLoadingProvider(null);
        return;
      }
    }

    // Better Auth signs the user in on both flows (no email confirmation
    // step on a self-hosted instance). Full navigation so the proxy sees
    // the fresh session cookie.
    window.location.href = "/dashboard";
  }

  const isLoading = loadingProvider !== null;

  return (
    <div className="flex flex-col gap-8">
      {/* Branding */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-accent-green">HealthTrack</h1>
        <p className="mt-1 text-sm text-text-muted">
          {mode === "login" ? "Sign in to your account" : "Create a new account"}
        </p>
      </div>

      {/* OAuth Buttons */}
      {googleEnabled && (
        <>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleOAuth("google")}
              className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-[var(--border-card)] bg-[var(--color-cream)] px-4 py-3.5 text-sm font-semibold text-text-primary transition-all hover:shadow-[var(--shadow-soft)] hover:-translate-y-0.5 disabled:opacity-50"
            >
              {loadingProvider === "google" ? <Spinner /> : <GoogleIcon />}
              Sign in with Google
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-bg-subtle" />
            <span className="text-xs text-text-muted">or continue with email</span>
            <div className="h-px flex-1 bg-bg-subtle" />
          </div>
        </>
      )}

      {/* Email Form */}
      <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
        {mode === "signup" && (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm text-text-muted">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-border-card bg-bg-primary px-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-accent-green"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-text-muted">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-border-card bg-bg-primary px-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-accent-green"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-text-muted">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-lg border border-border-card bg-bg-primary px-4 py-2.5 text-sm text-text-primary placeholder-text-muted outline-none transition-colors focus:border-accent-green"
          />
        </div>

        {error && (
          <p className="rounded-[var(--radius-md)] px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(224, 122, 95, 0.1)', color: 'var(--color-terracotta)' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center rounded-[var(--radius-pill)] px-7 py-3.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {loadingProvider === "email" ? (
            <Spinner dark />
          ) : mode === "login" ? (
            "Sign in"
          ) : (
            "Create account"
          )}
        </button>
      </form>

      {/* Toggle mode — hidden when the instance owner closed signups */}
      {signupsEnabled ? (
        <p className="text-center text-sm text-text-muted">
          {mode === "login" ? "Don’t have an account?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
            className="font-medium text-accent-green hover:underline"
          >
            {mode === "login" ? "Create account" : "Sign in"}
          </button>
        </p>
      ) : (
        <p className="text-center text-sm text-text-muted">
          New registrations are disabled on this instance.
        </p>
      )}
    </div>
  );
}

/* ---------- Inline icons ---------- */

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${dark ? "text-text-primary" : "text-text-primary"}`}
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
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
