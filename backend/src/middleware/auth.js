'use strict';

const jwt = require('jsonwebtoken');
const { getCustomerByApiKey, getCustomerById, incrementUsage, checkAndMarkUsageWarning } = require('../db/queries/customers');
const { sendUsageWarningEmail } = require('../services/emailService');
const logger = require('../config/logger').forJob('auth');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Returns the Unix epoch (seconds) for midnight on the 1st of next month UTC.
 * Used as the X-RateLimit-Reset value so clients know exactly when to retry.
 */
function getRateLimitReset() {
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.floor(reset.getTime() / 1000);
}

/**
 * Set the three standard rate-limit headers on a response.
 * Called both when a request is allowed (remaining > 0) and when it is blocked (429).
 */
function setRateLimitHeaders(res, limit, used) {
  const remaining = Math.max(0, limit - used);
  res.set('X-RateLimit-Limit',     String(limit));
  res.set('X-RateLimit-Remaining', String(remaining));
  res.set('X-RateLimit-Reset',     String(getRateLimitReset()));
}

/**
 * Fire-and-forget helper: if this API call pushed the customer over the 80% or
 * 95% threshold for the first time this month, send a warning email.
 * Uses an atomic DB update to guarantee exactly-once delivery per level.
 *
 * @param {object} customer — the customer row (pre-increment values)
 */
async function maybeFireUsageWarning(customer) {
  const newCount = customer.calls_this_month + 1;
  const limit    = customer.monthly_limit;
  if (!limit || limit <= 0) return;

  const pct = (newCount / limit) * 100;
  // Determine which level to check (highest applicable first)
  const level = pct >= 95 ? 95 : pct >= 80 ? 80 : null;
  if (!level) return;
  // Skip if the DB already recorded this level as sent (fast path — no DB write)
  if ((customer.usage_warning_sent || 0) >= level) return;

  try {
    const marked = await checkAndMarkUsageWarning(customer.id, level);
    if (!marked) return; // Another concurrent request already sent it
    await sendUsageWarningEmail({
      email:    customer.email,
      fullName: customer.full_name,
      plan:     customer.plan,
      used:     newCount,
      limit,
      level
    });
  } catch (err) {
    logger.error('Usage warning email failed', { customerId: customer.id, level, error: err.message });
  }
}

/**
 * API key authentication — used on all /api/v1/* routes.
 * Reads X-API-Key header, validates customer, checks limits and region access.
 * Attaches req.customer for downstream handlers.
 */
async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'API key required. Pass it as X-API-Key header.', code: 'MISSING_API_KEY' });
  }

  let customer;
  try {
    customer = await getCustomerByApiKey(apiKey);
  } catch (err) {
    return res.status(503).json({ success: false, error: 'Service unavailable', code: 'DB_ERROR' });
  }

  if (!customer || !customer.is_active) {
    return res.status(401).json({ success: false, error: 'Invalid or inactive API key', code: 'INVALID_API_KEY' });
  }

  if (customer.calls_this_month >= customer.monthly_limit) {
    setRateLimitHeaders(res, customer.monthly_limit, customer.calls_this_month);
    return res.status(429).json({
      success: false,
      error: `Monthly limit of ${customer.monthly_limit} calls reached. Resets on the 1st.`,
      code: 'MONTHLY_LIMIT_EXCEEDED',
      limit: customer.monthly_limit,
      used: customer.calls_this_month
    });
  }

  // Attach to request for downstream use
  req.customer = customer;
  req.apiKey = apiKey;

  // Set rate-limit headers on every successful request
  // used + 1 because incrementUsage fires after this middleware
  setRateLimitHeaders(res, customer.monthly_limit, customer.calls_this_month + 1);

  // Increment usage counter (non-blocking — don't fail the request if this errors)
  incrementUsage(customer.id).catch(() => {});

  // Send 80%/95% warning email exactly once per threshold per month (non-blocking)
  maybeFireUsageWarning(customer).catch(() => {});

  next();
}

/**
 * Region access control — call after requireApiKey.
 * Checks that the requested region is included in the customer's plan.
 */
function requireRegionAccess(req, res, next) {
  const region = req.query.region || req.params.region;
  if (!region) return next(); // route handler will validate region is present

  const allowed = req.customer.allowed_regions || [];
  if (!allowed.includes(region)) {
    return res.status(403).json({
      success: false,
      error: `Your plan does not include access to ${region}. Allowed: ${allowed.join(', ')}`,
      code: 'REGION_NOT_ALLOWED'
    });
  }
  next();
}

/**
 * JWT authentication — used on /api/auth/me and /api/dashboard/* routes.
 * Verifies the Bearer token and attaches req.customer.
 */
async function requireJwt(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Bearer token required', code: 'MISSING_TOKEN' });
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }

  let customer;
  try {
    customer = await getCustomerById(payload.sub);
  } catch (err) {
    return res.status(503).json({ success: false, error: 'Service unavailable', code: 'DB_ERROR' });
  }

  if (!customer || !customer.is_active) {
    return res.status(401).json({ success: false, error: 'Account not found or inactive', code: 'ACCOUNT_INACTIVE' });
  }

  req.customer = customer;
  next();
}

module.exports = { requireApiKey, requireRegionAccess, requireJwt };
