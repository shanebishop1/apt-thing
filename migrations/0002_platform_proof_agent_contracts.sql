CREATE TABLE IF NOT EXISTS platform_binding_smoke (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_evidence_records (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  listing_id TEXT REFERENCES listing_candidates(id) ON DELETE SET NULL,
  run_id TEXT,
  source_url TEXT NOT NULL,
  claim TEXT NOT NULL,
  quote TEXT NOT NULL,
  storage_owner TEXT NOT NULL CHECK (storage_owner IN ('d1', 'r2')),
  storage_key TEXT NOT NULL,
  content_type TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run_logs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL CHECK (cadence IN ('manual', 'daily', 'hourly')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'cron', 'fixture')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'partial', 'failed')),
  bounded_concurrency INTEGER NOT NULL,
  retry_policy_json TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_run_units (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_run_logs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_url TEXT,
  listing_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed', 'skipped-seen', 'skipped-triaged')),
  attempt INTEGER NOT NULL,
  max_retries INTEGER NOT NULL,
  error_code TEXT,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS briefing_records (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES search_groups(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_run_logs(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_platform_binding_smoke_group ON platform_binding_smoke(group_id);
CREATE INDEX IF NOT EXISTS idx_source_evidence_group_run ON source_evidence_records(group_id, run_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_logs_group_started ON agent_run_logs(group_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_units_run ON agent_run_units(run_id);
CREATE INDEX IF NOT EXISTS idx_briefing_records_group_run ON briefing_records(group_id, run_id);
