CREATE TABLE ai_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  provider TEXT,
  encrypted_key TEXT,
  primary_model TEXT,
  extraction_model TEXT,
  models_json TEXT NOT NULL DEFAULT '[]',
  tested_at TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE ai_setting_drafts (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  base_revision TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  models_json TEXT NOT NULL DEFAULT '[]',
  test_id TEXT,
  tested_selection TEXT,
  tested_at TEXT,
  expires_at INTEGER NOT NULL
);
