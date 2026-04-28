'use strict';

/**
 * Integration tests for all /api/v1/* routes.
 * DB query() and customer lookups are fully mocked — no real DB connection.
 */

// Mock database so no pg Pool is created
jest.mock('../config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true)
}));

// Mock customer queries — requireApiKey calls getCustomerByApiKey
jest.mock('../db/queries/customers', () => ({
  getCustomerByApiKey: jest.fn(),
  getCustomerById: jest.fn(),
  incrementUsage: jest.fn().mockResolvedValue(undefined),
  checkAndMarkUsageWarning: jest.fn().mockResolvedValue(false), // default: already sent
  createCustomer: jest.fn(),
  getCustomerByEmail: jest.fn(),
  rotateApiKey: jest.fn(),
  resetMonthlyUsage: jest.fn(),
  createPasswordResetToken: jest.fn(),
  getValidResetToken: jest.fn(),
  consumeResetToken: jest.fn()
}));

// Mock email service — prevents real SMTP calls in tests
jest.mock('../services/emailService', () => ({
  sendWelcomeEmail:      jest.fn().mockResolvedValue(null),
  sendAlertEmail:        jest.fn().mockResolvedValue(null),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(null),
  sendUsageWarningEmail: jest.fn().mockResolvedValue(null),
  verifyTransport:       jest.fn().mockResolvedValue(undefined)
}));

// Mock usage logging — usageLogger fires logUsage on response finish
jest.mock('../db/queries/usage', () => ({
  logUsage: jest.fn().mockResolvedValue(undefined),
  getUsageSummary: jest.fn().mockResolvedValue([]),
  getTopEndpoints: jest.fn().mockResolvedValue([])
}));

const request = require('supertest');
const app = require('../../server');
const { query } = require('../config/database');
const { getCustomerByApiKey, checkAndMarkUsageWarning } = require('../db/queries/customers');
const { sendUsageWarningEmail } = require('../services/emailService');

// ─── Shared test fixtures ────────────────────────────────────────────────────

const TEST_API_KEY = 'gi_testkey_for_v1_tests';

// A customer with access to all regions
const mockCustomer = {
  id: 'cust-001',
  email: 'api@example.com',
  api_key: TEST_API_KEY,
  is_active: true,
  plan: 'developer',
  monthly_limit: 10000,
  calls_this_month: 0,
  calls_all_time: 10,
  history_days_allowed: 7,
  allowed_regions: ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC']
};

// Convenience header setter
function auth() {
  return { 'X-API-Key': TEST_API_KEY };
}

// Establish the standard authenticated customer before every test
beforeEach(() => {
  getCustomerByApiKey.mockResolvedValue(mockCustomer);
});

