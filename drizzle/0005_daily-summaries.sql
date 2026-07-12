CREATE TABLE `daily_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`summary_date` text NOT NULL,
	`summary_json` text NOT NULL,
	`generated_at` text NOT NULL,
	`model` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_summaries_user_date_unique` ON `daily_summaries` (`user_id`,`summary_date`);