ALTER TABLE `interaction_alerts` ADD `context_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `interaction_checks` ADD `context_version` integer DEFAULT 0 NOT NULL;