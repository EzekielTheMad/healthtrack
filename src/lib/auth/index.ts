/**
 * Better Auth server instance.
 *
 * - SQLite via the drizzle adapter over our lazy `db` proxy (`@/db`).
 * - Email/password always enabled; signups can be closed with
 *   SIGNUPS_ENABLED=false (anything else, including unset, keeps them open).
 * - Google OAuth registers only when BOTH GOOGLE_CLIENT_ID and
 *   GOOGLE_CLIENT_SECRET are set.
 * - First registered user becomes the instance admin (`role: 'admin'`);
 *   everyone after gets 'user'. `role` is not a client input field.
 * - Secret comes from AUTH_SECRET env or an auto-generated key in
 *   DATA_DIR/keys (see src/lib/runtime/keys.ts).
 */
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { count } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { getOrCreateSecret } from '@/lib/runtime/keys';
import { consumeInvite } from '@/lib/repos/invites';

async function userCount(): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(schema.user);
  return n;
}

/**
 * Registration policy (invite-only by default):
 *  - zero users            → open (bootstrap: the first account becomes admin,
 *                            so a fresh install is never bricked)
 *  - SIGNUPS_ENABLED=true  → open registration (operator opt-in)
 *  - SIGNUPS_ENABLED=false → hard closed (invites don't work either)
 *  - otherwise (default)   → a valid single-use invite token is required
 */
type SignupPolicy = 'open' | 'closed' | 'invite';

export async function getSignupPolicy(): Promise<SignupPolicy> {
  if ((await userCount()) === 0) return 'open';
  if (process.env.SIGNUPS_ENABLED === 'true') return 'open';
  if (process.env.SIGNUPS_ENABLED === 'false') return 'closed';
  return 'invite';
}

function buildAuth() {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const isProd = process.env.NODE_ENV === 'production';

  // Session cookies only get the Secure flag when the base URL is https. Behind
  // a TLS-terminating proxy/tunnel that forwards plain http, an http APP_URL
  // would ship cookies without Secure — warn loudly so operators fix it.
  if (!appUrl.startsWith('https://') && !appUrl.startsWith('http://localhost')) {
    console.warn(
      '[auth] APP_URL is not https — session cookies will NOT be marked Secure. ' +
        'Set APP_URL to your public https origin (the address behind your reverse proxy/tunnel).',
    );
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleConfigured = Boolean(googleClientId && googleClientSecret);

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    secret: getOrCreateSecret('auth_secret'),
    baseURL: appUrl,
    trustedOrigins: [appUrl],
    telemetry: { enabled: false },
    // Force the Secure cookie flag in production regardless of how the proxy
    // presents the scheme to the app.
    advanced: { useSecureCookies: isProd },
    // Brute-force protection. In-memory storage is adequate for the
    // single-container self-hosted topology (one process); stricter per-route
    // caps on the credential endpoints blunt credential-stuffing.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
        '/forget-password': { window: 60, max: 3 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Signup gating happens in hooks.before / databaseHooks below (it needs
      // the user count + invite token, which static config can't see).
      disableSignUp: false,
    },
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
            // Implicit social signup is gated by databaseHooks.user.create
            // below (blocked unless open policy / bootstrap), not here —
            // a static flag can't allow the zero-users bootstrap case.
            disableImplicitSignUp: false,
          },
        }
      : {},
    // Invite signups are email/password; let a family member later sign in
    // with Google on the same (verified) email without a separate account.
    account: {
      accountLinking: { enabled: true, trustedProviders: ['google'] },
    },
    hooks: {
      // Gate email/password registration BEFORE the endpoint runs. The raw
      // body is available here (an invite token is not a stored user field,
      // so it must be read pre-validation).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        const policy = await getSignupPolicy();
        if (policy === 'open') return;
        if (policy === 'closed') {
          throw new APIError('FORBIDDEN', {
            message: 'New registrations are disabled on this instance.',
          });
        }
        const body = (ctx.body ?? {}) as { inviteToken?: unknown; email?: unknown };
        const token = typeof body.inviteToken === 'string' ? body.inviteToken : '';
        const email = typeof body.email === 'string' ? body.email : undefined;
        // Burn-on-attempt: consuming here (not after success) closes any
        // replay window; a failed signup just needs a fresh invite.
        if (!token || !(await consumeInvite(token, email))) {
          throw new APIError('FORBIDDEN', {
            message: 'A valid invite is required to create an account on this instance.',
          });
        }
      }),
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
          input: false, // never accepted from the client
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (userData, ctx) => {
            const n = await userCount();
            // Safety net for creation paths that bypass /sign-up/email — i.e.
            // implicit signup via a social callback. Email signups were
            // already invite-gated by hooks.before; anything else can only
            // create an account when the policy is open (or bootstrap).
            if (
              n > 0 &&
              process.env.SIGNUPS_ENABLED !== 'true' &&
              ctx?.path !== '/sign-up/email'
            ) {
              throw new APIError('FORBIDDEN', {
                message:
                  'Sign-ups on this instance are invite-only. Ask the administrator for an invite link, then register with email and password.',
              });
            }
            return { data: { ...userData, role: n === 0 ? 'admin' : 'user' } };
          },
        },
      },
    },
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;

// Lazy singleton on globalThis to survive dev HMR (same pattern as `db` in
// src/db/index.ts). Building the instance reads/creates the secret in
// DATA_DIR/keys, so it must not run at module evaluation: `next build`
// evaluates route modules during page-data collection, where DATA_DIR may
// not be creatable (e.g. /data on a CI runner).
//
// The cache is keyed by the env inputs that shape the instance so tests that
// change env + vi.resetModules() get a matching instance, not a stale one.
const globalAuth = globalThis as unknown as {
  __healthtrackAuth?: Map<string, AuthInstance>;
};

function authCacheKey(): string {
  return JSON.stringify([
    process.env.DATA_DIR,
    process.env.APP_URL,
    process.env.SIGNUPS_ENABLED,
    process.env.GOOGLE_CLIENT_ID,
    process.env.AUTH_SECRET,
  ]);
}

export function getAuth(): AuthInstance {
  const cache = (globalAuth.__healthtrackAuth ??= new Map());
  const key = authCacheKey();
  let instance = cache.get(key);
  if (!instance) {
    instance = buildAuth();
    cache.set(key, instance);
  }
  return instance;
}

/** Lazy proxy so existing `import { auth }` call sites keep working. */
export const auth: AuthInstance = new Proxy({} as AuthInstance, {
  get(_t, prop, receiver) {
    const value = Reflect.get(getAuth(), prop, receiver);
    return typeof value === 'function' ? value.bind(getAuth()) : value;
  },
  has: (_t, prop) => prop in getAuth(),
});

export type Auth = AuthInstance;