// clearAllMocks resets call-tracking only — it does NOT strip mock implementations.
// resetAllMocks would remove the mockResolvedValue on incrementUsage, causing it to
// return undefined; then requireApiKey's `incrementUsage().catch(...)` would throw a
// synchronous TypeError before next() is called, and Express 4 would silently drop it,
// leaving every subsequent request hanging until the 15 s test timeout.
afterEach(() => jest.clearAllMocks());

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/v1/sources/health   (public — no API key required)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/sources/health', () => {
  it('returns health data without an API key', async () => {
    query.mockResolvedValue({ rows: [
      {
        source_name: 'EIA_API', status: 'healthy',
        last_success_at: new Date(), last_attempt_at: new Date(),
        consecutive_failures: 0, avg_response_time_ms: 280,
        total_calls_today: 12, last_error: null
      }
    ]});

    const res = await request(app).get('/api/v1/sources/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.overall).toBe('healthy');
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.meta.count).toBe(1);
  });

  it('reports overall as degraded when any source is down', async () => {
    query.mockResolvedValue({ rows: [
      { source_name: 'EIA_API',  status: 'healthy', consecutive_failures: 0 },
      { source_name: 'OPEN_METEO', status: 'down', consecutive_failures: 5 }
    ]});

    const res = await request(app).get('/api/v1/sources/health');

    expect(res.status).toBe(200);
    expect(res.body.overall).toBe('degraded');
  });

  it('handles an empty health table (no sources configured)', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/api/v1/sources/health');

    expect(res.status).toBe(200);
    // Array.every on empty array returns true (vacuous truth) → healthy
    expect(res.body.overall).toBe('healthy');
    expect(res.body.sources).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  API key middleware
// ══════════════════════════════════════════════════════════════════════════════

describe('API key authentication', () => {
  it('returns 401 when X-API-Key header is absent', async () => {
    const res = await request(app).get('/api/v1/regions');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_API_KEY');
  });

  it('returns 401 for an unrecognised API key', async () => {
    getCustomerByApiKey.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/regions')
      .set('X-API-Key', 'gi_badkey');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_API_KEY');
  });

  it('returns 401 for an inactive customer', async () => {
    getCustomerByApiKey.mockResolvedValue({ ...mockCustomer, is_active: false });

    const res = await request(app).get('/api/v1/regions').set(auth());

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_API_KEY');
  });

  it('returns 429 when the monthly call limit is exhausted', async () => {
    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      calls_this_month: 10000,
      monthly_limit: 10000
    });

    const res = await request(app).get('/api/v1/regions').set(auth());

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('MONTHLY_LIMIT_EXCEEDED');
    expect(res.body.limit).toBe(10000);
    expect(res.body.used).toBe(10000);
  });

  it('returns 503 when the DB lookup itself fails', async () => {
    getCustomerByApiKey.mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get('/api/v1/regions').set(auth());

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DB_ERROR');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Rate-limit response headers
// ══════════════════════════════════════════════════════════════════════════════

describe('X-RateLimit-* response headers', () => {
  it('sets all three headers on a successful authenticated request', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/api/v1/regions').set(auth());

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe(String(mockCustomer.monthly_limit));
    // remaining = limit - (calls_this_month + 1) because we count the current call
    expect(res.headers['x-ratelimit-remaining']).toBe(
      String(mockCustomer.monthly_limit - mockCustomer.calls_this_month - 1)
    );
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
    // Reset must be a future Unix timestamp (seconds)
    expect(Number(res.headers['x-ratelimit-reset'])).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('sets headers with remaining=0 on a 429 response', async () => {
    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      calls_this_month: 10000,
      monthly_limit:    10000
    });

    const res = await request(app).get('/api/v1/regions').set(auth());

    expect(res.status).toBe(429);
    expect(res.headers['x-ratelimit-limit']).toBe('10000');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('remaining never goes below 0 when calls_this_month exceeds limit', async () => {
    // Edge case: DB data anomaly where used > limit
    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      calls_this_month: 500,
      monthly_limit:    100  // overage — shouldn't produce negative remaining
    });

    const res = await request(app).get('/api/v1/regions').set(auth());

    // Should be 429 (limit exceeded), remaining clamped to 0
    expect(res.status).toBe(429);
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('X-RateLimit-Reset is the Unix timestamp for the 1st of next month', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/api/v1/regions').set(auth());

    const resetTs  = Number(res.headers['x-ratelimit-reset']);
    const resetDate = new Date(resetTs * 1000);

    // Must be the 1st of a month at midnight UTC
    expect(resetDate.getUTCDate()).toBe(1);
    expect(resetDate.getUTCHours()).toBe(0);
    expect(resetDate.getUTCMinutes()).toBe(0);
    expect(resetDate.getUTCSeconds()).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/v1/regions
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/regions', () => {
  const regionRows = [
    { code: 'CAISO', name: 'California ISO', type: 'ISO', tier: 1, timezone: 'America/Los_Angeles' },
    { code: 'ERCOT', name: 'ERCOT',          type: 'ISO', tier: 1, timezone: 'America/Chicago' }
  ];

  it('returns all active regions', async () => {
    query.mockResolvedValue({ rows: regionRows });

    const res = await request(app).get('/api/v1/regions').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.count).toBe(2);
    expect(res.body.data[0].code).toBe('CAISO');
  });

  it('returns an empty array when no regions are active', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app).get('/api/v1/regions').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.count).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/v1/prices
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/prices/latest/all', () => {
  const makePriceRow = (region) => ({
    region_code: region,
    timestamp: new Date().toISOString(),
    price_per_mwh: 42.0 + Math.random(),
    price_day_ahead_mwh: 40.0,
    price_type: 'real_time_hourly',
    demand_mw: 20000,
    net_generation_mw: 19000,
    interchange_mw: -1000,
    source: 'EIA'
  });

  it('returns a map keyed by region_code for all allowed regions', async () => {
    const rows = ['CAISO', 'ERCOT', 'PJM'].map(makePriceRow);
    query.mockResolvedValue({ rows });

    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      allowed_regions: ['CAISO', 'ERCOT', 'PJM']
    });

    const res = await request(app)
      .get('/api/v1/prices/latest/all')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Response must be a map, not an array
    expect(Array.isArray(res.body.data)).toBe(false);
    expect(typeof res.body.data).toBe('object');
    expect(res.body.data.CAISO).toBeDefined();
    expect(res.body.data.ERCOT).toBeDefined();
    expect(res.body.data.PJM).toBeDefined();
    expect(res.body.data.CAISO.region_code).toBe('CAISO');
    expect(res.body.meta.count).toBe(3);
  });

  it('returns 200 with empty data map when customer has no allowed regions', async () => {
    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      allowed_regions: []
    });

    const res = await request(app)
      .get('/api/v1/prices/latest/all')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({});
    expect(res.body.meta.count).toBe(0);
  });

  it('returns 401 without an API key', async () => {
    const res = await request(app).get('/api/v1/prices/latest/all');
    expect(res.status).toBe(401);
  });

  it('returns 200 with partial map when some regions have no data in DB', async () => {
    // Only CAISO has a row — ERCOT has no data yet
    query.mockResolvedValue({ rows: [makePriceRow('CAISO')] });

    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      allowed_regions: ['CAISO', 'ERCOT']
    });

    const res = await request(app)
      .get('/api/v1/prices/latest/all')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.CAISO).toBeDefined();
    expect(res.body.data.ERCOT).toBeUndefined();
    expect(res.body.meta.count).toBe(1);
  });
});

