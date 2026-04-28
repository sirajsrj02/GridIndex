-- Password reset tokens table
-- Each row represents a single-use reset link sent to a customer.
-- token_hash stores SHA-256(raw_token) so the raw token never touches the DB.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          BIGSERIAL    PRIMARY KEY,
  customer_id BIGINT       NOT NULL REFERENCES api_customers(id) ON DELETE CASCADE,
  token_hash  TEXT         NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash   ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_customer_id  ON password_reset_tokens (customer_id);
