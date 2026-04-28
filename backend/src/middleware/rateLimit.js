'use strict';

const rateLimit = require('express-rate-limit');

// In the test environment, replace all limiters with a passthrough middleware
// so rate-limit state never bleeds between test cases or suites.
const isTest = process.env.NODE_ENV === 'test';
const passthrough = (_req, _res, next) => next();

// ── Per-plan burst limits (requests per minute) ───────────────────────────────
// Applied on all authenticated /api/v1/* routes, after requireApiKey resolves
// req.customer.  These are in addition to the monthly call quota.
const BURST_LIMITS = {
  starter:    20,
  trial:      20,
  developer:  60,
  pro:        60,
  enterprise: 200,
};

// In-memory sliding window — keyed by customer ID.
// Each entry is an array of Unix ms timestamps for requests in the last 60 s.
const burstWindows = new Map();
const BURST_WINDOW_MS = 60 * 1000;

// Periodically sweep stale entries so memory doesn't grow unboundedly.
// Only runs in non-test environments (where the process stays alive).
if (!isTest) {
  setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of burstWindows) {
      const fresh = ts.filter((t) => now - t < BURST_WINDOW_MS);
      if (fresh.length === 0) burstWindows.delete(id);
      else burstWindows.set(id, fresh);
    }
  }, 10 * 60 * 1000).unref(); // .unref() so this timer doesn't keep the process alive
}

/**
 * Global IP-based rate limit — runs before auth to block brute-force attempts.
 * 300 requests per 15 minutes per IP across all routes.
 */
const globalLimiter = isTest
  ? passthrough
  : rateLimit({
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
const authLimiter = isTest
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: 'Too many auth attempts, please try again later.', code: 'AUTH_RATE_LIMITED' }
    });

/**
 * Per-plan per-minute burst limiter.
 * Must be applied AFTER requireApiKey so req.customer is populated.
 *
 * Plan limits (requests / minute):
 *   starter / trial:     20
 *   developer / pro:     60
 *   enterprise:         200
 *
 * Responds with 429 + Retry-After: 60 header when the window is full.
 * Adds X-RateLimit-Burst-Limit and X-RateLimit-Burst-Remaining to every response.
 */
function apiRateLimiter(req, res, next) {
  if (isTest) return next();

  const customer = req.customer;
  const limit    = BURST_LIMITS[customer?.plan] ?? BURST_LIMITS.starter;
  const now      = Date.now();
  const key      = String(customer.id);

  // Slide the window: keep only timestamps within the last 60 s
  const prev  = burstWindows.get(key) || [];
  const fresh = prev.filter((t) => now - t < BURST_WINDOW_MS);

  if (fresh.length >= limit) {
    res.set('X-RateLimit-Burst-Limit',     String(limit));
    res.set('X-RateLimit-Burst-Remaining', '0');
    res.set('Retry-After',                 '60');
    return res.status(429).json({
      success:     false,
      error:       `Rate limit exceeded — your plan allows ${limit} requests per minute. Retry in 60 seconds.`,
      code:        'BURST_RATE_LIMITED',
      burst_limit: limit,
    });
  }

  fresh.push(now);
  burstWindows.set(key, fresh);

  res.set('X-RateLimit-Burst-Limit',     String(limit));
  res.set('X-RateLimit-Burst-Remaining', String(Math.max(0, limit - fresh.length)));
  next();
}

module.exports = { globalLimiter, authLimiter, apiRateLimiter };
