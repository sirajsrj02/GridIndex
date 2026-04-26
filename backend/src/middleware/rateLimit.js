'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Global IP-based rate limit — runs before auth to block brute-force attempts.
 * 300 requests per 15 minutes per IP across all routes.
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please slow down.', code: 'RATE_LIMITED' }
});

/**
 * Stricter limit on auth endpoints to block credential stuffing.
 * 20 requests per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many auth attempts, please try again later.', code: 'AUTH_RATE_LIMITED' }
});

module.exports = { globalLimiter, authLimiter };
