'use strict';

/**
 * Integration tests for auth and dashboard routes.
 * All DB access is mocked — no real database connection.
 */

// Mock the database module so no pg Pool is created
jest.mock('../config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true)
}));

// Mock all customer queries — auth routes use these directly
jest.mock('../db/queries/customers');

// Mock email service so no real SMTP calls are made in tests
jest.mock('../services/emailService', () => ({
  sendWelcomeEmail:       jest.fn().mockResolvedValue(null),
  sendVerificationEmail:  jest.fn().mockResolvedValue(null),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(null),
  sendAlertEmail:         jest.fn().mockResolvedValue(null),
  verifyTransport:        jest.fn().mockResolvedValue(true),
}));

// Mock usage logging — usageLogger calls this on response finish
jest.mock('../db/queries/usage', () => ({
  logUsage: jest.fn().mockResolvedValue(undefined),
  getUsageSummary: jest.fn(),
  getTopEndpoints: jest.fn()
}));

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const app = require('../../server');

const {
  createCustomer,
  getCustomerByEmail,
  getCustomerById,
  rotateApiKey,
  createEmailVerifyToken,
  getCustomerByVerifyToken,
  markEmailVerified,
  createPasswordResetToken,
  getValidResetToken,
  consumeResetToken
} = require('../db/queries/customers');

const { sendPasswordResetEmail, sendVerificationEmail } = require('../services/emailService');

const { getUsageSummary, getTopEndpoints } = require('../db/queries/usage');

// Pre-compute a bcrypt hash with cost factor 1 (fast for tests).
// The auth route uses bcrypt.compare which respects the rounds embedded in the hash,
// so compare() will be equally fast regardless of what factor the route uses to hash.
const TEST_PASSWORD = 'Password123!';
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 1);

// A fully-populated customer object that mirrors what the DB returns
const mockCustomer = {
  id: 'customer-uuid-001',
  email: 'test@example.com',
  password_hash: TEST_PASSWORD_HASH,
  company_name: 'Test Corp',
  full_name: 'Test User',
  use_case: 'testing',
  referral_source: null,
  api_key: 'gi_testkey',
  api_key_created_at: new Date(),
  is_active: true,
  plan: 'developer',
  monthly_limit: 10000,
  calls_this_month: 42,
  calls_last_month: 100,
  calls_all_time: 142,
  history_days_allowed: 7,
  allowed_regions: ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'],
  last_seen_at: new Date(),
  created_at: new Date(),
  is_email_verified: false,
  // Sensitive tokens — must never appear in API responses
  email_verify_token:      'secret-verify-token',
  email_verify_expires_at: new Date(Date.now() + 86400000), // 24 h from now
  password_reset_token:    'secret-reset-token',
  password_reset_expires:  new Date()
};

