-- Idempotency markers keep concurrent paper buy/sell requests from
-- duplicating cash movements or position transitions.
ALTER TABLE paper_portfolios ADD COLUMN last_operation_id TEXT;
ALTER TABLE paper_positions ADD COLUMN close_operation_id TEXT;
