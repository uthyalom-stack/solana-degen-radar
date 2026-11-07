-- Enhanced schema for Solana Degen Radar: launchpads, holders, LP burns, and provider status tracking.

ALTER TABLE tokens ADD COLUMN creator_address TEXT;
ALTER TABLE tokens ADD COLUMN launchpad TEXT;
ALTER TABLE tokens ADD COLUMN holder_count INTEGER;
ALTER TABLE tokens ADD COLUMN is_migrated INTEGER DEFAULT 0;
ALTER TABLE tokens ADD COLUMN migration_target TEXT;
ALTER TABLE tokens ADD COLUMN lp_burned_percent REAL;
ALTER TABLE tokens ADD COLUMN top10_holder_percent REAL;

ALTER TABLE paper_portfolios ADD COLUMN config_json TEXT;

CREATE TABLE IF NOT EXISTS provider_statuses (
  provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_tokens_launchpad ON tokens(launchpad);
CREATE INDEX IF NOT EXISTS idx_provider_statuses_category ON provider_statuses(category);
