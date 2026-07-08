import { getCapabilities } from '@/lib/capabilities';
import LoginForm from './login-form';

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
