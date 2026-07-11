// ---------------------------------------------------------------------------
// Lab-derived AI warning provenance + dismiss-until-new-labs filtering
// (fitness-domain spec §AI integration #2/#3).
//
// Pure module. The model tags lab-derived highlights with the exact test
// names it drew from (`labTests`); these functions VALIDATE those tags
// against the flags actually sent in the prompt and attach the draw date
// (`labAsOf`) from the database — the card renders a date the model cannot
// hallucinate, and prose is never trusted for structure.
//
// Dismissals are keyed per normalized test name and stamped with the latest
// lab visit date at dismissal time. A highlight is hidden only while EVERY
// test it cites is dismissed at a stamp >= the CURRENT latest visit date —
// importing newer lab data makes the stamp stale and the warning eligible
// again (auto-clear).
// ---------------------------------------------------------------------------

export interface LabFlagRef {
  testName: string;
  /** Visit (draw) date, YYYY-MM-DD. */
  visitDate: string;
}

export interface LabDismissalRef {
  /** Normalized test name (see normalizeLabTestKey). */
  warningKey: string;
  /** Latest lab visit date at dismissal time (YYYY-MM-DD). */
  labVisitDate: string;
}

export interface LabTaggedHighlight {
  type: 'positive' | 'attention' | 'action';
  text: string;
  /** Canonical test names the highlight derives from (validated). */
  labTests?: string[];
  /** Draw date (YYYY-MM-DD) — attached from the DB, not model output. */
  labAsOf?: string;
}

/** Dismissal key for a lab test name: lowercased, whitespace-collapsed. */
export function normalizeLabTestKey(testName: string): string {
  return testName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Validate model-tagged `labTests` against the flags that were actually in
 * the prompt and attach `labAsOf` (the newest draw date among the matched
 * flags). Unknown/junk test names are dropped; a highlight whose tags all
 * fail validation loses its lab provenance entirely (rendered as a plain
 * highlight — no as-of date, no dismiss control).
 */
export function attachLabProvenance(
  highlights: Array<LabTaggedHighlight & { labTests?: unknown }>,
  flags: LabFlagRef[],
): LabTaggedHighlight[] {
  const byKey = new Map<string, LabFlagRef>();
  for (const flag of flags) {
    const key = normalizeLabTestKey(flag.testName);
    const existing = byKey.get(key);
    // Keep the newest draw per test (YYYY-MM-DD compares lexicographically).
    if (!existing || flag.visitDate > existing.visitDate) byKey.set(key, flag);
  }

  return highlights.map((h) => {
    // Rebuild from scratch: a model-supplied labAsOf (or any junk field)
    // never passes through — only validated provenance is attached below.
    const rest: LabTaggedHighlight = { type: h.type, text: h.text };
    const { labTests } = h;
    if (!Array.isArray(labTests)) return { ...rest };
    const matched = labTests
      .filter((t): t is string => typeof t === 'string')
      .map((t) => byKey.get(normalizeLabTestKey(t)))
      .filter((f): f is LabFlagRef => f !== undefined);
    if (matched.length === 0) return { ...rest };
    const names = Array.from(new Set(matched.map((f) => f.testName)));
    const asOf = matched.map((f) => f.visitDate).sort().at(-1)!;
    return { ...rest, labTests: names, labAsOf: asOf };
  });
}

/** True when every test the highlight cites is dismissed at a stamp that is
    still current (>= latest visit date). No lab data → nothing is hidden. */
export function isLabWarningDismissed(
  highlight: LabTaggedHighlight,
  dismissals: LabDismissalRef[],
  latestVisitDate: string | null,
): boolean {
  if (!highlight.labTests || highlight.labTests.length === 0) return false;
  if (latestVisitDate === null) return false;
  const stampByKey = new Map(dismissals.map((d) => [d.warningKey, d.labVisitDate]));
  return highlight.labTests.every((t) => {
    const stamp = stampByKey.get(normalizeLabTestKey(t));
    return stamp !== undefined && stamp >= latestVisitDate;
  });
}

/** Drop highlights hidden by current dismissals; everything else passes
    through untouched (non-lab highlights are never filtered). */
export function filterDismissedLabHighlights<T extends LabTaggedHighlight>(
  highlights: T[],
  dismissals: LabDismissalRef[],
  latestVisitDate: string | null,
): T[] {
  return highlights.filter((h) => !isLabWarningDismissed(h, dismissals, latestVisitDate));
}
