-- Attribute only newly inserted shortlist rows to their discovery run. This lets
-- the same transaction compute saved counts without counting refresh no-ops.
ALTER TABLE app_saved_listings ADD COLUMN discovery_run_id TEXT
  REFERENCES daily_loop_runs(id) ON DELETE SET NULL;
CREATE INDEX idx_app_saved_listings_discovery_run ON app_saved_listings(discovery_run_id);

-- Close the race between checking for an active run and claiming the run lease.
CREATE UNIQUE INDEX idx_daily_loop_runs_one_active_per_group
  ON daily_loop_runs(group_id)
  WHERE status IN ('queued', 'running');
