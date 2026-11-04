import { describe, it, expect } from 'vitest';
import { vitalSourceLabel } from './source-label';
describe('source display names preserve identity', () => {
  it('shows the exact native package alongside its known friendly label', () => {
    expect(
      vitalSourceLabel('hc:SXeXO5yDEqaWDag_pILR-juRpWPlohFV7HdHv9JlHJg', {
        health_connect: true,
        source_package: 'com.sbs.diet',
      })
    ).toBe('Health Connect · MacroFactor (com.sbs.diet)');
    expect(
      vitalSourceLabel('hc:oXVka5w7YY-FL02zOl40n0VlJa6EoQFoRj6bZIpcjh0', {
        health_connect: true,
        source_package: 'com.example.scale',
      })
    ).toBe('Health Connect · com.example.scale');
  });
  it('does not let package metadata relabel a direct integration', () => {
    expect(vitalSourceLabel('oura', { source_package: 'com.example.scale' })).toBe('Oura');
    expect(vitalSourceLabel('__proto__')).toBe('__proto__');
    expect(vitalSourceLabel('hc:unknown', { source_package: '<untrusted>' })).toBe('hc:unknown');
  });
  it('does not relabel arbitrary legacy hc-prefixed source names as native', () => {
    expect(vitalSourceLabel('hc:garmin', { source_package: 'com.example.scale' })).toBe(
      'hc:garmin'
    );
    expect(vitalSourceLabel('hc:oXVka5w7YY-FL02zOl40n0VlJa6EoQFoRj6bZIpcjh0')).toBe(
      'hc:oXVka5w7YY-FL02zOl40n0VlJa6EoQFoRj6bZIpcjh0'
    );
  });
});
