CREATE TABLE `query_contexts` (
  `query_id` text PRIMARY KEY NOT NULL REFERENCES `query_history`(`id`) ON DELETE CASCADE,
  `metadata_json` text NOT NULL
);
--> statement-breakpoint
-- Discard generated legacy summaries whose patient/source scope was inconsistent.
-- Clinical records and uploaded documents are untouched.
DELETE FROM `daily_summaries`;
