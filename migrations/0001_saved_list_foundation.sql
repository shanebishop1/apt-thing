CREATE TABLE IF NOT EXISTS listing_candidates (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  duplicate_key TEXT NOT NULL UNIQUE,
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

CREATE INDEX IF NOT EXISTS idx_listing_candidates_review_status ON listing_candidates(review_status);
CREATE INDEX IF NOT EXISTS idx_listing_candidates_source ON listing_candidates(source);
CREATE INDEX IF NOT EXISTS idx_listing_field_provenance_listing_id ON listing_field_provenance(listing_id);
