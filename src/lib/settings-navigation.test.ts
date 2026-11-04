import { describe, expect, it } from 'vitest';
import {
  resolveSettingsTab,
  settingsAnchor,
  settingsHref,
  settingsTarget,
} from './settings-navigation';

describe('Settings URL compatibility', () => {
  it('opens Profile by default and accepts only supported explicit groups', () => {
    expect(resolveSettingsTab(new URLSearchParams())).toBe('profile');
    expect(resolveSettingsTab(new URLSearchParams('tab=advanced'))).toBe('advanced');
    expect(resolveSettingsTab(new URLSearchParams('tab=unknown'), '#dependents')).toBe('profile');
  });

  it.each([
    ['#dependents', 'people'],
    ['#providers', 'people'],
    ['#integration-health', 'integrations'],
    ['#oura', 'integrations'],
    ['#health-connect', 'integrations'],
    ['#medical-history', 'data'],
    ['#api-access', 'advanced'],
  ])('keeps legacy %s links working', (hash, expected) => {
    expect(resolveSettingsTab(new URLSearchParams(), hash)).toBe(expected);
  });

  it('gives an explicit group precedence over an old fragment', () => {
    expect(resolveSettingsTab(new URLSearchParams('tab=data'), '#dependents')).toBe('data');
  });

  it.each(['connected', 'error'])('always exposes the Oura %s result', (outcome) => {
    const params = new URLSearchParams(`tab=profile&oura=${outcome}&reason=invalid_state`);
    expect(resolveSettingsTab(params, '#dependents')).toBe('integrations');
    expect(settingsTarget(params, '#dependents')).toBe('oura');
  });

  it('preserves unrelated query and fragment state when building navigation links', () => {
    const href = settingsHref(
      'advanced',
      undefined,
      'view=compact&tab=people&reason=note',
      '#custom'
    );
    const url = new URL(href, 'https://healthtrack.example');
    expect(url.pathname).toBe('/settings');
    expect(url.searchParams.get('tab')).toBe('advanced');
    expect(url.searchParams.get('view')).toBe('compact');
    expect(url.searchParams.get('reason')).toBe('note');
    expect(url.hash).toBe('#custom');
  });

  it('does not carry a consumed OAuth result or another group’s section into a new group', () => {
    const href = settingsHref(
      'people',
      undefined,
      'oura=error&reason=denied&view=compact',
      '#oura'
    );
    const url = new URL(href, 'https://healthtrack.example');
    expect(url.searchParams.get('view')).toBe('compact');
    expect(url.searchParams.has('oura')).toBe(false);
    expect(url.searchParams.has('reason')).toBe(false);
    expect(url.hash).toBe('');
    expect(settingsHref('people', 'dependents')).toBe('/settings?tab=people#dependents');
  });

  it('handles malformed or encoded fragments without throwing', () => {
    expect(settingsAnchor('#%64ependents')).toBe('dependents');
    expect(settingsAnchor('#%invalid')).toBe('');
    expect(resolveSettingsTab(new URLSearchParams(), '#%invalid')).toBe('profile');
    expect(resolveSettingsTab(new URLSearchParams(), '#__proto__')).toBe('profile');
    expect(resolveSettingsTab(new URLSearchParams(), '#constructor')).toBe('profile');
  });
});
