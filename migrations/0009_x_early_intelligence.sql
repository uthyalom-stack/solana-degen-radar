-- Migration 0009: X first-caller and social convergence evidence.
-- These records describe observed public posts, not proof of caller skill or coordination.

CREATE TABLE IF NOT EXISTS x_mint_mentions (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  author_id TEXT,
  username TEXT,
  observed_at TEXT NOT NULL,
  url TEXT,
  engagement REAL NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  followers INTEGER,
  account_created_at TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  query_type TEXT,
  text_snippet TEXT,
  UNIQUE(mint, tweet_id)
);
CREATE INDEX IF NOT EXISTS idx_x_mint_mentions_mint_time ON x_mint_mentions(mint, observed_at);
CREATE INDEX IF NOT EXISTS idx_x_mint_mentions_author_time ON x_mint_mentions(author_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_x_mint_mentions_time ON x_mint_mentions(observed_at DESC);

CREATE TABLE IF NOT EXISTS x_social_accounts (
  author_id TEXT PRIMARY KEY,
  username TEXT,
  account_created_at TEXT,
  followers INTEGER,
  verified INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  tweets_seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_x_social_accounts_username ON x_social_accounts(username);

CREATE TABLE IF NOT EXISTS x_engagement_snapshots (
  id TEXT PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  post_created_at TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  engagement REAL NOT NULL DEFAULT 0,
  UNIQUE(tweet_id, captured_at)
);
CREATE INDEX IF NOT EXISTS idx_x_engagement_tweet_time ON x_engagement_snapshots(tweet_id, captured_at DESC);
