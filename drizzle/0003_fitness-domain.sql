CREATE TABLE `exercise_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`sets` text DEFAULT '[]' NOT NULL,
	`raw_sets` text,
	`notes` text,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_exercise_entries_session` ON `exercise_entries` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_exercise_entries_exercise` ON `exercise_entries` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`variant` text,
	`mode` text DEFAULT 'weight' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`review_status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_exercises_user` ON `exercises` (`user_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`metric_key` text,
	`direction` text,
	`target_value` real,
	`target_date` text,
	`session_type` text,
	`per_week` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_goals_user` ON `goals` (`user_id`);--> statement-breakpoint
CREATE TABLE `weekly_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`working` text,
	`not_working` text,
	`days_logged` integer,
	`avg_calories` real,
	`avg_protein_g` real,
	`avg_carbs_g` real,
	`avg_fat_g` real,
	`avg_fiber_g` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_checkins_user_week_unique` ON `weekly_checkins` (`user_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`dependent_id` text,
	`type` text NOT NULL,
	`label` text,
	`started_at` text NOT NULL,
	`duration_min` real,
	`energy` integer,
	`notes` text,
	`distance_mi` real,
	`avg_hr` real,
	`calories` real,
	`steps` integer,
	`machine` text,
	`perceived_effort` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workout_sessions_user_started` ON `workout_sessions` (`user_id`,"started_at" desc);--> statement-breakpoint
CREATE INDEX `idx_workout_sessions_dependent` ON `workout_sessions` (`dependent_id`);--> statement-breakpoint
-- NOTE: drizzle-kit 0.31 mis-emits expression indexes (it splits on the
-- comma inside coalesce()), so this statement is maintained by hand (same as
-- idx_vitals_upsert_tuple in 0002); the meta snapshot records the expression
-- correctly. SQLite treats NULLs as distinct in unique indexes, so the
-- nullable dependent_id is coalesced to '' — owner rows (dependent_id NULL)
-- are actually constrained.
CREATE UNIQUE INDEX `idx_workout_sessions_dedupe` ON `workout_sessions` (`user_id`,`started_at`,coalesce(`dependent_id`, ''));