function makeJwt(id = mockCustomer.id) {
  return jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// clearAllMocks clears call-tracking only; implementations from the mock factories persist.
// resetAllMocks would also strip them, causing logUsage().catch() to throw on undefined.
afterEach(() => jest.clearAllMocks());

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/register
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/register', () => {
  it('creates an account and returns token + api_key', async () => {
    getCustomerByEmail.mockResolvedValue(null);   // email not taken
    createCustomer.mockResolvedValue(mockCustomer);
    createEmailVerifyToken.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: TEST_PASSWORD, company_name: 'New Co' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.api_key).toBe(mockCustomer.api_key);
    expect(res.body.data.customer.email).toBe(mockCustomer.email);
  });

  it('strips all sensitive fields from the customer response', async () => {
    getCustomerByEmail.mockResolvedValue(null);
    createCustomer.mockResolvedValue(mockCustomer);
    createEmailVerifyToken.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: TEST_PASSWORD });

    const c = res.body.data.customer;
    expect(c.password_hash).toBeUndefined();
    expect(c.email_verify_token).toBeUndefined();
    expect(c.email_verify_expires_at).toBeUndefined();
    expect(c.password_reset_token).toBeUndefined();
    expect(c.password_reset_expires).toBeUndefined();
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'x@y.com' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'x@y.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  it('returns 400 for an invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_EMAIL');
  });

  it('returns 409 when the email is already registered', async () => {
    getCustomerByEmail.mockResolvedValue(mockCustomer);   // email already exists

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('returns 409 (not 500) on PostgreSQL unique-violation race condition', async () => {
    getCustomerByEmail.mockResolvedValue(null);    // passed the check...
    const pgErr = new Error('duplicate key value');
    pgErr.code = '23505';                          // ...but INSERT raced
    createCustomer.mockRejectedValue(pgErr);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'race@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/login
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/login', () => {
  it('authenticates and returns a JWT + api_key', async () => {
    getCustomerByEmail.mockResolvedValue(mockCustomer);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.api_key).toBe(mockCustomer.api_key);
  });

  it('strips sensitive fields from the login response', async () => {
    getCustomerByEmail.mockResolvedValue(mockCustomer);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: TEST_PASSWORD });

    const c = res.body.data.customer;
    expect(c.password_hash).toBeUndefined();
    expect(c.email_verify_token).toBeUndefined();
    expect(c.password_reset_token).toBeUndefined();
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'x@y.com' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  it('returns 401 for an unknown email address', async () => {
    getCustomerByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 for a correct email but wrong password', async () => {
    getCustomerByEmail.mockResolvedValue(mockCustomer);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 403 for an inactive account', async () => {
    getCustomerByEmail.mockResolvedValue({ ...mockCustomer, is_active: false });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/auth/me
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/auth/me', () => {
  it('returns the authenticated customer profile', async () => {
    getCustomerById.mockResolvedValue(mockCustomer);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(mockCustomer.email);
    expect(res.body.data.id).toBe(mockCustomer.id);
  });

  it('returns 401 when Authorization header is absent', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 for a malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.jwt');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a JWT signed with the wrong secret', async () => {
    const badToken = jwt.sign({ sub: 'someone' }, 'wrong-secret', { expiresIn: '1h' });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 when the customer no longer exists in the DB', async () => {
    getCustomerById.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/rotate-key
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/rotate-key', () => {
  it('returns a new API key for an authenticated customer', async () => {
    getCustomerById.mockResolvedValue(mockCustomer);
    rotateApiKey.mockResolvedValue('gi_newkeyaabbccddeeff001122334455');

    const res = await request(app)
      .post('/api/auth/rotate-key')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.api_key).toBe('gi_newkeyaabbccddeeff001122334455');
    expect(res.body.data.message).toMatch(/old key is now invalid/);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/auth/rotate-key');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/dashboard/usage
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/usage', () => {
  it('returns usage summary for the authenticated customer', async () => {
    getCustomerById.mockResolvedValue(mockCustomer);

    const dailyRows = [
      { day: '2025-04-25', calls: '10', avg_ms: 120, errors: '0' },
      { day: '2025-04-24', calls: '32', avg_ms: 95,  errors: '1' }
    ];
    getUsageSummary.mockResolvedValue(dailyRows);
    getTopEndpoints.mockResolvedValue([
      { endpoint: '/api/v1/prices/latest', method: 'GET', calls: '28' }
    ]);

    const res = await request(app)
      .get('/api/dashboard/usage?days=30')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.calls_this_month).toBe(mockCustomer.calls_this_month);
    expect(res.body.data.summary.monthly_limit).toBe(mockCustomer.monthly_limit);
    expect(res.body.data.summary.calls_remaining).toBe(
      mockCustomer.monthly_limit - mockCustomer.calls_this_month
    );
    expect(res.body.data.daily).toHaveLength(2);
    expect(res.body.data.top_endpoints).toHaveLength(1);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/dashboard/usage');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/dashboard/profile
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/profile', () => {
  it('returns the customer profile with plan details', async () => {
    getCustomerById.mockResolvedValue(mockCustomer);

    const res = await request(app)
      .get('/api/dashboard/profile')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(mockCustomer.email);
    expect(res.body.data.plan).toBe(mockCustomer.plan);
    expect(res.body.data.api_key).toBe(mockCustomer.api_key);
    expect(res.body.data.monthly_limit).toBe(mockCustomer.monthly_limit);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/dashboard/profile');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/forgot-password
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/forgot-password', () => {
  it('returns 200 for a known email and queues a reset email', async () => {
    getCustomerByEmail.mockResolvedValue(mockCustomer);
    createPasswordResetToken.mockResolvedValue({ id: 1 });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(/reset link/i);
  });

  it('returns 200 for an unknown email — no enumeration', async () => {
    getCustomerByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    // Must still be 200 — never reveal whether the email exists
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 when email field is missing', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/reset-password
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/reset-password', () => {
  it('updates the password with a valid token', async () => {
    getValidResetToken.mockResolvedValue({ id: 99, customer_id: mockCustomer.id });
    consumeResetToken.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'validrawtoken', new_password: 'NewPassword1!' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(/updated/i);
    expect(consumeResetToken).toHaveBeenCalledWith(99, mockCustomer.id, expect.any(String));
  });

  it('returns 400 for an invalid or expired token', async () => {
    getValidResetToken.mockResolvedValue(null); // no matching valid token

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'expiredtoken', new_password: 'NewPassword1!' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('returns 400 when new_password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'sometoken', new_password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WEAK_PASSWORD');
  });

  it('returns 400 when token is missing', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ new_password: 'NewPassword1!' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });

  it('returns 400 when new_password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'sometoken' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/verify-email
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/verify-email', () => {
  it('marks email as verified with a valid token', async () => {
    getCustomerByVerifyToken.mockResolvedValue(mockCustomer);
    markEmailVerified.mockResolvedValue();

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'validrawtoken' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(/verified/i);
    expect(markEmailVerified).toHaveBeenCalledWith(mockCustomer.id);
  });

  it('returns 400 for an invalid or expired token', async () => {
    getCustomerByVerifyToken.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'expiredtoken' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_VERIFY_TOKEN');
    expect(markEmailVerified).not.toHaveBeenCalled();
  });

  it('returns 400 when token field is missing', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELDS');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  POST /api/auth/resend-verification
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/resend-verification', () => {
  it('sends a new verification email for an unverified account', async () => {
    getCustomerById.mockResolvedValue({ ...mockCustomer, is_email_verified: false });
    createEmailVerifyToken.mockResolvedValue();
    sendVerificationEmail.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toMatch(/sent/i);

    // Let the fire-and-forget tasks complete
    await new Promise((r) => setImmediate(r));

    expect(createEmailVerifyToken).toHaveBeenCalledWith(mockCustomer.id, expect.any(String));
    expect(sendVerificationEmail).toHaveBeenCalledWith(expect.objectContaining({
      email:     mockCustomer.email,
      verifyUrl: expect.stringContaining('/verify-email?token=')
    }));
  });

  it('returns 400 when email is already verified', async () => {
    getCustomerById.mockResolvedValue({ ...mockCustomer, is_email_verified: true });

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${makeJwt()}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ALREADY_VERIFIED');
  });

  it('returns 401 without a JWT', async () => {
    const res = await request(app).post('/api/auth/resend-verification');
    expect(res.status).toBe(401);
  });
});
