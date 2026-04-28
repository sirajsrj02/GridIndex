'use strict';

/**
 * Phase 5 — Alert System Tests
 *
 * Covers:
 *   - GET  /api/v1/alerts          list
 *   - POST /api/v1/alerts          create (validation, plan guards, limit cap)
 *   - GET  /api/v1/alerts/:id      single fetch
 *   - PUT  /api/v1/alerts/:id      update
 *   - DELETE /api/v1/alerts/:id    delete
 *   - GET  /api/v1/alerts/:id/history
 *   - alertEngine.evaluate()       unit tests for each alert type
 *   - emailService.sendWelcomeEmail / sendAlertEmail (test transport stub)
 *   - webhookService.sign / buildPayload / deliver
 */

const request = require('supertest');
const app     = require('../../server');

// ── Module mocks ──────────────────────────────────────────────────────────────
jest.mock('../config/database');
jest.mock('../db/queries/customers', () => ({
  getCustomerByApiKey: jest.fn(),
  incrementUsage:      jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../db/queries/usage', () => ({
  logUsage: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../db/queries/alerts');

const { getCustomerByApiKey } = require('../db/queries/customers');
const {
  createAlert, listAlerts, getAlert,
  updateAlert, deleteAlert, getAlertHistory,
  getActiveAlertsForRegion, markAlertTriggered, recordAlertHistory
} = require('../db/queries/alerts');

// ── Shared fixtures ───────────────────────────────────────────────────────────
const TEST_API_KEY = 'gi_test_alerts_key';

const mockCustomer = {
  id:              1,
  email:           'alerts@test.com',
  full_name:       'Alert Tester',
  api_key:         TEST_API_KEY,
  plan:            'pro',
  is_active:       true,
  calls_this_month: 0,
  monthly_limit:   100_000,
  allowed_regions: ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC']
};

const mockAlert = {
  id:                           1,
  customer_id:                  1,
  api_key:                      TEST_API_KEY,
  alert_name:                   'CAISO High Price',
  region_code:                  'CAISO',
  alert_type:                   'price_above',
  threshold_price_mwh:          '150.00',
  threshold_pct_change:         null,
  threshold_timewindow_minutes: 5,
  threshold_carbon_g_kwh:       null,
  threshold_renewable_pct:      null,
  delivery_method:              'email',
  email_address:                'alerts@test.com',
  webhook_url:                  null,
  webhook_secret:               null,
  cooldown_minutes:             60,
  is_active:                    true,
  trigger_count:                0,
  last_triggered_at:            null,
  created_at:                   new Date().toISOString()
};

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeEach(() => {
  getCustomerByApiKey.mockResolvedValue(mockCustomer);

  // Default alert mock responses
  listAlerts.mockResolvedValue([mockAlert]);
  createAlert.mockResolvedValue(mockAlert);
  getAlert.mockResolvedValue(mockAlert);
  updateAlert.mockResolvedValue({ ...mockAlert, alert_name: 'Updated Name' });
  deleteAlert.mockResolvedValue(true);
  getAlertHistory.mockResolvedValue([]);
});

afterEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/alerts', () => {
  it('returns list of alerts for authenticated customer', async () => {
    const res = await request(app)
      .get('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].alert_type).toBe('price_above');
  });

  it('returns empty array when customer has no alerts', async () => {
    listAlerts.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.data).toEqual([]);
  });

  it('requires API key', async () => {
    const res = await request(app).get('/api/v1/alerts');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/alerts', () => {
  const validBody = {
    region_code:         'CAISO',
    alert_type:          'price_above',
    threshold_price_mwh: 150,
    delivery_method:     'email',
    email_address:       'alerts@test.com'
  };

  it('creates a price_above alert', async () => {
    listAlerts.mockResolvedValue([]); // under cap
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.alert_type).toBe('price_above');
    expect(createAlert).toHaveBeenCalledTimes(1);
  });

  it('creates a pct_change alert', async () => {
    listAlerts.mockResolvedValue([]);
    const pctAlert = {
      ...mockAlert,
      alert_type:           'pct_change',
      threshold_pct_change: '20.00',
      threshold_price_mwh:  null
    };
    createAlert.mockResolvedValue(pctAlert);

    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({
        region_code:          'ERCOT',
        alert_type:           'pct_change',
        threshold_pct_change: 20,
        delivery_method:      'email',
        email_address:        'alerts@test.com'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.alert_type).toBe('pct_change');
  });

  it('creates a webhook alert for pro customer', async () => {
    listAlerts.mockResolvedValue([]);
    const webhookAlert = { ...mockAlert, delivery_method: 'webhook', webhook_url: 'https://example.com/hook' };
    createAlert.mockResolvedValue(webhookAlert);

    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({
        region_code:         'PJM',
        alert_type:          'price_above',
        threshold_price_mwh: 200,
        delivery_method:     'webhook',
        webhook_url:         'https://example.com/hook'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.delivery_method).toBe('webhook');
  });

  it('blocks webhook alerts for starter plan', async () => {
    getCustomerByApiKey.mockResolvedValue({ ...mockCustomer, plan: 'starter' });
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({
        region_code:         'CAISO',
        alert_type:          'price_above',
        threshold_price_mwh: 100,
        delivery_method:     'webhook',
        webhook_url:         'https://example.com/hook'
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_REQUIRED');
  });

  it('rejects missing region_code', async () => {
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({ ...validBody, region_code: undefined });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid region_code', async () => {
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({ ...validBody, region_code: 'FAKEGRID' });

    expect(res.status).toBe(400);
  });

  it('rejects missing threshold for price_above', async () => {
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({ region_code: 'CAISO', alert_type: 'price_above', delivery_method: 'email', email_address: 'a@b.com' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_THRESHOLD');
  });

  it('rejects email delivery without email_address', async () => {
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({ region_code: 'CAISO', alert_type: 'price_above', threshold_price_mwh: 100, delivery_method: 'email' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_EMAIL');
  });

  it('rejects webhook delivery without webhook_url', async () => {
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({ region_code: 'CAISO', alert_type: 'price_above', threshold_price_mwh: 100, delivery_method: 'webhook' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_WEBHOOK_URL');
  });

  it('enforces alert cap for starter plan', async () => {
    getCustomerByApiKey.mockResolvedValue({ ...mockCustomer, plan: 'starter' });
    // Return 5 existing alerts (starter cap)
    listAlerts.mockResolvedValue(Array(5).fill(mockAlert));

    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send(validBody);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('ALERT_LIMIT_REACHED');
  });

  it('blocks creating alert for region not in customer plan', async () => {
    // Customer only has CAISO + ERCOT
    getCustomerByApiKey.mockResolvedValue({
      ...mockCustomer,
      allowed_regions: ['CAISO', 'ERCOT']
    });
    const res = await request(app)
      .post('/api/v1/alerts')
      .set('X-API-Key', TEST_API_KEY)
      .send({ ...validBody, region_code: 'PJM' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REGION_NOT_ALLOWED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/alerts/:id', () => {
  it('returns a single alert', async () => {
    const res = await request(app)
      .get('/api/v1/alerts/1')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('returns 404 for non-existent alert', async () => {
    getAlert.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/v1/alerts/999')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 400 for non-numeric alert ID', async () => {
    const res = await request(app)
      .get('/api/v1/alerts/abc')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/v1/alerts/:id', () => {
  it('updates an alert', async () => {
    const res = await request(app)
      .put('/api/v1/alerts/1')
      .set('X-API-Key', TEST_API_KEY)
      .send({ alert_name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.alert_name).toBe('Updated Name');
    expect(updateAlert).toHaveBeenCalledTimes(1);
  });

  it('can pause an alert with is_active: false', async () => {
    updateAlert.mockResolvedValue({ ...mockAlert, is_active: false });
    const res = await request(app)
      .put('/api/v1/alerts/1')
      .set('X-API-Key', TEST_API_KEY)
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  it('returns 404 when alert not owned by customer', async () => {
    updateAlert.mockResolvedValue(null);
    const res = await request(app)
      .put('/api/v1/alerts/999')
      .set('X-API-Key', TEST_API_KEY)
      .send({ alert_name: 'Hack' });

    expect(res.status).toBe(404);
  });

  it('rejects invalid email in update', async () => {
    const res = await request(app)
      .put('/api/v1/alerts/1')
      .set('X-API-Key', TEST_API_KEY)
      .send({ email_address: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects changing alert_type without providing the new required threshold', async () => {
    // Changing from price_above to carbon_above without threshold_carbon_g_kwh
    const res = await request(app)
      .put('/api/v1/alerts/1')
      .set('X-API-Key', TEST_API_KEY)
      .send({ alert_type: 'carbon_above' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_THRESHOLD');
  });

  it('allows changing alert_type when new threshold is also provided', async () => {
    updateAlert.mockResolvedValue({
      ...mockAlert,
      alert_type:             'carbon_above',
      threshold_carbon_g_kwh: '400.00'
    });
    const res = await request(app)
      .put('/api/v1/alerts/1')
      .set('X-API-Key', TEST_API_KEY)
      .send({ alert_type: 'carbon_above', threshold_carbon_g_kwh: 400 });

    expect(res.status).toBe(200);
    expect(res.body.data.alert_type).toBe('carbon_above');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/v1/alerts/:id', () => {
  it('deletes an alert', async () => {
    const res = await request(app)
      .delete('/api/v1/alerts/1')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deleteAlert).toHaveBeenCalledWith(1, 1);
  });

  it('returns 404 when alert not found', async () => {
    deleteAlert.mockResolvedValue(false);
    const res = await request(app)
      .delete('/api/v1/alerts/999')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/alerts/:id/history', () => {
  it('returns trigger history', async () => {
    const historyRow = {
      id: 1, alert_id: 1, region_code: 'CAISO',
      triggered_at: new Date().toISOString(),
      alert_type: 'price_above', price_at_trigger: '155.00',
      delivered: true, delivery_method: 'email'
    };
    getAlertHistory.mockResolvedValue([historyRow]);

    const res = await request(app)
      .get('/api/v1/alerts/1/history')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].alert_type).toBe('price_above');
  });

  it('returns empty history when no triggers yet', async () => {
    getAlertHistory.mockResolvedValue([]);
    // getAlert is called to verify ownership when history is empty
    getAlert.mockResolvedValue(mockAlert);

    const res = await request(app)
      .get('/api/v1/alerts/1/history')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it('returns 404 for history of non-existent alert', async () => {
    getAlertHistory.mockResolvedValue([]);
    getAlert.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/alerts/999/history')
      .set('X-API-Key', TEST_API_KEY);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alert Engine — unit tests (evaluate function)
// ─────────────────────────────────────────────────────────────────────────────
describe('alertEngine.evaluate()', () => {
  const { evaluate } = require('../jobs/alertEngine');

  const priceRow  = { price_per_mwh: '160.00' };
  const carbonRow = { carbon_intensity_g_kwh: '350.00', renewable_pct: '25.00' };

  it('triggers price_above when price exceeds threshold', async () => {
    const alert = { alert_type: 'price_above', threshold_price_mwh: '150.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(true);
  });

  it('does not trigger price_above when price is below threshold', async () => {
    const alert = { alert_type: 'price_above', threshold_price_mwh: '200.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(false);
  });

  it('triggers price_below when price falls below threshold', async () => {
    const alert = { alert_type: 'price_below', threshold_price_mwh: '200.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(true);
  });

  it('does not trigger price_below when price is above threshold', async () => {
    const alert = { alert_type: 'price_below', threshold_price_mwh: '100.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(false);
  });

  it('triggers pct_change when change exceeds threshold', async () => {
    const alert = { alert_type: 'pct_change', threshold_pct_change: '10.00', threshold_timewindow_minutes: 5 };
    const prevRow = { price_per_mwh: '100.00' }; // 60% change
    const { triggered, triggerData } = await evaluate(alert, priceRow, carbonRow, prevRow);
    expect(triggered).toBe(true);
    expect(triggerData.pctChange).toBeCloseTo(60, 0);
  });

  it('does not trigger pct_change for small moves', async () => {
    const alert = { alert_type: 'pct_change', threshold_pct_change: '50.00', threshold_timewindow_minutes: 5 };
    const prevRow = { price_per_mwh: '155.00' }; // ~3.2% change
    const { triggered } = await evaluate(alert, priceRow, carbonRow, prevRow);
    expect(triggered).toBe(false);
  });

  it('does not trigger pct_change when prev price is 0 (division guard)', async () => {
    const alert = { alert_type: 'pct_change', threshold_pct_change: '10.00', threshold_timewindow_minutes: 5 };
    const prevRow = { price_per_mwh: '0' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, prevRow);
    expect(triggered).toBe(false);
  });

  it('triggers carbon_above when intensity exceeds threshold', async () => {
    const alert = { alert_type: 'carbon_above', threshold_carbon_g_kwh: '300.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(true);
  });

  it('does not trigger carbon_above when intensity is under threshold', async () => {
    const alert = { alert_type: 'carbon_above', threshold_carbon_g_kwh: '400.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(false);
  });

  it('triggers renewable_below when renewable % drops below threshold', async () => {
    const alert = { alert_type: 'renewable_below', threshold_renewable_pct: '30.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(true);
  });

  it('does not trigger renewable_below when renewable % is above threshold', async () => {
    const alert = { alert_type: 'renewable_below', threshold_renewable_pct: '20.00' };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(false);
  });

  it('does not trigger when price data is missing', async () => {
    const alert = { alert_type: 'price_above', threshold_price_mwh: '100.00' };
    const { triggered } = await evaluate(alert, null, carbonRow, null);
    expect(triggered).toBe(false);
  });

  it('does not trigger for unknown alert type', async () => {
    const alert = { alert_type: 'unknown_type', id: 99 };
    const { triggered } = await evaluate(alert, priceRow, carbonRow, null);
    expect(triggered).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Email Service — verify test stub doesn't throw
// ─────────────────────────────────────────────────────────────────────────────
describe('emailService', () => {
  const { sendWelcomeEmail, sendAlertEmail } = require('../services/emailService');

  it('sendWelcomeEmail resolves without throwing', async () => {
    await expect(sendWelcomeEmail({
      email:    'new@test.com',
      fullName: 'Test User',
      apiKey:   'gi_test123',
      plan:     'starter'
    })).resolves.not.toThrow();
  });

  it('sendAlertEmail resolves without throwing', async () => {
    await expect(sendAlertEmail({
      email:        'alerts@test.com',
      alertName:    'Test Alert',
      region:       'CAISO',
      alertType:    'price_above',
      currentPrice: 155,
      threshold:    150,
      pctChange:    null,
      triggeredAt:  new Date().toISOString()
    })).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Service — unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe('webhookService', () => {
  const { sign, buildPayload, deliver } = require('../services/webhookService');

  it('sign() returns sha256=<hex> string', () => {
    const sig = sign('mysecret', '{"test":true}');
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('sign() returns null when no secret provided', () => {
    expect(sign(null, '{}')).toBeNull();
    expect(sign('',   '{}')).toBeNull();
  });

  it('sign() is deterministic — same inputs produce same signature', () => {
    const body   = JSON.stringify({ event: 'test' });
    const secret = 'consistent-secret';
    expect(sign(secret, body)).toBe(sign(secret, body));
  });

  it('buildPayload() returns correct envelope shape', () => {
    const payload = buildPayload({
      alertId:      42,
      alertName:    'High Price',
      alertType:    'price_above',
      region:       'CAISO',
      currentPrice: 155,
      threshold:    150,
      pctChange:    null,
      triggeredAt:  '2026-01-01T00:00:00.000Z'
    });
    expect(payload.event).toBe('alert.triggered');
    expect(payload.alert_id).toBe(42);
    expect(payload.region).toBe('CAISO');
    expect(payload.data.current_price_mwh).toBe(155);
    expect(payload.data.threshold_mwh).toBe(150);
    expect(payload.source).toBe('gridindex-api/v1');
  });

  it('deliver() returns not-delivered when URL is unreachable', async () => {
    const result = await deliver({
      webhookUrl:    'http://localhost:1',   // nothing listening on port 1
      webhookSecret: null,
      payload:       buildPayload({ alertId: 1, alertType: 'price_above', region: 'CAISO' })
    });
    // Should exhaust retries and return delivered:false
    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(3);
    // error may be empty string on some systems — just check it's not delivered
    expect(typeof result.error).toBe('string');
  }, 30_000); // retries take ~13 s total
});
