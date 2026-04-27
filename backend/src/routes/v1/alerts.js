'use strict';

const { Router } = require('express');
const Joi = require('joi');
const {
  createAlert, listAlerts, getAlert,
  updateAlert, deleteAlert, getAlertHistory
} = require('../../db/queries/alerts');

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const VALID_REGIONS  = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];
const VALID_TYPES    = ['price_above', 'price_below', 'pct_change', 'carbon_above', 'renewable_below'];
const VALID_DELIVERY = ['email', 'webhook'];

const createSchema = Joi.object({
  alert_name:                   Joi.string().max(100).optional(),
  region_code:                  Joi.string().valid(...VALID_REGIONS).required(),
  alert_type:                   Joi.string().valid(...VALID_TYPES).required(),

  // Threshold fields — at least one relevant one must be present (validated below)
  threshold_price_mwh:          Joi.number().optional(),
  threshold_pct_change:         Joi.number().min(0).max(1000).optional(),
  threshold_timewindow_minutes: Joi.number().integer().min(1).max(1440).default(5),
  threshold_carbon_g_kwh:       Joi.number().optional(),
  threshold_renewable_pct:      Joi.number().min(0).max(100).optional(),

  // Delivery
  delivery_method:              Joi.string().valid(...VALID_DELIVERY).required(),
  email_address:                Joi.string().email().optional(),
  webhook_url:                  Joi.string().uri().optional(),
  webhook_secret:               Joi.string().max(64).optional(),

  cooldown_minutes:             Joi.number().integer().min(1).max(10080).default(60) // max 1 week
}).options({ stripUnknown: true });

const updateSchema = Joi.object({
  alert_name:                   Joi.string().max(100).optional(),
  alert_type:                   Joi.string().valid(...VALID_TYPES).optional(),
  threshold_price_mwh:          Joi.number().optional(),
  threshold_pct_change:         Joi.number().min(0).max(1000).optional(),
  threshold_timewindow_minutes: Joi.number().integer().min(1).max(1440).optional(),
  threshold_carbon_g_kwh:       Joi.number().optional(),
  threshold_renewable_pct:      Joi.number().min(0).max(100).optional(),
  delivery_method:              Joi.string().valid(...VALID_DELIVERY).optional(),
  email_address:                Joi.string().email().optional(),
  webhook_url:                  Joi.string().uri().optional(),
  webhook_secret:               Joi.string().max(64).optional(),
  cooldown_minutes:             Joi.number().integer().min(1).max(10080).optional(),
  is_active:                    Joi.boolean().optional()
}).options({ stripUnknown: true });

// ── Route helpers ─────────────────────────────────────────────────────────────

/**
 * Validate that the delivery method has the required contact field.
 */
function validateDelivery(method, body, res) {
  if (method === 'email' && !body.email_address) {
    res.status(400).json({ success: false, error: 'email_address is required when delivery_method is email', code: 'MISSING_EMAIL' });
    return false;
  }
  if (method === 'webhook' && !body.webhook_url) {
    res.status(400).json({ success: false, error: 'webhook_url is required when delivery_method is webhook', code: 'MISSING_WEBHOOK_URL' });
    return false;
  }
  return true;
}

/**
 * Validate that a relevant threshold is provided for the chosen alert type.
 */
function validateThreshold(type, body, res) {
  const missing = {
    price_above:     !body.threshold_price_mwh,
    price_below:     !body.threshold_price_mwh,
    pct_change:      !body.threshold_pct_change,
    carbon_above:    !body.threshold_carbon_g_kwh,
    renewable_below: !body.threshold_renewable_pct
  }[type];

  if (missing) {
    const field = {
      price_above:     'threshold_price_mwh',
      price_below:     'threshold_price_mwh',
      pct_change:      'threshold_pct_change',
      carbon_above:    'threshold_carbon_g_kwh',
      renewable_below: 'threshold_renewable_pct'
    }[type];
    res.status(400).json({ success: false, error: `${field} is required for alert_type '${type}'`, code: 'MISSING_THRESHOLD' });
    return false;
  }
  return true;
}

// ── Webhook plan guard — only Pro/Enterprise may use webhooks ─────────────────
const WEBHOOK_PLANS = ['pro', 'enterprise'];

function requireWebhookPlan(req, res, next) {
  if (req.body?.delivery_method === 'webhook' && !WEBHOOK_PLANS.includes(req.customer?.plan_type)) {
    return res.status(403).json({
      success: false,
      error:   'Webhook delivery requires a Pro or Enterprise plan',
      code:    'PLAN_REQUIRED'
    });
  }
  next();
}

// ── Per-customer alert limit ──────────────────────────────────────────────────
const MAX_ALERTS = { starter: 5, pro: 50, enterprise: 500 };

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/alerts
 * List all alerts for the authenticated customer.
 */
router.get('/', async (req, res) => {
  try {
    const rows = await listAlerts(req.customer.id);
    res.locals.responseRows = rows.length;
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to list alerts', code: 'DB_ERROR' });
  }
});

/**
 * POST /api/v1/alerts
 * Create a new alert.
 */
