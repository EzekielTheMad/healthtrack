CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_account_user` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `idx_session_user` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_verification_identifier` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `dashboard_stat_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`dependent_id` text,
	`widget_type` text DEFAULT 'vital' NOT NULL,
	`metric_key` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dash_stat_prefs_self_unique` ON `dashboard_stat_preferences` (`user_id`,`widget_type`,`metric_key`) WHERE dependent_id is null;--> statement-breakpoint
CREATE INDEX `idx_dash_stat_prefs_user_position` ON `dashboard_stat_preferences` (`user_id`,`dependent_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_dash_stat_dep` ON `dashboard_stat_preferences` (`user_id`,`dependent_id`,`widget_type`,`metric_key`);--> statement-breakpoint
CREATE TABLE `dependents` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_user_id` text NOT NULL,
	`name` text NOT NULL,
	`date_of_birth` text NOT NULL,
	`biological_sex` text,
	`relationship` text NOT NULL,
	`transition_age` integer DEFAULT 18 NOT NULL,
	`transitioned` integer DEFAULT false NOT NULL,
	`transitioned_to` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transitioned_to`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dependents_parent` ON `dependents` (`parent_user_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`date_of_birth` text,
	`biological_sex` text,
	`height_inches` integer,
	`weight_lbs` real,
	`unit_system` text DEFAULT 'imperial' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `allergies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`rxcui` text,
	`severity` text NOT NULL,
	`reaction` text,
	`diagnosed_date` text,
	`notes` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_allergies_user` ON `allergies` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_allergies_rxcui` ON `allergies` (`rxcui`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text,
	`appointment_date` text NOT NULL,
	`reason` text,
	`notes` text,
	`follow_up_date` text,
	`lab_visit_id` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lab_visit_id`) REFERENCES `lab_visits`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_appointments_user_date` ON `appointments` (`user_id`,"appointment_date" desc);--> statement-breakpoint
CREATE TABLE `conditions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`diagnosed_date` text,
	`provider_id` text,
	`notes` text,
	`icd10_code` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conditions_user_status` ON `conditions` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_conditions_dependent` ON `conditions` (`dependent_id`);--> statement-breakpoint
CREATE INDEX `idx_conditions_icd10` ON `conditions` (`icd10_code`);--> statement-breakpoint
CREATE TABLE `lab_results` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lab_visit_id` text NOT NULL,
	`panel_name` text,
	`test_name` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`reference_range_low` real,
	`reference_range_high` real,
	`reference_range_text` text,
	`flag` text,
	`loinc_code` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lab_visit_id`) REFERENCES `lab_visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lab_results_user_test` ON `lab_results` (`user_id`,`test_name`);--> statement-breakpoint
CREATE INDEX `idx_lab_results_loinc` ON `lab_results` (`loinc_code`);--> statement-breakpoint
CREATE TABLE `lab_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`visit_date` text NOT NULL,
	`provider_id` text,
	`source_pdf_path` text,
	`notes` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lab_visits_user_date` ON `lab_visits` (`user_id`,"visit_date" desc);--> statement-breakpoint
CREATE INDEX `idx_lab_visits_dependent` ON `lab_visits` (`dependent_id`);--> statement-breakpoint
CREATE TABLE `medications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`dosage` text,
	`frequency` text,
	`category` text,
	`prescriber_id` text,
	`start_date` text,
	`end_date` text,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`rxcui` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prescriber_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_medications_user_active` ON `medications` (`user_id`,`active`);--> statement-breakpoint
