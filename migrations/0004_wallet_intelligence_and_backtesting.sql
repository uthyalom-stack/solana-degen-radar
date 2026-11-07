-- Migration 0004: Advanced Wallet Intelligence, Breakout Signals, Backtesting, Live Transactions, and Paper Sessions

-- 1. Creators table for tracking token deployers
CREATE TABLE IF NOT EXISTS creators (
  address TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  total_tokens_created INTEGER NOT NULL DEFAULT 0,
  rug_count INTEGER NOT NULL DEFAULT 0,
  successful_tokens INTEGER NOT NULL DEFAULT 0,
  reputation_status TEXT NOT NULL DEFAULT 'unknown',
  reputation_score INTEGER NOT NULL DEFAULT 50,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Creator token associations
CREATE TABLE IF NOT EXISTS creator_tokens (
  creator_address TEXT NOT NULL REFERENCES creators(address) ON DELETE CASCADE,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  launch_liquidity_usd REAL,
  peak_market_cap_usd REAL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (creator_address, mint)
);

-- 3. Wallets directory (large holders, insiders, smart traders)
CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  reputation_category TEXT NOT NULL DEFAULT 'unknown', -- 'unknown', 'insufficient', 'established', 'suspicious'
  reputation_score INTEGER NOT NULL DEFAULT 50,
  total_trades INTEGER NOT NULL DEFAULT 0,
  profitable_trades INTEGER NOT NULL DEFAULT 0,
  win_rate_pct REAL NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT
);

-- 4. Wallet relationships & clustering (co-funding, transfer chains, coordinated swaps)
CREATE TABLE IF NOT EXISTS wallet_relationships (
  id TEXT PRIMARY KEY,
  wallet_a TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  wallet_b TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL, -- 'shared_funder', 'frequent_transfers', 'coordinated_buy', 'coordinated_exit'
  confidence_score INTEGER NOT NULL DEFAULT 50,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet_a, wallet_b, relationship_type)
);

-- 5. Wallet token activity history
CREATE TABLE IF NOT EXISTS wallet_activities (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES wallets(address) ON DELETE CASCADE,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  activity_type TEXT NOT NULL, -- 'buy', 'sell', 'transfer_in', 'transfer_out', 'accumulate', 'dump'
  amount_tokens REAL,
  amount_usd REAL,
  tx_signature TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Holder snapshots for historical concentration tracking
CREATE TABLE IF NOT EXISTS holder_snapshots (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  total_holders INTEGER,
  top10_percent REAL NOT NULL,
  top20_percent REAL,
  top_holders_json TEXT NOT NULL DEFAULT '[]', -- list of { address, amount, pct, is_pool, is_creator }
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Breakout signals
CREATE TABLE IF NOT EXISTS breakout_signals (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  signal_type TEXT NOT NULL, -- 'early_attention', 'momentum_surge', 'confirmed_breakout', 'overextended', 'distribution_warning'
  confidence INTEGER NOT NULL DEFAULT 50,
  momentum_score INTEGER NOT NULL,
  volume_acceleration_pct REAL,
  liquidity_growth_pct REAL,
  evidence_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' -- 'active', 'expired', 'invalidated'
);

-- 8. Paper trading sessions (allowing multiple user sessions and custom starting balances)
CREATE TABLE IF NOT EXISTS paper_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starting_balance REAL NOT NULL,
  cash_balance REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'archived'
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Live blockchain swap transactions (Phantom / Jupiter tracking)
CREATE TABLE IF NOT EXISTS live_transactions (
  signature TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  input_mint TEXT NOT NULL,
  output_mint TEXT NOT NULL,
  input_amount REAL NOT NULL,
  output_amount REAL NOT NULL,
  slippage_bps INTEGER NOT NULL,
  price_impact_pct REAL,
  status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted', 'confirming', 'confirmed', 'failed', 'expired'
  error_message TEXT,
  submitted_at TEXT NOT NULL,
  confirmed_at TEXT,
  route_plan_json TEXT
);

-- 10. Backtesting engine runs and trade records
CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strategy_config_json TEXT NOT NULL,
  dataset_range_start TEXT NOT NULL,
  dataset_range_end TEXT NOT NULL,
  total_trades INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  losing_trades INTEGER NOT NULL DEFAULT 0,
  win_rate_pct REAL NOT NULL DEFAULT 0,
  initial_capital_usd REAL NOT NULL,
  ending_capital_usd REAL NOT NULL,
  total_return_pct REAL NOT NULL DEFAULT 0,
  max_drawdown_pct REAL NOT NULL DEFAULT 0,
  profit_factor REAL NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  mint TEXT NOT NULL,
  symbol TEXT,
  entry_time TEXT NOT NULL,
  exit_time TEXT NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  pnl_usd REAL NOT NULL,
  pnl_pct REAL NOT NULL,
  holding_hours REAL NOT NULL,
  exit_reason TEXT NOT NULL, -- 'take_profit', 'stop_loss', 'time_expired', 'signal_exit'
  signal_type TEXT NOT NULL
);

-- Indexes for high-performance querying
CREATE INDEX IF NOT EXISTS idx_creators_reputation ON creators(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_creator_tokens_mint ON creator_tokens(mint);
CREATE INDEX IF NOT EXISTS idx_wallets_reputation ON wallets(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_activities_wallet ON wallet_activities(wallet_address, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_activities_mint ON wallet_activities(mint, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_holder_snapshots_mint ON holder_snapshots(mint, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_breakout_signals_time ON breakout_signals(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_breakout_signals_mint ON breakout_signals(mint, status);
CREATE INDEX IF NOT EXISTS idx_live_transactions_wallet ON live_transactions(wallet_address, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(run_id);
