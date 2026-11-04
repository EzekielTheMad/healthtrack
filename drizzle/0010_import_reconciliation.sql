CREATE TABLE `import_batches` (
 `id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
 `dependent_id` text REFERENCES `dependents`(`id`) ON DELETE CASCADE,
 `file_hash` text NOT NULL, `kind` text NOT NULL, `file_name` text NOT NULL, `source_path` text,
 `status` text DEFAULT 'pending' NOT NULL, `warnings` text DEFAULT '[]' NOT NULL,
 `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
 `updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_import_batch_file` ON `import_batches` (`user_id`,coalesce(`dependent_id`, ''),`file_hash`,`kind`);
--> statement-breakpoint
CREATE TABLE `import_items` (
 `id` text PRIMARY KEY NOT NULL, `batch_id` text NOT NULL REFERENCES `import_batches`(`id`) ON DELETE CASCADE,
 `position` integer NOT NULL, `domain` text NOT NULL, `payload` text NOT NULL, `applied_payload` text,
 `status` text DEFAULT 'pending' NOT NULL, `classification` text DEFAULT 'new' NOT NULL,
 `record_id` text, `action` text, `error` text,
 `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_import_items_batch` ON `import_items` (`batch_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_import_items_position` ON `import_items` (`batch_id`,`position`);
--> statement-breakpoint
CREATE TABLE `clinical_corrections` (
 `id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
 `dependent_id` text REFERENCES `dependents`(`id`) ON DELETE CASCADE,
 `domain` text NOT NULL, `record_id` text NOT NULL,
 `batch_item_id` text REFERENCES `import_items`(`id`) ON DELETE SET NULL,
 `before_json` text NOT NULL, `after_json` text NOT NULL, `reason` text,
 `created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_clinical_corrections_record` ON `clinical_corrections` (`user_id`,`domain`,`record_id`);
