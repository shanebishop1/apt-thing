-- Optimistic concurrency for shared listings. Existing rows start at revision 1;
-- every successful existing-record mutation increments the revision atomically.
ALTER TABLE app_saved_listings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
