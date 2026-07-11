CREATE TABLE `ai_lab_warning_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`warning_key` text NOT NULL,
	`lab_visit_date` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_lab_warning_dismissals_user_key_unique` ON `ai_lab_warning_dismissals` (`user_id`,`warning_key`);