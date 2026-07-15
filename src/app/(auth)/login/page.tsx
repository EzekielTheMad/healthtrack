import { getCapabilities } from '@/lib/capabilities';
import { getSignupPolicy } from '@/lib/auth';
import LoginForm from './login-form';

/**
 * Must render per-request: getCapabilities() reads process.env (GOOGLE_*,
 * SIGNUPS_ENABLED) and getSignupPolicy() reads the user count from the
 * database — both are runtime-only. Without this the page is statically
 * prerendered at build time and the Google button / signup state get frozen
 * regardless of the deployed config.
 */
export const dynamic = 'force-dynamic';

/**
 * Server component wrapper: reads instance capabilities + the registration
 * policy (open on bootstrap/opt-in, invite-only by default, or closed) and
 * passes them down with any ?invite= token from an invite link.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { googleAuth } = getCapabilities();
  const [policy, params] = await Promise.all([getSignupPolicy(), searchParams]);

  return (
    <LoginForm
      googleEnabled={googleAuth}
      signupPolicy={policy}
      inviteToken={typeof params.invite === 'string' ? params.invite : null}
    />
  );
}
