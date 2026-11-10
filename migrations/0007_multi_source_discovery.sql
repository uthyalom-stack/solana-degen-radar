-- Migration 0007: Unified multi-source discovery evidence and unconventional signal pipelines.
-- Evidence is append-only and source-attributed. Unknown/unavailable is never treated as safe.

CREATE TABLE IF NOT EXISTS discovery_candidates (
  mint TEXT PRIMARY KEY REFERENCES tokens(mint) ON DELETE CASCADE,
  first_discovered_at TEXT NOT NULL,
  last_discovered_at TEXT NOT NULL,
  discovery_score REAL NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  source_summary_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'candidate'
);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_recent ON discovery_candidates(last_discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_score ON discovery_candidates(discovery_score DESC);

CREATE TABLE IF NOT EXISTS discovery_evidence (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'weak',
  observed_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  UNIQUE(mint, source_type, source_id, evidence_type, evidence_hash)
);
CREATE INDEX IF NOT EXISTS idx_discovery_evidence_mint_time ON discovery_evidence(mint, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_evidence_source_time ON discovery_evidence(source_type, observed_at DESC);

CREATE TABLE IF NOT EXISTS discovery_source_status (
  source_type TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  items_seen INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS liquidity_observations (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  pair_address TEXT,
  dex_id TEXT,
  observed_at TEXT NOT NULL,
  liquidity_usd REAL,
  volume_5m_usd REAL,
  volume_1h_usd REAL,
  buys_5m INTEGER,
  sells_5m INTEGER,
  unique_buyer_count INTEGER,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_liquidity_observations_mint_time ON liquidity_observations(mint, observed_at DESC);

CREATE TABLE IF NOT EXISTS bridge_flow_observations (
  id TEXT PRIMARY KEY,
  wallet_address TEXT,
  source_chain TEXT NOT NULL,
  destination_chain TEXT NOT NULL,
  token_address TEXT,
  amount_usd REAL,
  tx_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(provider, tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_bridge_flows_wallet_time ON bridge_flow_observations(wallet_address, observed_at DESC);

CREATE TABLE IF NOT EXISTS launchpad_observations (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  launchpad TEXT NOT NULL,
  event_type TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  migration_target TEXT,
  signature TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(mint, launchpad, event_type, signature)
);
CREATE INDEX IF NOT EXISTS idx_launchpad_observations_time ON launchpad_observations(observed_at DESC);

CREATE TABLE IF NOT EXISTS bundle_observations (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  slot INTEGER,
  bundle_provider TEXT NOT NULL,
  bundle_reference TEXT,
  tip_lamports INTEGER,
  wallet_addresses_json TEXT NOT NULL DEFAULT '[]',
  observed_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(bundle_provider, signature)
);
CREATE INDEX IF NOT EXISTS idx_bundle_observations_mint_time ON bundle_observations(mint, observed_at DESC);

CREATE TABLE IF NOT EXISTS route_observations (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  route_available INTEGER,
  input_amount_raw TEXT,
  output_amount_raw TEXT,
  price_impact_pct REAL,
  route_plan_json TEXT,
  error_code TEXT,
  UNIQUE(mint, provider, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_route_observations_mint_time ON route_observations(mint, observed_at DESC);

CREATE TABLE IF NOT EXISTS token_media_fingerprints (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  normalized_url_hash TEXT NOT NULL,
  perceptual_hash TEXT,
  method TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(mint, normalized_url_hash, method)
);
CREATE INDEX IF NOT EXISTS idx_token_media_hash ON token_media_fingerprints(normalized_url_hash);

CREATE TABLE IF NOT EXISTS developer_signals (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  signal_value TEXT NOT NULL,
  domain TEXT,
  observed_at TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'weak',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(mint, signal_type, signal_value)
);
CREATE INDEX IF NOT EXISTS idx_developer_signals_domain ON developer_signals(domain);

CREATE TABLE IF NOT EXISTS program_activity_cursors (
  program_id TEXT PRIMARY KEY,
  last_signature TEXT,
  last_slot INTEGER,
  updated_at TEXT NOT NULL
);

-- Emerging meme/narrative terms detected before a matching token is known.
CREATE TABLE IF NOT EXISTS emerging_narratives (
  normalized_term TEXT PRIMARY KEY,
  display_term TEXT NOT NULL,
  term_type TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  independent_source_count INTEGER NOT NULL DEFAULT 0,
  engagement_total REAL NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_emerging_narratives_velocity ON emerging_narratives(last_seen_at DESC, mention_count DESC);
