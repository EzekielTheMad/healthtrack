/**
 * rebuildNutritionDays — the ONE deterministic path from retained raw
 * nutrition records to canonical `nutrition_daily` rows (PRD §6.7).
 *
 * Both callers go through here, so the webhook and the "Reprocess retained
 * nutrition" button can never disagree:
 *   - the ingestion transaction, for the Phoenix dates a delivery touched;
 *   - a standalone reprocess, for every retained date, when approval, the
 *     strategy or the canonical-write toggle changed AFTER records landed.
 *
 * The invariants, all covered by rebuild-nutrition.test.ts:
 *   1. input is the RETAINED DEDUPLICATED raw table, never the newest batch,
 *      so rebuilding the same raw state twice produces identical rows;
 *   2. package matching is EXACT — never a prefix or substring;
 *   3. a record belongs to the America/Phoenix calendar date of its
 *      start_time;
 *   4. 'sum_items' sums the day's records; 'latest_summary' takes only the
 *      newest one, and the two are never mixed;
 *   5. exactly one row per (user, date, source_package), overwritten — an
 *      incoming subtotal is never added to a stored total;
 *   6. null is not zero: a nutrient no contributing record supplied stays null;
 *   7. a day whose records have all gone away loses its row rather than
 *      being zeroed.
 *
 * The whole rebuild runs inside ONE better-sqlite3 transaction (the caller's,
 * or one opened by reprocessRetainedNutrition), so a failure can never leave a
 * half-rebuilt day behind.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { healthConnectIntegrations } from '@/db/schema';
import type { NutritionStrategy } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import {
  getOwnedIntegration,
  listNutritionDatesForPackages,
  listRawRecordsForPackages,
  listRawRecordsInWindow,
  updateIntegration,
  type HcWriteDb,
  type HealthConnectIntegrationView,
  type HealthConnectPatch,
  type HealthConnectRawRecordRow,
} from '@/lib/repos/health-connect';
import { overwriteNutritionDay, type NutritionWriteDb } from '@/lib/repos/nutrition';
import { OWNER_TZ } from '@/lib/fitness/rollup';
import { computeDayTotals, phoenixDate, phoenixDayWindow } from './normalize-nutrition';

export type RebuildDb = HcWriteDb & NutritionWriteDb;

export interface RebuildNutritionInput {
  userId: string;
  integrationId: string;
  /** Exact approved package names. Empty means there is nothing to rebuild. */
  allowedPackages: string[];
  strategy: NutritionStrategy;
  /**
   * Phoenix dates to rebuild. Omit for a FULL reprocess: every date the
   * retained records cover, plus every date that already has a canonical row
   * (so a day whose records disappeared loses its stale row too).
   */
  dates?: Iterable<string>;
  /** Provenance stamped into each rebuilt row's metadata. */
  ingestId?: string | null;
  appVersion?: string | null;
  /** What triggered the rebuild — 'webhook', 'reprocess', 'settings_change'. */
  trigger?: string;
}

export interface RebuildNutritionReport {
  /** Every Phoenix date examined, sorted. */
  datesRebuilt: string[];
  rowsUpserted: number;
  rowsDeleted: number;
  /** Retained raw records read for those dates and packages. */
  recordsConsidered: number;
  /** Read but not contributing: unparseable, or dropped by 'latest_summary'. */
  recordsSkipped: number;
  errors: string[];
}

function emptyReport(): RebuildNutritionReport {
  return {
    datesRebuilt: [],
    rowsUpserted: 0,
    rowsDeleted: 0,
    recordsConsidered: 0,
    recordsSkipped: 0,
    errors: [],
  };
}

/**
 * Recompute and overwrite the canonical rows for the requested dates.
 * Synchronous, so it composes into the ingestion transaction.
 *
 * No try/catch: the only thing that can throw here is a database failure, and
 * that MUST roll the caller's transaction back rather than being softened into
 * a per-day error string. Per-record shape problems are counted, not thrown —
 * one malformed retained record never discards the day's valid ones.
 */
