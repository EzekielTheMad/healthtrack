CREATE TABLE `interaction_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`dependent_id` text,
	`has_interactions` integer DEFAULT false NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dependent_id`) REFERENCES `dependents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_interaction_checks_user` ON `interaction_checks` (`user_id`,`dependent_id`);--> statement-breakpoint
ALTER TABLE `interaction_alerts` ADD `snoozed_until` text;--> statement-breakpoint
ALTER TABLE `interaction_alerts` ADD `signature` text;--> statement-breakpoint
-- Preserve prior permanent dismissals: park them far in the future so they stay
-- hidden under the new snooze model (a re-check later reconciles/removes stale ones).
UPDATE `interaction_alerts` SET `snoozed_until` = '9999-12-31T00:00:00.000Z' WHERE `dismissed` = 1;