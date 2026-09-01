CREATE TABLE `nutrition_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`source_package` text NOT NULL,
	`calories` real,
	`protein_grams` real,
	`carbs_grams` real,
	`fat_grams` real,
	`fiber_grams` real,
	`sugar_grams` real,
	`sodium_milligrams` real,
	`record_count` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_nutrition_daily_user_date` ON `nutrition_daily` (`user_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_nutrition_daily_unique` ON `nutrition_daily` (`user_id`,`date`,`source_package`);--> statement-breakpoint
CREATE TABLE `health_connect_ingest_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text,
	`user_id` text NOT NULL,
	`payload_timestamp` text,
	`app_version` text,
	`body_sha256` text NOT NULL,
	`is_backfill` integer DEFAULT false NOT NULL,
	`window_start` text,
	`window_end` text,
	`status` text NOT NULL,
	`received_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`normalization_summary_json` text DEFAULT '{}' NOT NULL,
	`raw_envelope_json` text,
	`received_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`integration_id`) REFERENCES `health_connect_integrations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_health_connect_runs_user` ON `health_connect_ingest_runs` (`user_id`,`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_health_connect_runs_body` ON `health_connect_ingest_runs` (`integration_id`,`body_sha256`);--> statement-breakpoint
CREATE TABLE `health_connect_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'inventory' NOT NULL,
	`hmac_secret_encrypted` text NOT NULL,
	`allowed_sources_json` text DEFAULT '{}' NOT NULL,
	`enabled_types_json` text DEFAULT '[]' NOT NULL,
	`nutrition_strategy` text DEFAULT 'aggregate' NOT NULL,
	`last_received_at` text,
	`last_normalized_at` text,
	`last_app_version` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_health_connect_integrations_user` ON `health_connect_integrations` (`user_id`);--> statement-breakpoint
CREATE TABLE `health_connect_raw_records` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text,
	`user_id` text NOT NULL,
	`record_type` text NOT NULL,
	`source_package` text NOT NULL,
	`source_uuid` text NOT NULL,
	`identity_kind` text DEFAULT 'uuid' NOT NULL,
	`recorded_start_at` text,
	`recorded_end_at` text,
	`source_last_modified_at` text,
	`payload_json` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_ingest_id` text,
	`deleted_at` text,
	FOREIGN KEY (`integration_id`) REFERENCES `health_connect_integrations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_health_connect_raw_lookup` ON `health_connect_raw_records` (`user_id`,`record_type`,`recorded_start_at`);--> statement-breakpoint
CREATE INDEX `idx_health_connect_raw_integration` ON `health_connect_raw_records` (`integration_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_health_connect_raw_identity` ON `health_connect_raw_records` (`user_id`,`record_type`,`source_package`,`source_uuid`);