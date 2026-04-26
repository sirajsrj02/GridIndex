'use strict';

const jwt = require('jsonwebtoken');
const { getCustomerByApiKey, getCustomerById, incrementUsage } = require('../db/queries/customers');

const JWT_SECRET = process.env.JWT_SECRET;

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

  // Increment usage counter (non-blocking — don't fail the request if this errors)
  incrementUsage(customer.id).catch(() => {});

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