export function rebuildNutritionDays(
  dbh: RebuildDb,
  input: RebuildNutritionInput,
): RebuildNutritionReport {
  const packages = [...new Set(input.allowedPackages)].filter((p) => p.length > 0);
  const report = emptyReport();
  if (packages.length === 0) return report;

  const requested = input.dates ? [...new Set(input.dates)].sort() : null;
  const seenDates = new Set<string>();

  for (const pkg of packages) {
    // Records are read PER PACKAGE with an equality filter, so approval can
    // never widen to a lookalike package (com.sbs.diet.free, com.sbs.dietary).
    const { rows, dates } = loadForPackage(dbh, input.userId, pkg, requested);
    report.recordsConsidered += rows.length;

    const byDate = new Map<string, HealthConnectRawRecordRow[]>();
    for (const row of rows) {
      const day = row.recordedStartAt ? phoenixDate(row.recordedStartAt) : null;
      if (!day) {
        // No usable start instant, so the record cannot be attributed to a day.
        report.recordsSkipped += 1;
        continue;
      }
      const bucket = byDate.get(day);
      if (bucket) bucket.push(row);
      else byDate.set(day, [row]);
    }

    for (const date of dates) {
      const dayRows = byDate.get(date) ?? [];
      const totals = computeDayTotals(dayRows, input.strategy);
      report.recordsSkipped += dayRows.length - totals.recordCount;

      const outcome = overwriteNutritionDay(dbh, input.userId, {
        date,
        sourcePackage: pkg,
        ...totals,
        metadata: {
          strategy: input.strategy,
          timezone: OWNER_TZ,
          integration_id: input.integrationId,
          ingest_id: input.ingestId ?? null,
          app_version: input.appVersion ?? null,
          trigger: input.trigger ?? 'webhook',
        },
      });
      if (outcome === 'inserted' || outcome === 'updated') report.rowsUpserted += 1;
      else if (outcome === 'deleted') report.rowsDeleted += 1;

      seenDates.add(date);
    }
  }

  report.datesRebuilt = [...seenDates].sort();
  return report;
}

/**
 * The retained records and the target dates for one package.
 *
 * A dates-scoped rebuild reads only the instants those Phoenix days can
 * contain; a full reprocess reads the package's whole retained history and
 * adds the dates that already carry a canonical row, so nothing stale is left
 * behind when a source's records go away.
 */
function loadForPackage(
  dbh: RebuildDb,
  userId: string,
  pkg: string,
  requested: string[] | null,
): { rows: HealthConnectRawRecordRow[]; dates: string[] } {
  if (requested) {
    if (requested.length === 0) return { rows: [], dates: [] };
    const first = phoenixDayWindow(requested[0]);
    const last = phoenixDayWindow(requested[requested.length - 1]);
    const rows = listRawRecordsInWindow(
      dbh,
      userId,
      'nutrition',
      first.startAt,
      last.endAt,
      [pkg],
    );
    return { rows, dates: requested };
  }

  const rows = listRawRecordsForPackages(dbh, userId, 'nutrition', [pkg]);
  const dates = new Set<string>();
  for (const row of rows) {
    const day = row.recordedStartAt ? phoenixDate(row.recordedStartAt) : null;
    if (day) dates.add(day);
  }
  for (const day of listNutritionDatesForPackages(dbh, userId, [pkg])) dates.add(day);
  return { rows, dates: [...dates].sort() };
}

// ---------------------------------------------------------------------------
// Standalone reprocess (Settings action + configuration changes)
// ---------------------------------------------------------------------------

export interface ReprocessOptions {
  /** Limit the rebuild to these Phoenix dates. Omit for the whole history. */
  dates?: string[];
  trigger?: string;
}

/**
 * Rebuild the actor's retained nutrition from scratch, in one transaction.
 *
 * Deliberately NOT gated on `status === 'active'`: this is an explicit,
 * owner-initiated recomputation of data the user has already approved, and
 * requiring another phone delivery before retained records normalize is
 * precisely the failure this exists to fix. It IS gated on nutrition being an
 * enabled canonical write with at least one approved package — without those
 * there is no user decision authorising canonical rows at all.
 */
