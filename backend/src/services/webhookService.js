'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const logger = require('../config/logger').forJob('webhookService');

const WEBHOOK_TIMEOUT_MS = 10_000;  // 10 s — generous for slow endpoints
const MAX_RETRIES        = 3;
const RETRY_DELAYS_MS    = [1_000, 3_000, 9_000]; // exponential-ish back-off

/**
 * Sign a webhook payload with HMAC-SHA256 using the alert's webhook_secret.
 * Matches the Stripe / GitHub convention: `sha256=<hex>`.
 * If no secret is configured the header is omitted so callers can still
 * verify the raw payload themselves.
 *
 * @param {string} secret   — raw secret string stored in price_alerts.webhook_secret
 * @param {string} body     — JSON-serialised payload string
 * @returns {string|null}
 */
function sign(secret, body) {
  if (!secret) return null;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Build the standard GridIndex webhook payload envelope.
 * @param {object} opts
 */
function buildPayload({ alertId, alertName, alertType, region, currentPrice, threshold, pctChange, carbonIntensity, renewablePct, triggeredAt }) {
  return {
    event:        'alert.triggered',
    alert_id:     alertId,
    alert_name:   alertName || null,
    alert_type:   alertType,
    region,
    triggered_at: triggeredAt || new Date().toISOString(),
    data: {
      current_price_mwh:  currentPrice    ?? null,
      threshold_mwh:      threshold       ?? null,
      pct_change:         pctChange       ?? null,
      carbon_g_kwh:       carbonIntensity ?? null,
      renewable_pct:      renewablePct    ?? null
    },
    source: 'gridindex-api/v1'
  };
}

/**
 * Deliver a webhook with retries.
 * Returns an object describing the final delivery outcome.
 *
 * @param {object} opts
 * @param {string}      opts.webhookUrl
 * @param {string|null} opts.webhookSecret
 * @param {object}      opts.payload       — already-constructed payload object
 * @returns {{ delivered: boolean, statusCode: number|null, error: string|null, attempts: number }}
 */
async function deliver({ webhookUrl, webhookSecret, payload }) {
  const body = JSON.stringify(payload);
  const sig  = sign(webhookSecret, body);

  const headers = {
    'Content-Type':       'application/json',
    'User-Agent':         'GridIndex-Webhook/1.0',
    'X-GridIndex-Event':  payload.event || 'alert.triggered'
  };
  if (sig) headers['X-GridIndex-Signature'] = sig;

  let lastError  = null;
  let lastStatus = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 9_000;
      logger.warn(`Webhook retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms`, { url: webhookUrl });
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await axios.post(webhookUrl, body, {
        headers,
        timeout: WEBHOOK_TIMEOUT_MS,
        // Don't throw on 4xx/5xx — we want to capture the status code
        validateStatus: () => true
      });

      lastStatus = response.status;

      if (response.status >= 200 && response.status < 300) {
        logger.info('Webhook delivered', { url: webhookUrl, status: response.status, attempt: attempt + 1 });
        return { delivered: true, statusCode: response.status, error: null, attempts: attempt + 1 };
      }

      lastError = `HTTP ${response.status}`;
      logger.warn('Webhook non-2xx response', { url: webhookUrl, status: response.status, attempt: attempt + 1 });

    } catch (err) {
      lastError  = err.message;
      lastStatus = null;
      logger.warn('Webhook request failed', { url: webhookUrl, error: err.message, attempt: attempt + 1 });
    }
  }

  logger.error('Webhook delivery failed after all retries', { url: webhookUrl, lastError, lastStatus });
  return { delivered: false, statusCode: lastStatus, error: lastError, attempts: MAX_RETRIES };
}

/**
 * High-level helper: build + deliver a webhook for a triggered alert.
 * Returns the delivery result so alertEngine can log it to alert_history.
 */
async function sendAlertWebhook(alertRow, triggerData) {
  const payload = buildPayload({
    alertId:        alertRow.id,
    alertName:      alertRow.alert_name,
    alertType:      alertRow.alert_type,
    region:         alertRow.region_code,
    currentPrice:   triggerData.currentPrice,
    threshold:      triggerData.threshold,
    pctChange:      triggerData.pctChange,
    carbonIntensity: triggerData.carbonIntensity,
    renewablePct:   triggerData.renewablePct,
    triggeredAt:    new Date().toISOString()
  });

  return deliver({
    webhookUrl:    alertRow.webhook_url,
    webhookSecret: alertRow.webhook_secret,
    payload
  });
}

module.exports = { sendAlertWebhook, deliver, buildPayload, sign };