CREATE INDEX `idx_medications_dependent` ON `medications` (`dependent_id`);--> statement-breakpoint
CREATE INDEX `idx_medications_rxcui` ON `medications` (`rxcui`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`note_type` text DEFAULT 'general' NOT NULL,
	`severity` integer,
	`tags` text DEFAULT '[]' NOT NULL,
	`recorded_at` text NOT NULL,
	`dependent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notes_user_date` ON `notes` (`user_id`,"recorded_at" desc);--> statement-breakpoint
CREATE TABLE `procedures` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`cpt_code` text,
	`procedure_date` text NOT NULL,
	`provider_id` text,
	`notes` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_procedures_user_date` ON `procedures` (`user_id`,"procedure_date" desc);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`provider_type` text,
	`specialty` text,
	`organization` text,
	`phone` text,
	`fax` text,
	`address` text,
	`city` text,
	`state` text,
	`zip` text,
	`portal_url` text,
	`notes` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	`specialty_taxonomy` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_providers_user` ON `providers` (`user_id`,"is_favorite" desc,`name`);--> statement-breakpoint
CREATE TABLE `vaccines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`cvx_code` text,
	`vaccine_date` text NOT NULL,
	`dose_number` text,
	`series_doses` text,
	`manufacturer` text,
	`lot_number` text,
	`provider_id` text,
	`next_dose_date` text,
	`notes` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vaccines_user_date` ON `vaccines` (`user_id`,"vaccine_date" desc);--> statement-breakpoint
CREATE INDEX `idx_vaccines_cvx` ON `vaccines` (`cvx_code`);--> statement-breakpoint
CREATE TABLE `vital_reference_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`metric_key` text NOT NULL,
	`label` text NOT NULL,
	`unit` text,
	`range_low` real,
	`range_high` real,
	`age_min` integer,
	`age_max` integer,
	`sex` text,
	`source_citation` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vital_source_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`preferred_source` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vital_source_preferences_user_metric_unique` ON `vital_source_preferences` (`user_id`,`metric_key`);--> statement-breakpoint
CREATE TABLE `vitals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`metric_key` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`source` text NOT NULL,
	`recorded_at` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`dependent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_vitals_user_metric` ON `vitals` (`user_id`,`metric_key`,"recorded_at" desc);--> statement-breakpoint
CREATE INDEX `idx_vitals_dependent` ON `vitals` (`dependent_id`);--> statement-breakpoint
CREATE TABLE `delegates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`delegate_user_id` text,
	`delegate_email` text NOT NULL,
	`permission_level` text DEFAULT 'read_only' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_at` text NOT NULL,
	`accepted_at` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`delegate_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_delegates_owner` ON `delegates` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_delegates_delegate_user` ON `delegates` (`delegate_user_id`);--> statement-breakpoint
CREATE INDEX `idx_delegates_email` ON `delegates` (`delegate_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_delegates_unique_pair` ON `delegates` (`owner_id`,`delegate_email`) WHERE status != 'rejected';--> statement-breakpoint
CREATE TABLE `health_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`shared_with_email` text NOT NULL,
	`shared_with_id` text,
	`access_level` text DEFAULT 'read' NOT NULL,
	`shared_sections` text DEFAULT '["medications","labs","vitals","conditions"]' NOT NULL,
	`share_token` text,
	`accepted` integer DEFAULT false NOT NULL,
	`expires_at` text,
	`dependent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shared_with_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `health_shares_share_token_unique` ON `health_shares` (`share_token`);--> statement-breakpoint
CREATE INDEX `idx_health_shares_dependent` ON `health_shares` (`dependent_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes` text DEFAULT '["read:all"]' NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_unique` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_hash` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE TABLE `connected_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_name` text NOT NULL,
	`access_token_encrypted` text,
	`refresh_token_encrypted` text,
	`token_expires_at` text,
	`last_sync_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `interaction_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`trigger_medication_id` text NOT NULL,
	`alert_text` text NOT NULL,
	`severity` text DEFAULT 'warning' NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`checked_at` text NOT NULL,
	`medication_snapshot` text NOT NULL,
	`dependent_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_interaction_alerts_user` ON `interaction_alerts` (`user_id`,`dismissed`,"checked_at" desc);--> statement-breakpoint
CREATE TABLE `query_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`query_text` text NOT NULL,
	`response_text` text NOT NULL,
	`dependent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `breach_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`discovered_at` text NOT NULL,
	`affected_scope` text DEFAULT 'all' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `breach_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`breach_event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_email` text NOT NULL,
	`notified_at` text,
	`notification_method` text DEFAULT 'email',
	`created_at` text NOT NULL,
	FOREIGN KEY (`breach_event_id`) REFERENCES `breach_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_breach_notif_pending` ON `breach_notifications` (`notified_at`);