router.post('/', requireWebhookPlan, async (req, res) => {
  const { error, value } = createSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, error: error.details[0].message, code: 'VALIDATION_ERROR' });
  }

  if (!validateThreshold(value.alert_type, value, res)) return;
  if (!validateDelivery(value.delivery_method, value, res)) return;

  // Enforce per-plan alert cap
  try {
    const existing = await listAlerts(req.customer.id);
    const cap = MAX_ALERTS[req.customer.plan_type] ?? MAX_ALERTS.starter;
    if (existing.length >= cap) {
      return res.status(429).json({
        success: false,
        error:   `Alert limit reached for your plan (${cap} max). Upgrade for more.`,
        code:    'ALERT_LIMIT_REACHED'
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to check alert count', code: 'DB_ERROR' });
  }

  try {
    const alert = await createAlert({
      customerId:                 req.customer.id,
      apiKey:                     req.customer.api_key,
      alertName:                  value.alert_name,
      regionCode:                 value.region_code,
      alertType:                  value.alert_type,
      thresholdPriceMwh:          value.threshold_price_mwh,
      thresholdPctChange:         value.threshold_pct_change,
      thresholdTimewindowMinutes: value.threshold_timewindow_minutes,
      thresholdCarbonGKwh:        value.threshold_carbon_g_kwh,
      thresholdRenewablePct:      value.threshold_renewable_pct,
      deliveryMethod:             value.delivery_method,
      emailAddress:               value.email_address,
      webhookUrl:                 value.webhook_url,
      webhookSecret:              value.webhook_secret,
      cooldownMinutes:            value.cooldown_minutes
    });
    res.locals.responseRows = 1;
    res.status(201).json({ success: true, data: alert });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to create alert', code: 'DB_ERROR' });
  }
});

/**
 * GET /api/v1/alerts/:id
 * Get a single alert.
 */
router.get('/:id', async (req, res) => {
  const alertId = parseInt(req.params.id);
  if (isNaN(alertId)) {
    return res.status(400).json({ success: false, error: 'Invalid alert ID', code: 'INVALID_ID' });
  }
  try {
    const alert = await getAlert(alertId, req.customer.id);
    if (!alert) return res.status(404).json({ success: false, error: 'Alert not found', code: 'NOT_FOUND' });
    res.locals.responseRows = 1;
    res.json({ success: true, data: alert });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch alert', code: 'DB_ERROR' });
  }
});

/**
 * PUT /api/v1/alerts/:id
 * Update an alert (partial update — only provided fields change).
 */
router.put('/:id', requireWebhookPlan, async (req, res) => {
  const alertId = parseInt(req.params.id);
  if (isNaN(alertId)) {
    return res.status(400).json({ success: false, error: 'Invalid alert ID', code: 'INVALID_ID' });
  }

  const { error, value } = updateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, error: error.details[0].message, code: 'VALIDATION_ERROR' });
  }

  try {
    // Map camelCase patch fields to snake_case for the query layer
    const patch = {};
    if (value.alert_name                   !== undefined) patch.alert_name                   = value.alert_name;
    if (value.alert_type                   !== undefined) patch.alert_type                   = value.alert_type;
    if (value.threshold_price_mwh          !== undefined) patch.threshold_price_mwh          = value.threshold_price_mwh;
    if (value.threshold_pct_change         !== undefined) patch.threshold_pct_change         = value.threshold_pct_change;
    if (value.threshold_timewindow_minutes !== undefined) patch.threshold_timewindow_minutes  = value.threshold_timewindow_minutes;
    if (value.threshold_carbon_g_kwh       !== undefined) patch.threshold_carbon_g_kwh       = value.threshold_carbon_g_kwh;
    if (value.threshold_renewable_pct      !== undefined) patch.threshold_renewable_pct      = value.threshold_renewable_pct;
    if (value.delivery_method              !== undefined) patch.delivery_method              = value.delivery_method;
    if (value.email_address                !== undefined) patch.email_address                = value.email_address;
    if (value.webhook_url                  !== undefined) patch.webhook_url                  = value.webhook_url;
    if (value.webhook_secret               !== undefined) patch.webhook_secret               = value.webhook_secret;
    if (value.cooldown_minutes             !== undefined) patch.cooldown_minutes             = value.cooldown_minutes;
    if (value.is_active                    !== undefined) patch.is_active                    = value.is_active;

    const updated = await updateAlert(alertId, req.customer.id, patch);
    if (!updated) return res.status(404).json({ success: false, error: 'Alert not found', code: 'NOT_FOUND' });
    res.locals.responseRows = 1;
    res.json({ success: true, data: updated });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to update alert', code: 'DB_ERROR' });
  }
});

/**
 * DELETE /api/v1/alerts/:id
 * Permanently remove an alert.
 */
router.delete('/:id', async (req, res) => {
  const alertId = parseInt(req.params.id);
  if (isNaN(alertId)) {
    return res.status(400).json({ success: false, error: 'Invalid alert ID', code: 'INVALID_ID' });
  }
  try {
    const deleted = await deleteAlert(alertId, req.customer.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Alert not found', code: 'NOT_FOUND' });
    res.json({ success: true, message: 'Alert deleted' });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to delete alert', code: 'DB_ERROR' });
  }
});

/**
 * GET /api/v1/alerts/:id/history
 * Get trigger history for an alert.
 */
router.get('/:id/history', async (req, res) => {
  const alertId = parseInt(req.params.id);
  if (isNaN(alertId)) {
    return res.status(400).json({ success: false, error: 'Invalid alert ID', code: 'INVALID_ID' });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const rows = await getAlertHistory(alertId, req.customer.id, limit);
    if (!rows.length) {
      // Could be no history yet OR alert doesn't belong to customer — check ownership
      const alert = await getAlert(alertId, req.customer.id);
      if (!alert) return res.status(404).json({ success: false, error: 'Alert not found', code: 'NOT_FOUND' });
    }
    res.locals.responseRows = rows.length;
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch alert history', code: 'DB_ERROR' });
  }
});

module.exports = router;
