/** Settings stays on one pathname so existing app navigation keeps its active state. */
export const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'people', label: 'People & sharing' },
  { id: 'data', label: 'Data & reports' },
  { id: 'advanced', label: 'Advanced & about' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

const anchorTabs: Record<string, SettingsTab> = {
  profile: 'profile',
  'integration-health': 'integrations',
  oura: 'integrations',
  'health-connect': 'integrations',
  health_connect: 'integrations',
  renpho: 'integrations',
  myair: 'integrations',
  hevy: 'integrations',
  providers: 'people',
  dependents: 'people',
  delegates: 'people',
  'health-sharing': 'people',
  invites: 'people',
  'medical-history': 'data',
  'data-export': 'data',
  'pdf-summary': 'data',
  'api-access': 'advanced',
  build: 'advanced',
  'danger-zone': 'advanced',
};

type SearchParams = Pick<URLSearchParams, 'get' | 'has'>;

export function settingsAnchor(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return '';
  }
}

export function resolveSettingsTab(params: SearchParams, hash = ''): SettingsTab {
  // Accept old OAuth callback URLs as well as the new explicit destination.
  if (params.has('oura')) return 'integrations';
  const requested = params.get('tab');
  if (SETTINGS_TABS.some((tab) => tab.id === requested)) return requested as SettingsTab;
  // A malformed explicit tab should not select an unrelated legacy section.
  if (requested !== null) return 'profile';
  const anchor = settingsAnchor(hash);
  return Object.hasOwn(anchorTabs, anchor) ? anchorTabs[anchor] : 'profile';
}

export function settingsTarget(params: SearchParams, hash = ''): string {
  return params.has('oura') ? 'oura' : settingsAnchor(hash);
}

/** Preserve unrelated URL state; remove a previous group's known section anchor. */
export function settingsHref(
  tab: SettingsTab,
  anchor?: string,
  currentSearch = '',
  currentHash = ''
): string {
  const params = new URLSearchParams(currentSearch);
  params.set('tab', tab);
  if (params.has('oura')) {
    params.delete('oura');
    params.delete('reason');
    params.delete('initial_sync');
  }
  let nextAnchor = anchor ?? settingsAnchor(currentHash);
  if (anchor === undefined && anchorTabs[nextAnchor] && anchorTabs[nextAnchor] !== tab) {
    nextAnchor = '';
  }
  return `/settings?${params.toString()}${nextAnchor ? `#${encodeURIComponent(nextAnchor)}` : ''}`;
}
