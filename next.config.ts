import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

// CSP tuned to what this app actually loads: everything is same-origin. Fonts
// are self-hosted by next/font (served from /_next), there are no external
// scripts/styles/images/CDNs, and the AI calls happen server-side (no browser
// fetch to Anthropic). 'unsafe-inline' is required for Next's inline bootstrap
// script and the app's ~90 inline style attributes; there is no XSS surface to
// exploit it (react-markdown escapes, no dangerouslySetInnerHTML, no eval).
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  // The bundled PDF renderer uses Yoga's WebAssembly layout engine. This
  // permits WASM compilation without enabling JavaScript eval/new Function.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // HSTS only in production. Deliberately no includeSubDomains/preload: many
  // self-hosters run other services on sibling subdomains that may be plain
  // HTTP, and we must not force HTTPS onto those from this app.
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (.next/standalone).
  output: 'standalone',
  // Filesystem-based runtime paths must not pull local databases, uploads,
  // credentials, or agent checkouts into a distributable standalone build.
  outputFileTracingExcludes: {
    '**/*': ['data/**/*', 'tmpdata/**/*', '.env*', '.claude/**/*', '.git/**/*', 'CLAUDE.local.md'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
