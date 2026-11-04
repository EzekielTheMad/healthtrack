/** Legacy user-only browser cache is quarantined. Native Doctor Essentials uses
 * its own encrypted instance/account/subject/grant-bound storage instead. */
export interface CachedData {
  userId: string;
  medications?: unknown[];
  conditions?: unknown[];
  recentVitals?: unknown[];
  recentLabs?: unknown[];
  cachedAt: number;
}
export async function cacheHealthData(
  _userId: string,
  _data: Omit<CachedData, 'userId' | 'cachedAt'>
): Promise<void> {
  void _userId;
  void _data;
  throw new Error(
    'Browser clinical caching is disabled. Use encrypted Android Doctor Essentials for offline viewing.'
  );
}
export async function getCachedHealthData(_userId: string): Promise<CachedData | null> {
  void _userId;
  // Do not read, display, migrate, or silently delete old unscoped clinical data.
  return null;
}
