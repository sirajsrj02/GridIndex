-- Track which usage warning tier (80 or 95) has already been emailed this month.
-- Resets to 0 alongside calls_this_month at the monthly rollover.
-- Allowed values: 0 (none sent), 80 (80% warning sent), 95 (95% warning sent).
ALTER TABLE api_customers
  ADD COLUMN IF NOT EXISTS usage_warning_sent SMALLINT NOT NULL DEFAULT 0;
