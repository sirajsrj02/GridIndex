-- Migration 005: add email_verify_expires_at to api_customers
--
-- The token column (email_verify_token VARCHAR(64)) already exists in the
-- initial schema. We only need the expiry timestamp so we can reject tokens
-- that are older than 24 hours without scanning every row.
--
-- is_email_verified BOOLEAN DEFAULT false also already exists.

ALTER TABLE api_customers
  ADD COLUMN IF NOT EXISTS email_verify_expires_at TIMESTAMPTZ;
