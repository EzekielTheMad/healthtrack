import { getSignupPolicy } from '@/lib/auth';
import LandingClient from './landing-client';

/**
 * Must render per-request: the landing CTAs depend on the registration policy
 * (open / invite-only / closed), which reads env + the live user count.
 */
export const dynamic = 'force-dynamic';

export default async function MarketingPage() {
  return <LandingClient signupPolicy={await getSignupPolicy()} />;
}
