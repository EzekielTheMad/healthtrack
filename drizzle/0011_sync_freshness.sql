ALTER TABLE `vitals` ADD `last_received_at` text;
--> statement-breakpoint
ALTER TABLE `connected_sources` ADD `last_attempt_at` text;
--> statement-breakpoint
ALTER TABLE `connected_sources` ADD `last_success_at` text;
--> statement-breakpoint
ALTER TABLE `connected_sources` ADD `last_outcome` text;
--> statement-breakpoint
ALTER TABLE `connected_sources` ADD `last_error_code` text;
--> statement-breakpoint
ALTER TABLE `connected_sources` ADD `next_retry_at` text;