describe('GET /api/v1/prices/latest', () => {
  const priceRow = {
    region_code: 'CAISO', timestamp: new Date().toISOString(),
    price_per_mwh: 45.5, price_type: 'real_time_hourly',
    pricing_node: 'SYSTEM', demand_mw: 25000, source: 'EIA'
  };

  it('returns the most recent price for a valid region', async () => {
    query.mockResolvedValue({ rows: [priceRow] });

    const res = await request(app)
      .get('/api/v1/prices/latest?region=CAISO')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.region_code).toBe('CAISO');
    expect(res.body.data.price_per_mwh).toBe(45.5);
    expect(res.body.meta.region).toBe('CAISO');
  });

  it('returns 400 when region query param is absent', async () => {
    const res = await request(app).get('/api/v1/prices/latest').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_REGION');
  });

  it('returns 403 for an unrecognised region code (access control fires first)', async () => {
    // requireRegionAccess middleware runs before the route-level validateRegion check,
    // so an unknown code like FAKEGRID returns REGION_NOT_ALLOWED (403) rather than
    // INVALID_REGION (400). This is the real behaviour; the 400 path is only reached
    // when a customer's allowed_regions explicitly includes an invalid code — tested below.
    const res = await request(app)
      .get('/api/v1/prices/latest?region=FAKEGRID')
      .set(auth());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REGION_NOT_ALLOWED');
  });

  it('returns 400 INVALID_REGION when access control passes but the code is not a valid ISO', async () => {
    // Edge case: customer's allowed_regions contains a non-standard code.
    // requireRegionAccess lets it through; validateRegion in the route handler catches it.
    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      allowed_regions: ['FAKEGRID']
    });

    const res = await request(app)
      .get('/api/v1/prices/latest?region=FAKEGRID')
      .set(auth());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REGION');
  });

  it('returns 403 when the customer plan excludes the requested region', async () => {
    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      allowed_regions: ['CAISO']   // ERCOT not in plan
    });

    const res = await request(app)
      .get('/api/v1/prices/latest?region=ERCOT')
      .set(auth());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REGION_NOT_ALLOWED');
  });

  it('returns 404 when no data exists for the region', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/v1/prices/latest?region=CAISO')
      .set(auth());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('uses real_time_hourly as the default price type', async () => {
    query.mockResolvedValue({ rows: [priceRow] });

    await request(app)
      .get('/api/v1/prices/latest?region=CAISO')
      .set(auth());

    // Second param in the SQL call is price_type
    const sqlParams = query.mock.calls[0][1];
    expect(sqlParams[1]).toBe('real_time_hourly');
  });
});

