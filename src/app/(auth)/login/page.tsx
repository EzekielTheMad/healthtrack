import { getCapabilities } from '@/lib/capabilities';
import LoginForm from './login-form';

/**
 * Must render per-request: getCapabilities() reads process.env (GOOGLE_*,
 * SIGNUPS_ENABLED), which are runtime-only. Without this the page is
 * statically prerendered at build time — when no env is set — and the Google
 * button / signup state get frozen "off" regardless of the deployed config.
 */
export const dynamic = 'force-dynamic';

/**
 * Server component wrapper: reads instance capabilities and passes them down
 * so the client form can hide the Google button / signup toggle.
 * (Server components call getCapabilities() directly; client components use
 * the useCapabilities() hook against GET /api/capabilities.)
 */
export default function LoginPage() {
  const { googleAuth, signupsEnabled } = getCapabilities();

  return <LoginForm googleEnabled={googleAuth} signupsEnabled={signupsEnabled} />;
}
