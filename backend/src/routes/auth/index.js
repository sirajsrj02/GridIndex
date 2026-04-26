'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createCustomer, getCustomerByEmail, rotateApiKey } = require('../../db/queries/customers');
const { requireJwt } = require('../../middleware/auth');
const { authLimiter } = require('../../middleware/rateLimit');

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';

function issueToken(customerId) {
  return jwt.sign({ sub: customerId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function safeCustomer(c) {
  // Never return password_hash, reset tokens, or verify tokens to the client
  const { password_hash, email_verify_token, password_reset_token, password_reset_expires, ...safe } = c;
  return safe;
}

/**
 * POST /api/auth/register
 * Create a new account. Returns the customer profile + API key.
 */
router.post('/register', authLimiter, async (req, res) => {
  const { email, password, company_name, full_name, use_case, referral_source } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required', code: 'MISSING_FIELDS' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters', code: 'WEAK_PASSWORD' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email address', code: 'INVALID_EMAIL' });
  }

  try {
    const existing = await getCustomerByEmail(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists', code: 'EMAIL_TAKEN' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const customer = await createCustomer({
      email: email.toLowerCase(),
      passwordHash,
      companyName: company_name,
      fullName: full_name,
      useCase: use_case,
      referralSource: referral_source
    });

    const token = issueToken(customer.id);

    res.status(201).json({
      success: true,
      data: {
        customer: safeCustomer(customer),
        token,
        api_key: customer.api_key
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Registration failed', code: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate with email + password. Returns JWT and API key.
 */
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required', code: 'MISSING_FIELDS' });
  }

  try {
    const customer = await getCustomerByEmail(email.toLowerCase());
    if (!customer) {
      return res.status(401).json({ success: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    const valid = await bcrypt.compare(password, customer.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    if (!customer.is_active) {
      return res.status(403).json({ success: false, error: 'Account is inactive', code: 'ACCOUNT_INACTIVE' });
    }

    const token = issueToken(customer.id);

    res.json({
      success: true,
      data: {
        customer: safeCustomer(customer),
        token,
        api_key: customer.api_key
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Login failed', code: 'SERVER_ERROR' });
  }
});

/**
 * GET /api/auth/me
 * Return the authenticated customer's profile.
 */
router.get('/me', requireJwt, (req, res) => {
  res.json({ success: true, data: safeCustomer(req.customer) });
});

/**
 * POST /api/auth/rotate-key
 * Generate a new API key. Invalidates the old one immediately.
 */
router.post('/rotate-key', requireJwt, async (req, res) => {
  try {
    const newKey = await rotateApiKey(req.customer.id);
    if (!newKey) {
      return res.status(500).json({ success: false, error: 'Failed to rotate key', code: 'SERVER_ERROR' });
    }
    res.json({
      success: true,
      data: { api_key: newKey, message: 'API key rotated. Update your integrations — the old key is now invalid.' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to rotate key', code: 'SERVER_ERROR' });
  }
});

module.exports = router;