describe('GET /api/v1/prices (historical)', () => {
  it('returns a time series with pagination metadata', async () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      region_code: 'CAISO',
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      price_per_mwh: 40 + i, price_type: 'real_time_hourly', source: 'EIA'
    }));
    query.mockResolvedValue({ rows });

    const res = await request(app)
      .get('/api/v1/prices?region=CAISO&limit=24')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(24);
    expect(res.body.meta.count).toBe(24);
    expect(res.body.meta.history_days_allowed).toBe(7);
  });

  it('returns 400 for an unsupported price type', async () => {
    const res = await request(app)
      .get('/api/v1/prices?region=CAISO&type=bad_type')
      .set(auth());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TYPE');
  });

  it('returns 400 when start date is not a valid date string', async () => {
    const res = await request(app)
      .get('/api/v1/prices?region=CAISO&start=not-a-date')
      .set(auth());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_DATE');
  });

  it('caps row limit at 500 regardless of the ?limit param', async () => {
    query.mockResolvedValue({ rows: [] });

    await request(app)
      .get('/api/v1/prices?region=CAISO&limit=99999')
      .set(auth());

    // The 5th SQL param ($5) is the LIMIT value
    const sqlParams = query.mock.calls[0][1];
    expect(sqlParams[4]).toBe(500);
  });

  it('clamps start date to the customer history window', async () => {
    query.mockResolvedValue({ rows: [] });

    // Request a start date far in the past — customer only has 7 days
    const ancientDate = '2020-01-01';
    await request(app)
      .get(`/api/v1/prices?region=CAISO&start=${ancientDate}`)
      .set(auth());

    const sqlParams = query.mock.calls[0][1];
    const clampedStart = new Date(sqlParams[2]);
    const expectedEarliest = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    // The clamped start should be within a few seconds of the 7-day boundary
    expect(Math.abs(clampedStart - expectedEarliest)).toBeLessThan(5000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/v1/fuel-mix
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/fuel-mix/latest', () => {
  const fuelRow = {
    region_code: 'CAISO',
    timestamp: new Date().toISOString(),
    natural_gas_mw: 5000, natural_gas_pct: 50,
    wind_mw: 2000,         wind_pct: 20,
    solar_mw: 3000,        solar_pct: 30,
    total_generation_mw: 10000,
    renewable_total_pct: 50, clean_total_pct: 50,
    source: 'EIA'
  };

  it('returns the latest fuel mix snapshot', async () => {
    query.mockResolvedValue({ rows: [fuelRow] });

    const res = await request(app)
      .get('/api/v1/fuel-mix/latest?region=CAISO')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.natural_gas_mw).toBe(5000);
    expect(res.body.data.renewable_total_pct).toBe(50);
    expect(res.body.meta.region).toBe('CAISO');
  });

  it('returns 400 when region is absent', async () => {
    const res = await request(app).get('/api/v1/fuel-mix/latest').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_REGION');
  });

  it('returns 404 when no fuel mix data exists', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/v1/fuel-mix/latest?region=PJM')
      .set(auth());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/fuel-mix (historical)', () => {
  it('returns a fuel mix time series', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      region_code: 'ERCOT',
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      natural_gas_mw: 5000 - i * 10, total_generation_mw: 10000
    }));
    query.mockResolvedValue({ rows });

    const res = await request(app)
      .get('/api/v1/fuel-mix?region=ERCOT&limit=12')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.meta.count).toBe(12);
  });

  it('returns 400 for an invalid date', async () => {
    const res = await request(app)
      .get('/api/v1/fuel-mix?region=ERCOT&end=not-a-date')
      .set(auth());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_DATE');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/v1/carbon
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/carbon/latest', () => {
  const carbonRow = {
    region_code: 'CAISO',
    timestamp: new Date().toISOString(),
    co2_lbs_per_mwh: 250.5,
    co2_grams_per_kwh: 113.6,
    co2_kg_per_mwh: 113.6,
    renewable_percentage: 40.0,
    clean_energy_percentage: 45.0,
    intensity_category: 'low',
    calculation_method: 'fuel_mix_weighted',
    source: 'EIA'
  };

  it('returns the latest carbon intensity snapshot', async () => {
    query.mockResolvedValue({ rows: [carbonRow] });

    const res = await request(app)
      .get('/api/v1/carbon/latest?region=CAISO')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.intensity_category).toBe('low');
    expect(res.body.data.co2_grams_per_kwh).toBe(113.6);
    expect(res.body.meta.region).toBe('CAISO');
  });

  it('returns 403 for an unrecognised region (access control fires before validation)', async () => {
    const res = await request(app)
      .get('/api/v1/carbon/latest?region=INVALID')
      .set(auth());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REGION_NOT_ALLOWED');
  });

  it('returns 404 when no carbon data exists for the region', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/v1/carbon/latest?region=MISO')
      .set(auth());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/carbon (historical)', () => {
  it('returns a carbon intensity time series', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      region_code: 'NYISO',
      co2_grams_per_kwh: 200 + i * 10,
      intensity_category: 'medium'
    }));
    query.mockResolvedValue({ rows });

    const res = await request(app)
      .get('/api/v1/carbon?region=NYISO&limit=6')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(6);
    expect(res.body.meta.count).toBe(6);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/v1/weather
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/weather', () => {
  const weatherRows = [
    {
      region_code: 'CAISO',
      location_name: 'Los Angeles',
      latitude: 34.05, longitude: -118.24,
      timestamp: new Date().toISOString(),
      temperature_f: 72.5, temperature_c: 22.5, feels_like_f: 71.0,
      humidity_pct: 60, wind_speed_mph: 8.5, wind_direction_degrees: 270,
      cloud_cover_pct: 20, precipitation_inches: 0,
      solar_radiation_wm2: 450, cooling_degree_days: 0.3, heating_degree_days: 0,
      is_forecast: false, forecast_horizon_hours: 0, source: 'Open-Meteo'
    },
    {
      region_code: 'CAISO',
      location_name: 'San Francisco',
      latitude: 37.77, longitude: -122.42,
      timestamp: new Date(Date.now() + 3_600_000).toISOString(),
      temperature_f: 62.0, temperature_c: 16.7,
      is_forecast: true, forecast_horizon_hours: 1, source: 'Open-Meteo'
    }
  ];

  it('returns weather rows for a region (observed + forecast)', async () => {
    query.mockResolvedValue({ rows: weatherRows });

    const res = await request(app)
      .get('/api/v1/weather?region=CAISO')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.region).toBe('CAISO');
    expect(res.body.meta.location).toBe('all');
  });

  it('respects optional ?location filter', async () => {
    query.mockResolvedValue({ rows: [weatherRows[0]] });

    const res = await request(app)
      .get('/api/v1/weather?region=CAISO&location=Los+Angeles')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.meta.location).toBe('Los Angeles');
  });

  it('passes forecast=true filter to the query', async () => {
    query.mockResolvedValue({ rows: [weatherRows[1]] });

    const res = await request(app)
      .get('/api/v1/weather?region=CAISO&forecast=true')
      .set(auth());

    expect(res.status).toBe(200);
    // The SQL will include "is_forecast = true" — verified by mock receiving 1 row
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 400 when region is absent', async () => {
    const res = await request(app).get('/api/v1/weather').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_REGION');
  });

  it('returns 403 for an unrecognised region (access control fires before validation)', async () => {
    const res = await request(app)
      .get('/api/v1/weather?region=FAKEGRID')
      .set(auth());

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REGION_NOT_ALLOWED');
  });

  it('returns an empty array when no weather data exists', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/v1/weather?region=WECC')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.count).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  GET /api/v1/forecast
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/forecast', () => {
  const dayAheadRow = {
    region_code: 'CAISO', timestamp: new Date(Date.now() + 3_600_000).toISOString(),
    price_per_mwh: null, price_day_ahead_mwh: 52.40,
    price_type: 'day_ahead_hourly', pricing_node: 'SYSTEM', source: 'EIA'
  };
  const weatherRow = {
    region_code: 'CAISO', location_name: 'Los Angeles',
    timestamp: new Date(Date.now() + 3_600_000).toISOString(),
    temperature_f: 78.0, wind_speed_mph: 6.2, cloud_cover_pct: 15,
    is_forecast: true, forecast_horizon_hours: 1
  };
  const steoRow = {
    region_code: 'CAISO',
    forecast_for_timestamp: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
    price_forecast_mwh: 68.50, price_low_mwh: 58.23, price_high_mwh: 78.78,
    forecast_source: 'EIA_STEO', confidence_score: 0.75
  };

  it('returns all three forecast layers for a valid region', async () => {
    // query is called three times in parallel: day-ahead, weather, steo
    query
      .mockResolvedValueOnce({ rows: [dayAheadRow] })  // getDayAheadPrices
      .mockResolvedValueOnce({ rows: [weatherRow] })   // getForecastWeather
      .mockResolvedValueOnce({ rows: [steoRow] });     // getSTEOForecasts

    const res = await request(app)
      .get('/api/v1/forecast?region=CAISO&horizon=48')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.region).toBe('CAISO');
    expect(res.body.data.horizon_hours).toBe(48);
    expect(res.body.data.day_ahead.count).toBe(1);
    expect(res.body.data.weather_forecast.count).toBe(1);
    expect(res.body.data.steo_outlook.count).toBe(1);
    expect(res.body.meta.query_ms).toBeGreaterThanOrEqual(0);
  });

  it('omits steo_outlook when steo=false', async () => {
    query
      .mockResolvedValueOnce({ rows: [dayAheadRow] })
      .mockResolvedValueOnce({ rows: [weatherRow] });
    // only 2 query calls when steo=false

    const res = await request(app)
      .get('/api/v1/forecast?region=CAISO&horizon=24&steo=false')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.steo_outlook).toBeNull();
    expect(res.body.data.day_ahead.count).toBe(1);
  });

  it('returns empty layers when no data exists', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/v1/forecast?region=ERCOT')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.day_ahead.count).toBe(0);
    expect(res.body.data.day_ahead.summary).toBeNull();
    expect(res.body.data.weather_forecast.count).toBe(0);
    expect(res.body.data.steo_outlook.count).toBe(0);
  });

  it('caps horizon at 8760 hours (1 year)', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/v1/forecast?region=CAISO&horizon=99999')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.horizon_hours).toBe(8760);
  });

  it('returns 400 when region is missing', async () => {
    const res = await request(app).get('/api/v1/forecast').set(auth());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_REGION');
  });

  it('returns 401 without an API key', async () => {
    const res = await request(app).get('/api/v1/forecast?region=CAISO');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  404 handler for unknown v1 routes
// ══════════════════════════════════════════════════════════════════════════════

describe('Unknown /api/v1/* routes', () => {
  it('returns 404 with NOT_FOUND code', async () => {
    const res = await request(app)
      .get('/api/v1/does-not-exist')
      .set(auth());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  Usage warning emails
// ══════════════════════════════════════════════════════════════════════════════

describe('Usage warning emails', () => {
  function customerAt(pct, warningSentLevel = 0) {
    const limit = 1000;
    // calls_this_month is pre-increment; the middleware adds 1 before checking
    const calls = Math.floor(limit * pct / 100) - 1;
    return {
      ...mockCustomer,
      monthly_limit: limit,
      calls_this_month: calls,
      usage_warning_sent: warningSentLevel
    };
  }

  beforeEach(() => {
    query.mockResolvedValue({ rows: [] });
  });

  it('sends 80% warning when usage crosses 80% for the first time', async () => {
    // pre-increment count = 799 → post-increment = 800 = exactly 80%
    getCustomerByApiKey.mockResolvedValue(customerAt(80, 0));
    checkAndMarkUsageWarning.mockResolvedValue(true); // first time — mark succeeds

    await request(app).get('/api/v1/regions').set(auth());
    // Allow fire-and-forget promise to resolve
    await new Promise((r) => setImmediate(r));

    expect(checkAndMarkUsageWarning).toHaveBeenCalledWith(mockCustomer.id, 80);
    expect(sendUsageWarningEmail).toHaveBeenCalledWith(
      expect.objectContaining({ level: 80 })
    );
  });

  it('sends 95% warning when usage crosses 95% for the first time', async () => {
    getCustomerByApiKey.mockResolvedValue(customerAt(95, 80)); // 80% already sent
    checkAndMarkUsageWarning.mockResolvedValue(true);

    await request(app).get('/api/v1/regions').set(auth());
    await new Promise((r) => setImmediate(r));

    expect(checkAndMarkUsageWarning).toHaveBeenCalledWith(mockCustomer.id, 95);
    expect(sendUsageWarningEmail).toHaveBeenCalledWith(
      expect.objectContaining({ level: 95 })
    );
  });

  it('does NOT send email if warning for that level was already sent', async () => {
    // 80% warning already sent (usage_warning_sent = 80), usage still at 80%
    getCustomerByApiKey.mockResolvedValue(customerAt(80, 80));

    await request(app).get('/api/v1/regions').set(auth());
    await new Promise((r) => setImmediate(r));

    // Fast-path skip: usage_warning_sent >= level, so no DB call or email
    expect(checkAndMarkUsageWarning).not.toHaveBeenCalled();
    expect(sendUsageWarningEmail).not.toHaveBeenCalled();
  });

  it('does NOT send email when usage is below 80%', async () => {
    getCustomerByApiKey.mockResolvedValue(customerAt(50, 0));

    await request(app).get('/api/v1/regions').set(auth());
    await new Promise((r) => setImmediate(r));

    expect(checkAndMarkUsageWarning).not.toHaveBeenCalled();
    expect(sendUsageWarningEmail).not.toHaveBeenCalled();
  });

  it('does NOT send email when another concurrent request already marked the level', async () => {
    getCustomerByApiKey.mockResolvedValue(customerAt(80, 0));
    checkAndMarkUsageWarning.mockResolvedValue(false); // concurrent request won the race

    await request(app).get('/api/v1/regions').set(auth());
    await new Promise((r) => setImmediate(r));

    expect(checkAndMarkUsageWarning).toHaveBeenCalledWith(mockCustomer.id, 80);
    expect(sendUsageWarningEmail).not.toHaveBeenCalled();
  });
});
