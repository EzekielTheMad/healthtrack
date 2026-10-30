CREATE TABLE mobile_pairings (
  id TEXT PRIMARY KEY NOT NULL,
  device_name TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_by TEXT REFERENCES user(id) ON DELETE CASCADE,
  approved_subjects_json TEXT NOT NULL DEFAULT '[]',
  replace_existing INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  redeemed_at TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_mobile_pairings_expiry ON mobile_pairings(expires_at);
--> statement-breakpoint
CREATE TABLE mobile_devices (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  integration_id TEXT REFERENCES health_connect_integrations(id) ON DELETE SET NULL,
  generation TEXT NOT NULL,
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  hmac_secret_encrypted TEXT NOT NULL,
  grant_revision INTEGER NOT NULL DEFAULT 1,
  allowed_subjects_json TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_contact_at TEXT,
  revoked_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mobile_active_owner ON mobile_devices(user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mobile_device_key ON mobile_devices(key_id);
--> statement-breakpoint
CREATE TABLE mobile_delivery_modes (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('legacy', 'native')),
  device_id TEXT REFERENCES mobile_devices(id) ON DELETE SET NULL
);
