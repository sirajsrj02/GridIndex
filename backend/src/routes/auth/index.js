'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {
  createCustomer,
  getCustomerByEmail,
  getCustomerById,
  rotateApiKey,
  updateProfile,
  createEmailVerifyToken,
  getCustomerByVerifyToken,
  markEmailVerified,
  createPasswordResetToken,
  getValidResetToken,
  consumeResetToken
} = require('../../db/queries/customers');
const { requireJwt } = require('../../middleware/auth');
const { authLimiter } = require('../../middleware/rateLimit');
const { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } = require('../../services/emailService');
const logger = require('../../config/logger').forJob('auth');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://app.gridindex.io';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '7d';

function issueToken(customerId) {
  return jwt.sign({ sub: customerId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function safeCustomer(c) {
  // Never return password_hash, reset tokens, or verify tokens/expiries to the client
  const {
    password_hash,
    email_verify_token,
    email_verify_expires_at,
    password_reset_token,
    password_reset_expires,
    ...safe
  } = c;
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

    // Generate an email verification token (raw sent by email, hash stored in DB)
    const rawVerifyToken  = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = crypto.createHash('sha256').update(rawVerifyToken).digest('hex');
    const verifyUrl       = `${APP_BASE_URL}/verify-email?token=${rawVerifyToken}`;

    // Fire-and-forget — never block the registration response on email or DB writes
    Promise.all([
      createEmailVerifyToken(customer.id, verifyTokenHash),
      sendWelcomeEmail({
        email:     customer.email,
        fullName:  customer.full_name,
        apiKey:    customer.api_key,
        plan:      customer.plan,
        verifyUrl
      })
    ]).catch((err) => {
      logger.error('Post-registration tasks failed', { customerId: customer.id, error: err.message });
    });

    res.status(201).json({
      success: true,
      data: {
        customer: safeCustomer(customer),
        token,
        api_key: customer.api_key
      }
    });
  } catch (err) {
    // PostgreSQL unique violation — race condition between check and insert
    if (err.code === '23505') {
      return res.status(409).json({ success: false, error: 'An account with this email already exists', code: 'EMAIL_TAKEN' });
    }
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
 * PATCH /api/auth/profile
 * Update editable profile fields: full_name, company_name, notification_prefs.
 * Authenticated via JWT. Returns the updated (safe) customer object.
 */
router.patch('/profile', requireJwt, async (req, res) => {
  const ALLOWED_NOTIF_KEYS = ['usage_warnings', 'alert_emails', 'product_emails'];
  const patch = {};

  if (req.body.full_name    !== undefined) patch.full_name    = String(req.body.full_name   ).trim().slice(0, 100) || null;
  if (req.body.company_name !== undefined) patch.company_name = String(req.body.company_name).trim().slice(0, 100) || null;

  if (req.body.notification_prefs !== undefined) {
    if (typeof req.body.notification_prefs !== 'object' || Array.isArray(req.body.notification_prefs)) {
      return res.status(400).json({ success: false, error: 'notification_prefs must be an object', code: 'VALIDATION_ERROR' });
    }
    const prefs = {};
    for (const key of ALLOWED_NOTIF_KEYS) {
      if (req.body.notification_prefs[key] !== undefined) {
        prefs[key] = Boolean(req.body.notification_prefs[key]);
      }
    }
    if (Object.keys(prefs).length) patch.notification_prefs = prefs;
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update', code: 'NO_FIELDS' });
  }

  try {
    const updated = await updateProfile(req.customer.id, patch);
    if (!updated) return res.status(404).json({ success: false, error: 'Customer not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: safeCustomer(updated) });
  } catch (err) {
    logger.error('Failed to update profile', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to update profile', code: 'SERVER_ERROR' });
  }
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

/**
 * POST /api/auth/forgot-password
 * Send a password reset email if the address is registered.
 * Always returns 200 to prevent email enumeration.
 */
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, error: 'email is required', code: 'MISSING_FIELDS' });
  }

  // Always respond 200 regardless of whether email matched
  res.json({ success: true, data: { message: 'If that email is registered, a reset link has been sent.' } });

  // Fire-and-forget after response is sent — never block or leak timing
  try {
    const customer = await getCustomerByEmail(email.toLowerCase());
    if (!customer) return; // unknown email — response already sent, just stop here

    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await createPasswordResetToken(customer.id, tokenHash);

    const resetUrl = `${APP_BASE_URL}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail({
      email:    customer.email,
      fullName: customer.full_name,
      resetUrl
    });
  } catch (err) {
    // Log but swallow — response already sent, can't change status code now
    logger.error('Failed to generate password reset token', { error: err.message });
  }
});

/**
 * POST /api/auth/reset-password
 * Validate the reset token and update the customer's password.
 */
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, new_password } = req.body;

  if (!token || !new_password) {
    return res.status(400).json({ success: false, error: 'token and new_password are required', code: 'MISSING_FIELDS' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters', code: 'WEAK_PASSWORD' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record    = await getValidResetToken(tokenHash);

    if (!record) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset link.', code: 'INVALID_RESET_TOKEN' });
    }

    const newPasswordHash = await bcrypt.hash(new_password, 12);
    await consumeResetToken(record.id, record.customer_id, newPasswordHash);

    res.json({ success: true, data: { message: 'Password updated successfully.' } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Password reset failed', code: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/verify-email
 * Validate a verification token and mark the customer's email as verified.
 * Public route (no JWT required) — the token itself proves identity.
 */
router.post('/verify-email', authLimiter, async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: 'token is required', code: 'MISSING_FIELDS' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const customer  = await getCustomerByVerifyToken(tokenHash);

    if (!customer) {
      return res.status(400).json({
        success: false,
        error:   'Invalid or expired verification link.',
        code:    'INVALID_VERIFY_TOKEN'
      });
    }

    await markEmailVerified(customer.id);

    res.json({ success: true, data: { message: 'Email verified successfully. You can now use all features.' } });
  } catch (err) {
    logger.error('Email verification failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Verification failed', code: 'SERVER_ERROR' });
  }
});

/**
 * POST /api/auth/resend-verification
 * Generate a new verification token and re-send the verification email.
 * Requires JWT — only authenticated users can request a resend.
 * Rate-limited to prevent abuse.
 */
router.post('/resend-verification', requireJwt, authLimiter, async (req, res) => {
  const customer = req.customer;

  if (customer.is_email_verified) {
    return res.status(400).json({
      success: false,
      error:   'Email is already verified.',
      code:    'ALREADY_VERIFIED'
    });
  }

  try {
    // Always respond 200 immediately — fire-and-forget the email
    res.json({ success: true, data: { message: 'Verification email sent. Check your inbox.' } });

    const rawVerifyToken  = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = crypto.createHash('sha256').update(rawVerifyToken).digest('hex');
    const verifyUrl       = `${APP_BASE_URL}/verify-email?token=${rawVerifyToken}`;

    await createEmailVerifyToken(customer.id, verifyTokenHash);
    await sendVerificationEmail({
      email:     customer.email,
      fullName:  customer.full_name,
      verifyUrl
    });
  } catch (err) {
    // Response already sent — log and swallow
    logger.error('Failed to resend verification email', { customerId: customer.id, error: err.message });
  }
});

module.exports = router;