export function reprocessRetainedNutrition(
  actorId: string,
  integrationId: string,
  opts: ReprocessOptions = {},
): RebuildNutritionReport {
  if (!actorId || !integrationId) throw new NotFoundError();

  return db.transaction((tx) => {
    const integration = tx
      .select()
      .from(healthConnectIntegrations)
      .where(eq(healthConnectIntegrations.id, integrationId))
      .get();
    // 404 (not 403) for another user's id — RLS parity with every repo here.
    if (!integration || integration.userId !== actorId) throw new NotFoundError();

    const approved = integration.allowedSources.nutrition ?? [];
    if (!integration.enabledTypes.includes('nutrition') || approved.length === 0) {
      const report = emptyReport();
      report.errors.push(
        'Nutrition canonical writes are off for this integration. Approve an exact source package and enable "Nutrition" first.',
      );
      return report;
    }

    const report = rebuildNutritionDays(tx, {
      userId: actorId,
      integrationId,
      allowedPackages: approved,
      strategy: integration.nutritionStrategy,
      dates: opts.dates,
      trigger: opts.trigger ?? 'reprocess',
    });

    if (report.rowsUpserted > 0 || report.rowsDeleted > 0) {
      const now = new Date().toISOString();
      tx.update(healthConnectIntegrations)
        .set({ lastNormalizedAt: now, updatedAt: now })
        .where(eq(healthConnectIntegrations.id, integrationId))
        .run();
    }
    return report;
  });
}

// ---------------------------------------------------------------------------
// Settings changes that invalidate previously retained records
// ---------------------------------------------------------------------------

/**
 * Apply a settings patch AND rebuild whatever it invalidated.
 *
 * Approving a package, switching the strategy or turning nutrition on are
 * retroactive decisions: the records they now cover are already sitting in the
 * raw table. Before this, those changes only affected the NEXT delivery, so an
 * account could sit at "16 retained records, zero canonical rows" indefinitely
 * — the bug this whole path exists to close.
 *
 * Lives here rather than in the repo so the dependency stays one-way
 * (route → this → repo); the repo must not import the rebuild service back.
 */
export async function updateIntegrationSettings(
  actorId: string,
  id: string,
  patch: HealthConnectPatch,
): Promise<{
  integration: HealthConnectIntegrationView;
  rebuild: RebuildNutritionReport | null;
}> {
  const before = await getOwnedIntegration(actorId, id);
  const after = await updateIntegration(actorId, id, patch);

  if (!nutritionRebuildTriggered(before, after)) {
    return { integration: after, rebuild: null };
  }
  return {
    integration: after,
    rebuild: reprocessRetainedNutrition(actorId, id, { trigger: 'settings_change' }),
  };
}

/**
 * Whether a patch made previously retained nutrition records newly eligible
 * for canonical rows, or changed how they collapse into one.
 *
 * Removing an approval is deliberately NOT a trigger: it stops future writes
 * but leaves the rows the user already accepted in place, the same posture
 * deleting an integration takes toward canonical data (PRD §6.10).
 */
function nutritionRebuildTriggered(
  before: HealthConnectIntegrationView,
  after: HealthConnectIntegrationView,
): boolean {
  const approvedAfter = after.allowedSources.nutrition ?? [];
  const enabledAfter = after.enabledTypes.includes('nutrition');
  // Nothing is authorised to write canonical rows, so nothing to rebuild.
  if (!enabledAfter || approvedAfter.length === 0) return false;

  const approvedBefore = new Set(before.allowedSources.nutrition ?? []);
  if (approvedAfter.some((pkg) => !approvedBefore.has(pkg))) return true;
  if (before.nutritionStrategy !== after.nutritionStrategy) return true;
  if (!before.enabledTypes.includes('nutrition')) return true;
  // Leaving inventory/paused for 'active' also normalizes what already landed.
  if (before.status !== 'active' && after.status === 'active') return true;
  return false;
}
