CREATE TABLE IF NOT EXISTS app_saved_listings (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  duplicate_key TEXT NOT NULL,
  group_scoped_duplicate_key TEXT NOT NULL,
  listing_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_group_actions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('comment', 'reaction', 'status-change', 'source-link-open', 'feedback')),
  actor_identity_token TEXT,
  action_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_seen_rejected_memory (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  group_scoped_duplicate_key TEXT NOT NULL,
  memory_json TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_extraction_jobs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  listing_id TEXT,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'partial', 'failed', 'manual-needed')),
  job_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_saved_listings_group_url
  ON app_saved_listings(group_id, url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_saved_listings_group_duplicate
  ON app_saved_listings(group_id, group_scoped_duplicate_key);
CREATE INDEX IF NOT EXISTS idx_app_saved_listings_group_updated
  ON app_saved_listings(group_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_app_group_actions_group_listing
  ON app_group_actions(group_id, listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_group_actions_reaction_dedupe
  ON app_group_actions(group_id, listing_id, action_type, actor_identity_token, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_seen_rejected_group_duplicate
  ON app_seen_rejected_memory(group_id, group_scoped_duplicate_key);
CREATE INDEX IF NOT EXISTS idx_app_extraction_jobs_group_listing
  ON app_extraction_jobs(group_id, listing_id, updated_at);
