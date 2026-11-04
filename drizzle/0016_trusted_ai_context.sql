ALTER TABLE interaction_alerts ADD COLUMN context_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE interaction_checks ADD COLUMN context_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ai_lab_warning_dismissals ADD COLUMN context_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE interaction_checks ADD COLUMN ai_provenance TEXT;
