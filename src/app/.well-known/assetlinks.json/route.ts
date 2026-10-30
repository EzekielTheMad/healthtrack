export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'public, max-age=300', 'Content-Type': 'application/json' };
export function GET() {
  const packageName = process.env.ANDROID_APP_PACKAGE?.trim() || 'com.omnihealthtracker.app';
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (
    !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName) ||
    !fingerprints.length ||
    fingerprints.some((value) => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))
  )
    return Response.json(
      { error: 'Android application identity is not configured.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  return Response.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: packageName,
          sha256_cert_fingerprints: [...new Set(fingerprints)],
        },
      },
    ],
    { headers: HEADERS }
  );
}
