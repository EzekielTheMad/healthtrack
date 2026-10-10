DROP INDEX `ai_lab_warning_dismissals_user_key_unique`;--> statement-breakpoint
ALTER TABLE `ai_lab_warning_dismissals` ADD `context_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_lab_warning_dismissals_user_key_context_unique` ON `ai_lab_warning_dismissals` (`user_id`,`warning_key`,`context_version`);--> statement-breakpoint
DROP INDEX `daily_summaries_user_date_unique`;--> statement-breakpoint
ALTER TABLE `daily_summaries` ADD `context_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `daily_summaries_user_date_context_unique` ON `daily_summaries` (`user_id`,`summary_date`,`context_version`);--> statement-breakpoint
ALTER TABLE `query_history` ADD `context_version` integer DEFAULT 0 NOT NULL;