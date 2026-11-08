-- Migration 0005: Paper Sessions Support, Persistent Idempotency, and Token Risk Extensions

-- Add session_id to paper_positions if not existing
ALTER TABLE paper_positions ADD COLUMN session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_paper_positions_session ON paper_positions(session_id);

-- Add session_id and trigger_signal to paper_trades
ALTER TABLE paper_trades ADD COLUMN session_id TEXT;
ALTER TABLE paper_trades ADD COLUMN trigger_signal TEXT;
CREATE INDEX IF NOT EXISTS idx_paper_trades_session ON paper_trades(session_id);

-- Extend tokens table with verified risk fields
ALTER TABLE tokens ADD COLUMN is_sellable INTEGER DEFAULT NULL;
ALTER TABLE tokens ADD COLUMN sellability_status TEXT DEFAULT 'unverified';
ALTER TABLE tokens ADD COLUMN token_program TEXT DEFAULT 'Tokenkeg';
ALTER TABLE tokens ADD COLUMN transfer_fee_bps INTEGER DEFAULT 0;

-- Persistent Idempotency Cache Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
