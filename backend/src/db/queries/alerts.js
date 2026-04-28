'use strict';

const { query } = require('../../config/database');

// ── CRUD ───────────────────────────────────────────────────────────────────────

/**
 * Create a new price alert for a customer.
 */
async function createAlert({
  customerId, apiKey, alertName, regionCode, alertType,
  thresholdPriceMwh, thresholdPctChange, thresholdTimewindowMinutes,
  thresholdCarbonGKwh, thresholdRenewablePct,
  deliveryMethod, emailAddress, webhookUrl, webhookSecret,
  cooldownMinutes
}) {
  const { rows } = await query(
    `INSERT INTO price_alerts
       (customer_id, api_key, alert_name, region_code, alert_type,
        threshold_price_mwh, threshold_pct_change, threshold_timewindow_minutes,
        threshold_carbon_g_kwh, threshold_renewable_pct,
        delivery_method, email_address, webhook_url, webhook_secret,
        cooldown_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      customerId, apiKey, alertName || null, regionCode, alertType,
      thresholdPriceMwh ?? null, thresholdPctChange ?? null, thresholdTimewindowMinutes ?? 5,
      thresholdCarbonGKwh ?? null, thresholdRenewablePct ?? null,
      deliveryMethod, emailAddress || null, webhookUrl || null, webhookSecret || null,
      cooldownMinutes ?? 60
    ]
  );
  return rows[0];
}

/**
 * List all alerts for a customer (active + inactive).
 */
async function listAlerts(customerId) {
  const { rows } = await query(
    `SELECT * FROM price_alerts
     WHERE customer_id = $1
     ORDER BY created_at DESC`,
    [customerId]
  );
  return rows;
}

/**
 * Get a single alert by ID — also verifies ownership.
 */
async function getAlert(alertId, customerId) {
  const { rows } = await query(
    `SELECT * FROM price_alerts
     WHERE id = $1 AND customer_id = $2`,
    [alertId, customerId]
  );
  return rows[0] || null;
}

/**
 * Update fields on an alert (partial update — only provided keys are changed).
 * Returns the updated row or null if not found / not owned.
 */
async function updateAlert(alertId, customerId, patch) {
  const allowed = [
    'alert_name', 'alert_type',
    'threshold_price_mwh', 'threshold_pct_change', 'threshold_timewindow_minutes',
    'threshold_carbon_g_kwh', 'threshold_renewable_pct',
    'delivery_method', 'email_address', 'webhook_url', 'webhook_secret',
    'cooldown_minutes', 'is_active'
  ];
  const sets  = [];
  const vals  = [];
  let   idx   = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k) && v !== undefined) {
      sets.push(`${k} = $${idx++}`);
      vals.push(v);
    }
  }
  if (!sets.length) return getAlert(alertId, customerId);

  vals.push(alertId, customerId);
  const { rows } = await query(
    `UPDATE price_alerts
     SET ${sets.join(', ')}
     WHERE id = $${idx++} AND customer_id = $${idx}
     RETURNING *`,
    vals
  );
  return rows[0] || null;
}

/**
 * Permanently delete an alert.
 * Returns true if the row existed and was deleted.
 */
async function deleteAlert(alertId, customerId) {
  const { rowCount } = await query(
    `DELETE FROM price_alerts
     WHERE id = $1 AND customer_id = $2`,
    [alertId, customerId]
  );
  return rowCount > 0;
}

// ── Engine queries ─────────────────────────────────────────────────────────────

/**
 * Fetch all active alerts for a given region (used by alertEngine).
 * Filters out alerts still in their cooldown window.
 */
async function getActiveAlertsForRegion(regionCode) {
  const { rows } = await query(
    `SELECT * FROM price_alerts
     WHERE region_code = $1
       AND is_active   = true
       AND (
         last_triggered_at IS NULL
         OR last_triggered_at < NOW() - (cooldown_minutes || ' minutes')::interval
       )`,
    [regionCode]
  );
  return rows;
}

/**
 * Mark an alert as triggered: bump trigger_count and update last_triggered_at.
 */
async function markAlertTriggered(alertId) {
  return query(
    `UPDATE price_alerts
     SET trigger_count    = trigger_count + 1,
         last_triggered_at = NOW()
     WHERE id = $1`,
    [alertId]
  );
}

/**
 * Insert a row into alert_history after delivery attempt.
 */
async function recordAlertHistory({
  alertId, regionCode, alertType,
  priceAtTrigger, priceBefore, pctChange,
  carbonAtTrigger, renewablePctAtTrigger,
  thresholdThatTriggered, deliveryMethod,
  delivered, deliveredAt, deliveryError, webhookResponseCode
}) {
  return query(
    `INSERT INTO alert_history
       (alert_id, region_code, triggered_at, alert_type,
        price_at_trigger, price_before, pct_change,
        carbon_at_trigger, renewable_pct_at_trigger,
        threshold_that_triggered, delivery_method,
        delivered, delivered_at, delivery_error, webhook_response_code)
     VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      alertId, regionCode, alertType,
      priceAtTrigger ?? null, priceBefore ?? null, pctChange ?? null,
      carbonAtTrigger ?? null, renewablePctAtTrigger ?? null,
      thresholdThatTriggered || null, deliveryMethod,
      delivered, deliveredAt || null, deliveryError || null, webhookResponseCode ?? null
    ]
  );
}

