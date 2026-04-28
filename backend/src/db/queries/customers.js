'use strict';

const crypto = require('crypto');
const { query, transaction } = require('../../config/database');

function generateApiKey() {
  return 'gi_' + crypto.randomBytes(24).toString('hex');
}

async function createCustomer({ email, passwordHash, companyName, fullName, useCase, referralSource }) {
  const apiKey = generateApiKey();
  const { rows } = await query(
    `INSERT INTO api_customers
       (email, password_hash, company_name, full_name, use_case, referral_source, api_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [email, passwordHash, companyName || null, fullName || null, useCase || null, referralSource || null, apiKey]
  );
  return rows[0];
}

async function getCustomerByEmail(email) {
  const { rows } = await query(
    `SELECT * FROM api_customers WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

async function getCustomerByApiKey(apiKey) {
  const { rows } = await query(
    `SELECT * FROM api_customers WHERE api_key = $1`,
    [apiKey]
  );
  return rows[0] || null;
}

async function getCustomerById(id) {
  const { rows } = await query(
    `SELECT * FROM api_customers WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function incrementUsage(customerId) {
  return query(
    `UPDATE api_customers SET
       calls_this_month = calls_this_month + 1,
       calls_all_time   = calls_all_time + 1,
       last_seen_at     = NOW()
     WHERE id = $1`,
    [customerId]
  );
}

async function rotateApiKey(customerId) {
  const newKey = generateApiKey();
  const { rows } = await query(
    `UPDATE api_customers
     SET api_key = $1, api_key_created_at = NOW()
     WHERE id = $2
     RETURNING api_key`,
    [newKey, customerId]
  );
  return rows[0]?.api_key || null;
}

async function resetMonthlyUsage() {
  return query(
    `UPDATE api_customers SET
       calls_last_month     = calls_this_month,
       calls_this_month     = 0,
       calls_reset_at       = NOW(),
       usage_warning_sent   = 0`
  );
}

/**
 * Atomically mark a usage warning level as sent for a customer.
 * Uses a conditional UPDATE so only the first call that crosses each threshold
 * succeeds — subsequent calls (e.g. from concurrent requests) return false.
 *
 * @param {number} customerId
 * @param {number} level — 80 or 95
 * @returns {Promise<boolean>} true if this call was the one that set the flag
 */
async function checkAndMarkUsageWarning(customerId, level) {
  const { rowCount } = await query(
    `UPDATE api_customers
     SET usage_warning_sent = $1
     WHERE id = $2 AND usage_warning_sent < $1`,
    [level, customerId]
  );
  return rowCount > 0;
}

/**
 * Store an email verification token hash on the customer record.
 * The raw token is emailed; only the SHA-256 hash is written to the DB.
 * Expires in 24 hours. Calling again (resend) overwrites any existing token.
 *
 * @param {string} customerId
 * @param {string} tokenHash — SHA-256 hex digest of the raw token
 */
async function createEmailVerifyToken(customerId, tokenHash) {
  await query(
    `UPDATE api_customers
     SET email_verify_token      = $1,
         email_verify_expires_at = NOW() + INTERVAL '24 hours'
     WHERE id = $2`,
    [tokenHash, customerId]
  );
}

/**
 * Look up a customer by a valid (unexpired, unverified) email verify token hash.
 * Returns the customer row or null.
 *
 * @param {string} tokenHash
 * @returns {Promise<object|null>}
 */
async function getCustomerByVerifyToken(tokenHash) {
  const { rows } = await query(
    `SELECT * FROM api_customers
     WHERE email_verify_token      = $1
       AND email_verify_expires_at > NOW()
       AND is_email_verified        = false`,
    [tokenHash]
  );
  return rows[0] || null;
}

/**
 * Mark a customer's email as verified and clear the token fields.
 * Idempotent — safe to call even if already verified.
 *
 * @param {string} customerId
 */
async function markEmailVerified(customerId) {
  await query(
    `UPDATE api_customers
     SET is_email_verified        = true,
         email_verify_token      = NULL,
         email_verify_expires_at = NULL
     WHERE id = $1`,
    [customerId]
  );
}

/**
 * Update editable profile fields for a customer.
 * Allowed fields: full_name, company_name, notification_prefs.
 * Always returns the updated row.
 *
 * @param {number} customerId
 * @param {{ full_name?: string, company_name?: string, notification_prefs?: object }} patch
 * @returns {Promise<object>}
 */
async function updateProfile(customerId, patch) {
  const ALLOWED = ['full_name', 'company_name', 'notification_prefs'];
  const sets    = [];
  const vals    = [];
  let   idx     = 1;

  for (const field of ALLOWED) {
    if (patch[field] === undefined) continue;
    // notification_prefs is JSONB — merge into existing rather than overwrite
    if (field === 'notification_prefs') {
      sets.push(`notification_prefs = notification_prefs || $${idx++}::jsonb`);
      vals.push(JSON.stringify(patch[field]));
    } else {
      sets.push(`${field} = $${idx++}`);
      vals.push(patch[field]);
    }
  }

  if (!sets.length) return getCustomerById(customerId);

  vals.push(customerId);
  const { rows } = await query(
    `UPDATE api_customers
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    vals
  );
  return rows[0] || null;
}

/**
 * Store a password reset token hash for a customer.
 * Expires in 1 hour. Any previous unused tokens for the same customer
 * are deleted so only one valid link exists at a time.
 */
async function createPasswordResetToken(customerId, tokenHash) {
  // Invalidate any existing tokens for this customer first
  await query(
    `DELETE FROM password_reset_tokens WHERE customer_id = $1`,
    [customerId]
  );
  const { rows } = await query(
    `INSERT INTO password_reset_tokens (customer_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')
     RETURNING *`,
    [customerId, tokenHash]
  );
  return rows[0];
}

/**
 * Look up a valid (unexpired, unused) reset token by its hash.
 * Returns the row (including customer_id) or null.
 */
async function getValidResetToken(tokenHash) {
  const { rows } = await query(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash = $1
       AND expires_at > NOW()
       AND used_at IS NULL`,
    [tokenHash]
  );
  return rows[0] || null;
}

/**
 * Mark a reset token as used and update the customer's password hash.
 * Both writes are wrapped in a single transaction — if either fails, both roll back.
 * This prevents the token being burned without the password actually changing.
 */
async function consumeResetToken(tokenId, customerId, newPasswordHash) {
  await transaction(async (client) => {
    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenId]
    );
    await client.query(
      `UPDATE api_customers SET password_hash = $1 WHERE id = $2`,
      [newPasswordHash, customerId]
    );
  });
}

module.exports = {
  createCustomer,
  getCustomerByEmail,
  getCustomerByApiKey,
  getCustomerById,
  incrementUsage,
  rotateApiKey,
  resetMonthlyUsage,
  checkAndMarkUsageWarning,
  updateProfile,
  createEmailVerifyToken,
  getCustomerByVerifyToken,
  markEmailVerified,
  createPasswordResetToken,
  getValidResetToken,
  consumeResetToken
};
