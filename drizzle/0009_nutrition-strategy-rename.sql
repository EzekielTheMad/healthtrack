-- Rename the nutrition strategy values: 'aggregate' → 'sum_items',
-- 'daily_snapshot' → 'latest_summary' (and the column default with them).
--
-- HAND-WRITTEN, not the drizzle-kit default output. SQLite cannot ALTER a
-- column default, so the table must be recreated — but `PRAGMA foreign_keys`
-- is a NO-OP inside a transaction, and the migrator runs every statement
-- inside one BEGIN. DROP TABLE on the parent therefore performs an implicit
-- DELETE that FIRES the children's ON DELETE SET NULL actions, silently
-- orphaning every retained raw record and ingest run from its integration.
--
-- So the child links are saved first and restored afterwards. Rows whose
-- integration_id was ALREADY null (deliberately orphaned by a
-- "delete integration, keep raw history" choice) have no saved link and stay
-- null — the restore is strictly a repair of what this migration broke.
CREATE TABLE `__hc_raw_link` AS
  SELECT `id`, `integration_id` FROM `health_connect_raw_records`
  WHERE `integration_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `__hc_run_link` AS
  SELECT `id`, `integration_id` FROM `health_connect_ingest_runs`
  WHERE `integration_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_health_connect_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'inventory' NOT NULL,
	`hmac_secret_encrypted` text NOT NULL,
	`allowed_sources_json` text DEFAULT '{}' NOT NULL,
	`enabled_types_json` text DEFAULT '[]' NOT NULL,
	`nutrition_strategy` text DEFAULT 'sum_items' NOT NULL,
	`last_received_at` text,
	`last_normalized_at` text,
	`last_app_version` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_health_connect_integrations`("id", "user_id", "name", "status", "hmac_secret_encrypted", "allowed_sources_json", "enabled_types_json", "nutrition_strategy", "last_received_at", "last_normalized_at", "last_app_version", "last_error", "created_at", "updated_at")
  SELECT "id", "user_id", "name", "status", "hmac_secret_encrypted", "allowed_sources_json", "enabled_types_json",
    CASE "nutrition_strategy"
      WHEN 'aggregate' THEN 'sum_items'
      WHEN 'daily_snapshot' THEN 'latest_summary'
      WHEN 'latest_summary' THEN 'latest_summary'
      ELSE 'sum_items'
    END,
    "last_received_at", "last_normalized_at", "last_app_version", "last_error", "created_at", "updated_at"
  FROM `health_connect_integrations`;
--> statement-breakpoint
DROP TABLE `health_connect_integrations`;
--> statement-breakpoint
ALTER TABLE `__new_health_connect_integrations` RENAME TO `health_connect_integrations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_health_connect_integrations_user` ON `health_connect_integrations` (`user_id`);
--> statement-breakpoint
UPDATE `health_connect_raw_records`
  SET `integration_id` = (SELECT `integration_id` FROM `__hc_raw_link` WHERE `__hc_raw_link`.`id` = `health_connect_raw_records`.`id`)
  WHERE `integration_id` IS NULL
    AND EXISTS (SELECT 1 FROM `__hc_raw_link` WHERE `__hc_raw_link`.`id` = `health_connect_raw_records`.`id`);
--> statement-breakpoint
UPDATE `health_connect_ingest_runs`
  SET `integration_id` = (SELECT `integration_id` FROM `__hc_run_link` WHERE `__hc_run_link`.`id` = `health_connect_ingest_runs`.`id`)
  WHERE `integration_id` IS NULL
    AND EXISTS (SELECT 1 FROM `__hc_run_link` WHERE `__hc_run_link`.`id` = `health_connect_ingest_runs`.`id`);
--> statement-breakpoint
DROP TABLE `__hc_raw_link`;
--> statement-breakpoint
DROP TABLE `__hc_run_link`;
