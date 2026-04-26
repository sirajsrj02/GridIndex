'use strict';

const crypto = require('crypto');
const { query } = require('../../config/database');

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
       calls_last_month = calls_this_month,
       calls_this_month = 0,
       calls_reset_at   = NOW()`
  );
}

module.exports = {
  createCustomer,
  getCustomerByEmail,
  getCustomerByApiKey,
  getCustomerById,
  incrementUsage,
  rotateApiKey,
  resetMonthlyUsage
};