/**
 * Get the trigger history for a specific alert (most recent first).
 */
async function getAlertHistory(alertId, customerId, limit = 50) {
  // Join to verify ownership without leaking data across customers
  const { rows } = await query(
    `SELECT h.*
     FROM alert_history h
     JOIN price_alerts  a ON a.id = h.alert_id
     WHERE h.alert_id   = $1
       AND a.customer_id = $2
     ORDER BY h.triggered_at DESC
     LIMIT $3`,
    [alertId, customerId, limit]
  );
  return rows;
}

/**
 * Get all trigger history across ALL of a customer's alerts (most recent first).
 * Joins alert_history with price_alerts to include alert name, type, and region.
 * Ownership is enforced via the JOIN — no cross-customer data leakage possible.
 *
 * @param {number}  customerId
 * @param {number}  limit      — max rows to return
 * @param {object}  [filters]
 * @param {string}  [filters.region]  — filter to a specific region code
 * @param {number}  [filters.days]    — only include events from the last N days
 */
async function getAllCustomerAlertHistory(customerId, limit = 100, filters = {}) {
  const conditions = ['a.customer_id = $1'];
  const values     = [customerId];
  let   idx        = 2;

  if (filters.region) {
    conditions.push(`h.region_code = $${idx++}`);
    values.push(filters.region);
  }
  if (filters.days && Number.isFinite(filters.days) && filters.days > 0) {
    conditions.push(`h.triggered_at >= NOW() - ($${idx++} || ' days')::interval`);
    values.push(filters.days);
  }

  values.push(limit);

  const { rows } = await query(
    `SELECT
       h.id,
       h.alert_id,
       h.triggered_at,
       h.alert_type,
       h.region_code,
       h.price_at_trigger,
       h.carbon_at_trigger,
       h.renewable_pct_at_trigger,
       h.pct_change,
       h.threshold_that_triggered,
       h.delivery_method,
       h.delivered,
       h.delivered_at,
       h.delivery_error,
       a.alert_name
     FROM alert_history h
     JOIN price_alerts  a ON a.id = h.alert_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY h.triggered_at DESC
     LIMIT $${idx}`,
    values
  );
  return rows;
}

module.exports = {
  createAlert,
  listAlerts,
  getAlert,
  updateAlert,
  deleteAlert,
  getActiveAlertsForRegion,
  markAlertTriggered,
  recordAlertHistory,
  getAlertHistory,
  getAllCustomerAlertHistory
};
