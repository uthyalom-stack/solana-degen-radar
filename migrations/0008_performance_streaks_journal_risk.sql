-- Migration 0008: user performance, journal, streaks and risk controls.
-- Session-scoped records keep anonymous/paper sessions isolated until account auth is introduced.

CREATE TABLE IF NOT EXISTS performance_activity (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  activity_date TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  reference_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, activity_date)
);
CREATE INDEX IF NOT EXISTS idx_performance_activity_session_date
  ON performance_activity(session_id, activity_date DESC);

CREATE TABLE IF NOT EXISTS trade_journal_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  position_id TEXT,
  mint TEXT,
  title TEXT NOT NULL,
  thesis TEXT NOT NULL DEFAULT '',
  entry_reason TEXT NOT NULL DEFAULT '',
  exit_reason TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  mood TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trade_journal_session_time
  ON trade_journal_entries(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_journal_position
  ON trade_journal_entries(position_id);

CREATE TABLE IF NOT EXISTS portfolio_risk_settings (
  session_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  daily_loss_limit_usd REAL,
  max_open_positions INTEGER,
  max_position_size_usd REAL,
  cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_risk_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_events_session_time
  ON portfolio_risk_events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_templates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategy_templates_session
  ON strategy_templates(session_id, updated_at DESC);
