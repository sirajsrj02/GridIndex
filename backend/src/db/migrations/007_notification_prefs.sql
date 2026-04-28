-- Add notification_prefs JSONB column to api_customers.
-- Stores per-customer opt-in/out for each notification category.
-- Default: all notifications on.

ALTER TABLE api_customers
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{
    "usage_warnings": true,
    "alert_emails":   true,
    "product_emails": true
  }';
