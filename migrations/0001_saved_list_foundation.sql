CREATE TABLE IF NOT EXISTS search_groups (
  id TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_candidates (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  duplicate_key TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  title TEXT NOT NULL,
  extraction_status TEXT NOT NULL CHECK (
    extraction_status IN ('pending', 'success', 'partial', 'failed', 'manual-needed')
  ),
  review_status TEXT NOT NULL CHECK (review_status IN ('new', 'interested', 'touring', 'rejected')),
  address TEXT NOT NULL,
  neighborhood TEXT,
  borough TEXT,
  rent INTEGER,
  bedrooms REAL,
  bathrooms REAL,
  available_at TEXT,
  description TEXT,
  fit_flags_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  concerns_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_field_provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listing_candidates(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai-extracted', 'user-confirmed', 'user-edited')),
  original_value TEXT,
  edited_value TEXT,
  actor TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO search_groups (id, invite_code, name, created_at, updated_at)
VALUES ('nyc-5br-2026', 'apt-g1', 'NYC 5BR search', datetime('now'), datetime('now'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_candidates_group_url
  ON listing_candidates(group_id, url);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_candidates_group_duplicate_key
  ON listing_candidates(group_id, duplicate_key);
CREATE INDEX IF NOT EXISTS idx_listing_candidates_group_review_status
  ON listing_candidates(group_id, review_status);
CREATE INDEX IF NOT EXISTS idx_listing_candidates_group_source ON listing_candidates(group_id, source);
CREATE INDEX IF NOT EXISTS idx_listing_field_provenance_listing_id ON listing_field_provenance(listing_id);
