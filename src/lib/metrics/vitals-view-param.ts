// ---------------------------------------------------------------------------
// The `?view=` query parameter behind the Vitals view selector.
//
// Keeping this pure (rather than inline in the page) makes the selected view
// linkable and refresh-safe, and lets other surfaces — the Fitness weekly card
// links straight to the measurements view — build the href from one place.
// ---------------------------------------------------------------------------

/** Selector order, left to right. `focus` is the default. */
export const VITALS_VIEWS = ['focus', 'daily', 'trends', 'measurements'] as const;

export type VitalsView = (typeof VITALS_VIEWS)[number];

export const DEFAULT_VITALS_VIEW: VitalsView = 'focus';

export const VITALS_VIEW_LABELS: Record<VitalsView, string> = {
  focus: 'Focus',
  daily: 'Daily',
  trends: 'All metrics',
  measurements: 'Measurements',
};

/**
 * Resolve `?view=` to a view id. Anything missing, empty or unrecognized
 * falls back to Focus rather than rendering a blank page — the parameter is a
 * convenience, never a way to reach an invalid state.
 */
export function parseVitalsView(raw: string | null | undefined): VitalsView {
  return (VITALS_VIEWS as readonly string[]).includes(raw ?? '')
    ? (raw as VitalsView)
    : DEFAULT_VITALS_VIEW;
}

/** Canonical link to a Vitals view; the default view needs no parameter. */
export function vitalsViewHref(view: VitalsView): string {
  return view === DEFAULT_VITALS_VIEW ? '/vitals' : `/vitals?view=${view}`;
}
