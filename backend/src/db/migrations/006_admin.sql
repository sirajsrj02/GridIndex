-- Migration 006: add is_admin flag to api_customers
--
-- Admin users can access /api/admin/* routes which expose aggregate
-- customer data, usage stats, and plan management.  The flag defaults
-- false so existing rows are unaffected.

ALTER TABLE api_customers
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
