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
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { count } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { getOrCreateSecret } from '@/lib/runtime/keys';

function buildAuth() {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleConfigured = Boolean(googleClientId && googleClientSecret);

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    secret: getOrCreateSecret('auth_secret'),
    baseURL: appUrl,
    trustedOrigins: [appUrl],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: process.env.SIGNUPS_ENABLED === 'false',
    },
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: googleClientId!,
            clientSecret: googleClientSecret!,
            // Closed signups also apply to first-time Google sign-ins
            disableImplicitSignUp: process.env.SIGNUPS_ENABLED === 'false',
          },
        }
      : {},
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
          before: async (userData) => {
            const [{ n }] = await db.select({ n: count() }).from(schema.user);
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
