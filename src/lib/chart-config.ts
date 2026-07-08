/**
 * Centralized Recharts theming constants.
 *
 * Recharts SVG elements cannot use CSS variables directly, so we define
 * hex values that correspond to the app's CSS custom properties.
 */

// Primary palette — matches CSS custom properties conceptually
export const CHART_COLORS = {
  /** --color-sage: normal/good state */
  sage: '#81B29A',
  /** --color-warning: low/caution state */
  warning: '#FBBF24',
  /** --color-terracotta: high/danger state */
  terracotta: '#E07A5F',
  /** Critical state (no CSS var equivalent) */
  critical: '#EF4444',
  /** --color-text-muted equivalent for chart labels */
  muted: '#8B95B0',
  /** --border-card equivalent for grid lines */
  grid: '#1E2642',
  /** --bg-card equivalent for tooltip/chart background */
  cardBg: '#171D2E',
  /** --border-card equivalent for tooltip border */
  cardBorder: '#1E2642',
  /** --color-text-primary equivalent for chart text */
  textPrimary: '#E8ECF4',
} as const;

export type ChartColor = keyof typeof CHART_COLORS;

/** Opacity for reference range area fill */
export const REFERENCE_AREA_OPACITY = 0.12;

/** Default chart dimensions */
export const CHART_DEFAULTS = {
  height: 250,
  margin: { top: 8, right: 16, bottom: 8, left: 8 },
  dotRadius: 4,
  activeDotRadius: 6,
  strokeWidth: 2,
} as const;

/**
 * Returns a dot color based on vital range status.
 */
export function getVitalDotColor(
  value: number,
  refLow?: number,
  refHigh?: number,
): string {
  if (refLow === undefined || refHigh === undefined) return CHART_COLORS.sage;
  if (value < refLow) return CHART_COLORS.warning;
  if (value > refHigh) return CHART_COLORS.terracotta;
  return CHART_COLORS.sage;
}

/**
 * Returns a dot color based on lab flag.
 */
export function getLabDotColor(flag: string | null | undefined): string {
  switch (flag) {
    case 'high':
      return CHART_COLORS.terracotta;
    case 'low':
      return CHART_COLORS.warning;
    case 'critical':
      return CHART_COLORS.critical;
    default:
      return CHART_COLORS.sage;
  }
}
