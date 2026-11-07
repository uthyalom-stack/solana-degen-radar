PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS social_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  url TEXT,
  text_content TEXT NOT NULL,
  metrics_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  normalized_key TEXT NOT NULL UNIQUE,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  narrative_score INTEGER,
  status TEXT NOT NULL DEFAULT 'watch',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS narrative_signals (
  id TEXT PRIMARY KEY,
  narrative_id TEXT NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  independent_source_count INTEGER NOT NULL DEFAULT 0,
  engagement_total REAL NOT NULL DEFAULT 0,
  score INTEGER
);

CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  decimals INTEGER,
  first_seen_at TEXT NOT NULL,
  source TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS token_snapshots (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  pair_address TEXT,
  observed_at TEXT NOT NULL,
  price_usd REAL,
  liquidity_usd REAL,
  volume_5m_usd REAL,
  volume_1h_usd REAL,
  market_cap_usd REAL,
  fdv_usd REAL,
  momentum_score INTEGER,
  txns_5m_json TEXT,
  raw_json TEXT,
  UNIQUE(mint, pair_address, observed_at)
);

CREATE TABLE IF NOT EXISTS token_narratives (
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  narrative_id TEXT NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(mint, narrative_id)
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  assessed_at TEXT NOT NULL,
  risk_score INTEGER,
  status TEXT NOT NULL,
  flags_json TEXT NOT NULL DEFAULT '[]',
  unknowns_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT
);

CREATE TABLE IF NOT EXISTS wallet_observations (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  role TEXT,
  metrics_json TEXT,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS paper_portfolios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quote_currency TEXT NOT NULL DEFAULT 'USD',
  starting_balance REAL NOT NULL,
  cash_balance REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_positions (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES paper_portfolios(id),
  mint TEXT NOT NULL REFERENCES tokens(mint),
  status TEXT NOT NULL DEFAULT 'open',
  quantity REAL NOT NULL,
  entry_price_usd REAL NOT NULL,
  entry_value_usd REAL NOT NULL,
  fees_usd REAL NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  exit_price_usd REAL,
  realized_pnl_usd REAL
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES paper_portfolios(id),
  position_id TEXT REFERENCES paper_positions(id),
  mint TEXT NOT NULL REFERENCES tokens(mint),
  side TEXT NOT NULL CHECK(side IN ('buy','sell')),
  executed_at TEXT NOT NULL,
  reference_price_usd REAL NOT NULL,
  simulated_price_usd REAL NOT NULL,
  quantity REAL NOT NULL,
  notional_usd REAL NOT NULL,
  fees_usd REAL NOT NULL DEFAULT 0,
  slippage_bps INTEGER NOT NULL DEFAULT 0,
  signal_json TEXT
);

CREATE TABLE IF NOT EXISTS scanner_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_social_events_observed ON social_events(observed_at);
CREATE INDEX IF NOT EXISTS idx_narrative_signals_time ON narrative_signals(narrative_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_token_snapshots_time ON token_snapshots(mint, observed_at);
CREATE INDEX IF NOT EXISTS idx_risk_assessments_mint ON risk_assessments(mint, assessed_at);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_paper_positions_status ON paper_positions(status, opened_at);
CREATE INDEX IF NOT EXISTS idx_scanner_runs_job ON scanner_runs(job_name, started_at);

CREATE INDEX IF NOT EXISTS idx_token_snapshots_volume ON token_snapshots(volume_1h_usd DESC);
CREATE INDEX IF NOT EXISTS idx_social_events_source_time ON social_events(source, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_subject ON alerts(subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pumpportal_events (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  event_type TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pumpportal_events_mint_time ON pumpportal_events(mint, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pumpportal_events_time ON pumpportal_events(observed_at DESC);
