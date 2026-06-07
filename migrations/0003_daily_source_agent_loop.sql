CREATE TABLE IF NOT EXISTS daily_loop_runs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL CHECK (cadence IN ('manual', 'daily', 'hourly')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'cron', 'fixture')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'partial', 'failed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('fixture', 'live-safe')),
  bounded_concurrency INTEGER NOT NULL,
  retry_policy_json TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  observability_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_loop_sources (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES daily_loop_runs(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source TEXT NOT NULL,
  classification TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  checked_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  failure_message TEXT,
  query_metadata_json TEXT,
  page_metadata_json TEXT,
  detail_retry_metadata_json TEXT,
  raw_artifact_r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_loop_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES daily_loop_runs(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  listing_id TEXT REFERENCES listing_candidates(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_listing_id TEXT,
  duplicate_key TEXT NOT NULL,
  group_scoped_duplicate_key TEXT NOT NULL,
  triage_bucket TEXT NOT NULL CHECK (triage_bucket IN ('confirmed-match', 'review-needed', 'rejected', 'untriaged')),
  triage_status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  material_change_detected INTEGER NOT NULL DEFAULT 0,
  material_change_reasons_json TEXT NOT NULL DEFAULT '[]',
  normalized_candidate_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_loop_candidate_status (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES daily_loop_runs(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  listing_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processed', 'skipped-seen', 'skipped-saved', 'skipped-rejected', 'skipped-triaged', 'material-change-processed', 'provider-fallback-review-needed')),
  reason TEXT NOT NULL,
  material_change_detected INTEGER NOT NULL DEFAULT 0,
  material_change_reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_loop_seen_memory (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  duplicate_key TEXT NOT NULL,
  group_scoped_duplicate_key TEXT NOT NULL,
  memory_state TEXT NOT NULL CHECK (memory_state IN ('seen', 'rejected', 'downgraded')),
  reason TEXT NOT NULL,
  last_run_id TEXT REFERENCES daily_loop_runs(id) ON DELETE SET NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_loop_briefings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES daily_loop_runs(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  briefing_record_json TEXT NOT NULL,
  history_contract_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_daily_loop_runs_group_started ON daily_loop_runs(group_id, started_at);
CREATE INDEX IF NOT EXISTS idx_daily_loop_sources_run ON daily_loop_sources(run_id);
CREATE INDEX IF NOT EXISTS idx_daily_loop_candidates_run ON daily_loop_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_daily_loop_candidates_group_duplicate ON daily_loop_candidates(group_id, group_scoped_duplicate_key);
CREATE INDEX IF NOT EXISTS idx_daily_loop_candidate_status_run ON daily_loop_candidate_status(run_id);
CREATE INDEX IF NOT EXISTS idx_daily_loop_seen_memory_group_duplicate ON daily_loop_seen_memory(group_id, group_scoped_duplicate_key);
CREATE INDEX IF NOT EXISTS idx_daily_loop_briefings_group_run ON daily_loop_briefings(group_id, run_id);
