CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`note` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_email` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_unique` ON `invites` (`token`);