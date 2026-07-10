-- Enforce the app-level vitals upsert tuple in the schema so racing writers
-- can't duplicate rows (upsertOwnVital in src/lib/repos/vitals.ts is
-- update-else-insert with no constraint behind it). SQLite treats NULLs as
-- distinct in unique indexes, so the nullable dependent_id is coalesced to ''
-- in the index expression — owner rows (dependent_id NULL) are actually
-- constrained.
--
-- Databases written only through the app upsert have no duplicate tuples.
-- Any that slipped in through older builds are collapsed first, keeping the
-- most recently inserted row per tuple (matching the upsert's
-- update-in-place semantics), so the index build cannot fail on them.
--
-- NOTE: drizzle-kit 0.31 mis-emits expression indexes (it splits on the
-- comma inside coalesce()), so this statement is maintained by hand; the
-- meta snapshot records the expression correctly.
DELETE FROM vitals WHERE rowid NOT IN (
  SELECT max(rowid) FROM vitals
  GROUP BY user_id, metric_key, recorded_at, source, coalesce(dependent_id, '')
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_vitals_upsert_tuple` ON `vitals` (`user_id`,`metric_key`,`recorded_at`,`source`,coalesce(`dependent_id`, ''));
