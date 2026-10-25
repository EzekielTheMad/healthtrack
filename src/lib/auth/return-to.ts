/** Restrict post-login navigation to application pages on this origin. */
export function safeReturnTo(value: unknown, fallback = '/dashboard'): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return fallback;
  const url = new URL(value, 'https://healthtrack.invalid');
  if (
    url.origin !== 'https://healthtrack.invalid' ||
    /^\/(?:api|login|signup|logout)(?:\/|$)/.test(url.pathname) ||
    !/^\/(?:dashboard|health|fitness|nutrition|mobile|settings|medications|conditions|allergies|procedures|vaccines|labs|vitals|notes|appointments|query)(?:\/|$)/.test(
      url.pathname
    )
  )
    return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
