-- Migration 0006: Atomic Idempotency Reservations, Rate Limiting Counters, and Advanced PnL Records

-- 1. Atomic Idempotency Table with Request Binding and Status (pending, completed, failed)
CREATE TABLE IF NOT EXISTS idempotency_reservations (
  key TEXT PRIMARY KEY,
  identity TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_res_exp ON idempotency_reservations(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_res_ident ON idempotency_reservations(identity, endpoint);

-- 2. Concurrency-safe Rate Limiter Table with Atomic Counters
CREATE TABLE IF NOT EXISTS rate_limits (
  limit_key TEXT PRIMARY KEY, -- e.g. "ip:1.2.3.4:/api/paper/buy:2026-11-08T15:00"
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_exp ON rate_limits(expires_at);

-- 3. PnL Generator Share Cards Table
CREATE TABLE IF NOT EXISTS pnl_cards (
  id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL, -- 'trade' or 'portfolio'
  trade_type TEXT NOT NULL, -- 'PAPER' or 'LIVE'
  mint TEXT,
  symbol TEXT,
  name TEXT,
  buy_price_usd REAL,
  sell_price_usd REAL,
  invested_usd REAL,
  quantity REAL,
  realized_pnl_usd REAL,
  unrealized_pnl_usd REAL,
  roi_pct REAL NOT NULL,
  duration_seconds INTEGER,
  tx_signature TEXT,
  portfolio_summary_json TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pnl_cards_mint ON pnl_cards(mint);
CREATE INDEX IF NOT EXISTS idx_pnl_cards_type ON pnl_cards(card_type, trade_type);
CREATE INDEX IF NOT EXISTS idx_pnl_cards_created ON pnl_cards(created_at DESC);

-- 4. Survival Predictions History
CREATE TABLE IF NOT EXISTS survival_predictions (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  prob_5m REAL NOT NULL,
  prob_15m REAL NOT NULL,
  prob_1h REAL NOT NULL,
  prob_6h REAL NOT NULL,
  prob_24h REAL NOT NULL,
  features_json TEXT NOT NULL,
  actual_survived_24h INTEGER DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_survival_mint ON survival_predictions(mint, observed_at DESC);
