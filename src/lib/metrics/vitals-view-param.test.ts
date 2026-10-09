/**
 * Linkable Vitals view selection (`/vitals?view=measurements`).
 */
import { describe, it, expect } from 'vitest';
import {
  VITALS_VIEWS,
  VITALS_VIEW_LABELS,
  parseVitalsView,
  vitalsViewHref,
} from './vitals-view-param';

describe('parseVitalsView', () => {
  it('accepts every registered view id', () => {
    for (const view of VITALS_VIEWS) {
      expect(parseVitalsView(view)).toBe(view);
    }
  });

  it('defaults to focus when the parameter is missing', () => {
    expect(parseVitalsView(null)).toBe('focus');
    expect(parseVitalsView(undefined)).toBe('focus');
    expect(parseVitalsView('')).toBe('focus');
  });

  it('falls back to focus for an unrecognized value', () => {
    expect(parseVitalsView('measurement')).toBe('focus');
    expect(parseVitalsView('../../etc/passwd')).toBe('focus');
    expect(parseVitalsView('DAILY')).toBe('focus');
  });

  it('resolves the measurements view from the query parameter', () => {
    expect(parseVitalsView('measurements')).toBe('measurements');
  });

  it('keeps the existing views addressable', () => {
    expect(parseVitalsView('daily')).toBe('daily');
    expect(parseVitalsView('trends')).toBe('trends');
  });

  it('labels every view', () => {
    for (const view of VITALS_VIEWS) {
      expect(VITALS_VIEW_LABELS[view]).toBeTruthy();
    }
    expect(VITALS_VIEW_LABELS.trends).toBe('All metrics');
    expect(VITALS_VIEW_LABELS.measurements).toBe('Measurements');
  });
});

describe('vitalsViewHref', () => {
  it('links a non-default view by query parameter', () => {
    expect(vitalsViewHref('measurements')).toBe('/vitals?view=measurements');
  });

  it('links the default view without a redundant parameter', () => {
    expect(vitalsViewHref('focus')).toBe('/vitals');
  });
});
