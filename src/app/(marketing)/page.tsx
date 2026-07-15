import { redirect } from 'next/navigation';
import { getSignupPolicy } from '@/lib/auth';
import { getUser } from '@/lib/auth/session';
import LandingClient from './landing-client';

/**
 * Must render per-request: the landing CTAs depend on the registration policy
 * (open / invite-only / closed) and signed-in visitors go straight to the
 * dashboard. Doing both checks server-side means the page fully SSRs (real
 * content for crawlers and no spinner flash) — the old client-side
 * useSession gate rendered only a spinner into the HTML.
 */
export const dynamic = 'force-dynamic';

export default async function MarketingPage() {
  const [user, signupPolicy] = await Promise.all([getUser(), getSignupPolicy()]);
  if (user) redirect('/dashboard');

  return <LandingClient signupPolicy={signupPolicy} />;
}
