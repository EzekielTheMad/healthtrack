import { nutritionSourceLabel } from '@/lib/nutrition/sources';

const LABELS: Readonly<Record<string, string>> = {
  oura: 'Oura',
  renpho: 'Renpho',
  myair: 'myAir',
  manual: 'Manual entry',
  health_connect_daily: 'Health Connect',
};
/** Display only: never use labels as ingestion identities or source preferences. */
export function vitalSourceLabel(
  source: string,
  metadata?: Record<string, unknown> | null
): string {
  if (/^hc:[A-Za-z0-9_-]{43}$/.test(source) && metadata?.health_connect === true) {
    const pkg = metadata?.source_package;
    if (typeof pkg === 'string' && /^[A-Za-z0-9_.]{1,255}$/.test(pkg)) {
      const friendly = nutritionSourceLabel(pkg);
      return `Health Connect · ${typeof friendly === 'string' && friendly !== pkg ? `${friendly} (${pkg})` : pkg}`;
    }
    return `Health Connect (${source})`;
  }
  return Object.hasOwn(LABELS, source) ? LABELS[source] : source;
}
