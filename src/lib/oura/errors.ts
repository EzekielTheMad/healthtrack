/** Error messages are intentionally fixed text: provider response bodies are sensitive. */
export class OuraApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAt: string | null = null
  ) {
    super(ouraErrorMessage(code));
    this.name = 'OuraApiError';
  }
}

export function ouraErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    auth_required: 'Oura authorization expired. Reconnect your Oura Ring.',
    invalid_grant: 'Oura authorization expired (invalid_grant). Reconnect your Oura Ring.',
    rate_limited: 'Oura rate limit reached. Sync will resume after the retry time.',
    provider_unavailable: 'Oura is temporarily unavailable. A later sync will retry.',
    timeout: 'Oura did not respond in time. A later sync will retry.',
    network_error: 'Could not reach Oura. A later sync will retry.',
    not_configured: 'Oura OAuth client credentials are not configured.',
    invalid_response: 'Oura returned an unexpected response. A later sync will retry.',
  };
  return messages[code] ?? 'Oura sync failed. Try again later.';
}

export function retryAfterAt(value: string | null, now = Date.now()): string | null {
  if (!value) return null;
  const seconds = Number(value);
  const time = Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Date.parse(value);
  return Number.isFinite(time) && time > now ? new Date(time).toISOString() : null;
}

export async function fetchOura(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new OuraApiError(
      0,
      error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'timeout'
        : 'network_error'
    );
  }
}

export function responseError(response: Response): OuraApiError {
  return new OuraApiError(
    response.status,
    response.status === 401
      ? 'auth_required'
      : response.status === 429
        ? 'rate_limited'
        : response.status >= 500
          ? 'provider_unavailable'
          : 'provider_error',
    response.status === 429
      ? (retryAfterAt(response.headers.get('Retry-After')) ??
          new Date(Date.now() + 60 * 60_000).toISOString())
      : null
  );
}
