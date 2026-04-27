'use strict';

/**
 * Alert Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Called after each price/carbon/fuel-mix poll to evaluate whether any active
 * customer alerts should fire.
 *
 * Supported alert types:
 *   price_above     — spot price exceeds threshold_price_mwh
 *   price_below     — spot price falls below threshold_price_mwh
 *   pct_change      — price changed by ≥ threshold_pct_change % within
 *                     threshold_timewindow_minutes
 *   carbon_above    — carbon intensity exceeds threshold_carbon_g_kwh
 *   renewable_below — renewable % of generation falls below threshold_renewable_pct
 *
 * Delivery methods: email | webhook
 * Cooldown is enforced in the SQL query (getActiveAlertsForRegion) so the
 * engine never has to track state in memory.
 */

const logger = require('../config/logger').forJob('alertEngine');
const { query } = require('../config/database');
const {
  getActiveAlertsForRegion,
  markAlertTriggered,
  recordAlertHistory
} = require('../db/queries/alerts');
const { sendAlertEmail }   = require('../services/emailService');
const { sendAlertWebhook } = require('../services/webhookService');

// ── Data fetchers ─────────────────────────────────────────────────────────────

/**
 * Get the most-recent real-time price for a region.
 */
async function getLatestPrice(regionCode) {
  const { rows } = await query(
    `SELECT price_per_mwh, timestamp
     FROM energy_prices
     WHERE region_code = $1
       AND price_type  = 'real_time_hourly'
     ORDER BY timestamp DESC
     LIMIT 1`,
    [regionCode]
  );
  return rows[0] || null;
}

/**
 * Get the price from N minutes ago (used for pct_change evaluation).
 */
async function getPriceMinutesAgo(regionCode, minutes) {
  const { rows } = await query(
    `SELECT price_per_mwh
     FROM energy_prices
     WHERE region_code = $1
       AND price_type  = 'real_time_hourly'
       AND timestamp  <= NOW() - ($2 || ' minutes')::interval
     ORDER BY timestamp DESC
     LIMIT 1`,
    [regionCode, minutes]
  );
  return rows[0] || null;
}

/**
 * Get the latest carbon intensity row for a region.
 */
async function getLatestCarbon(regionCode) {
  const { rows } = await query(
    `SELECT carbon_intensity_g_kwh, renewable_pct, timestamp
     FROM carbon_intensity
     WHERE region_code = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [regionCode]
  );
  return rows[0] || null;
}

// ── Evaluators ────────────────────────────────────────────────────────────────

/**
 * Returns { triggered: bool, triggerData: object } for a single alert row.
 */
async function evaluate(alert, priceRow, carbonRow, prevPriceRow) {
  const type        = alert.alert_type;
  const price       = priceRow?.price_per_mwh != null ? parseFloat(priceRow.price_per_mwh) : null;
  const carbon      = carbonRow?.carbon_intensity_g_kwh != null ? parseFloat(carbonRow.carbon_intensity_g_kwh) : null;
  const renewable   = carbonRow?.renewable_pct != null ? parseFloat(carbonRow.renewable_pct) : null;
  const prevPrice   = prevPriceRow?.price_per_mwh != null ? parseFloat(prevPriceRow.price_per_mwh) : null;

  const base = {
    currentPrice:    price,
    threshold:       null,
    pctChange:       null,
    carbonIntensity: carbon,
    renewablePct:    renewable
  };

  switch (type) {
    case 'price_above': {
      const thr = parseFloat(alert.threshold_price_mwh);
      if (price == null || isNaN(thr)) return { triggered: false };
      if (price > thr) return { triggered: true, triggerData: { ...base, threshold: thr } };
      return { triggered: false };
    }

    case 'price_below': {
      const thr = parseFloat(alert.threshold_price_mwh);
      if (price == null || isNaN(thr)) return { triggered: false };
      if (price < thr) return { triggered: true, triggerData: { ...base, threshold: thr } };
      return { triggered: false };
    }

    case 'pct_change': {
      const thr = parseFloat(alert.threshold_pct_change);
      if (price == null || prevPrice == null || isNaN(thr) || prevPrice === 0) return { triggered: false };
      const pct = Math.abs(((price - prevPrice) / prevPrice) * 100);
      if (pct >= thr) return { triggered: true, triggerData: { ...base, pctChange: parseFloat(pct.toFixed(4)) } };
      return { triggered: false };
    }

    case 'carbon_above': {
      const thr = parseFloat(alert.threshold_carbon_g_kwh);
      if (carbon == null || isNaN(thr)) return { triggered: false };
      if (carbon > thr) return { triggered: true, triggerData: { ...base, threshold: thr } };
      return { triggered: false };
    }

    case 'renewable_below': {
      const thr = parseFloat(alert.threshold_renewable_pct);
      if (renewable == null || isNaN(thr)) return { triggered: false };
      if (renewable < thr) return { triggered: true, triggerData: { ...base, threshold: thr } };
      return { triggered: false };
    }

    default:
      logger.warn(`Unknown alert type: ${type}`, { alertId: alert.id });
      return { triggered: false };
  }
}

// ── Delivery ──────────────────────────────────────────────────────────────────

async function deliver(alert, triggerData) {
  const method = alert.delivery_method;
  let delivered        = false;
  let deliveredAt      = null;
  let deliveryError    = null;
  let webhookStatus    = null;

  try {
    if (method === 'email') {
      await sendAlertEmail({
        email:        alert.email_address,
        alertName:    alert.alert_name,
        region:       alert.region_code,
        alertType:    alert.alert_type,
        currentPrice: triggerData.currentPrice,
        threshold:    triggerData.threshold,
        pctChange:    triggerData.pctChange,
        triggeredAt:  new Date().toISOString()
      });
      delivered   = true;
      deliveredAt = new Date();

    } else if (method === 'webhook') {
      const result = await sendAlertWebhook(alert, triggerData);
      delivered      = result.delivered;
      webhookStatus  = result.statusCode;
      deliveredAt    = result.delivered ? new Date() : null;
      deliveryError  = result.error;

    } else {
      deliveryError = `Unknown delivery method: ${method}`;
      logger.warn(deliveryError, { alertId: alert.id });
    }
  } catch (err) {
    deliveryError = err.message;
    logger.error('Alert delivery threw', { alertId: alert.id, error: err.message });
  }

  return { delivered, deliveredAt, deliveryError, webhookStatus };
}

// ── Main run ──────────────────────────────────────────────────────────────────

/**
 * Evaluate all active alerts for a specific region.
 * Called by the scheduler immediately after each price poll completes.
 *
 * @param {string} regionCode — e.g. 'CAISO'
 * @returns {number} count of alerts that fired
 */
async function runForRegion(regionCode) {
  const alerts = await getActiveAlertsForRegion(regionCode);
  if (!alerts.length) return 0;

  // Fetch current data once and share across all alerts for this region
  const [priceRow, carbonRow] = await Promise.all([
    getLatestPrice(regionCode),
    getLatestCarbon(regionCode)
  ]);

  let fired = 0;

  for (const alert of alerts) {
    try {
      // For pct_change we need the historical price; skip the extra query otherwise
      const prevPriceRow = alert.alert_type === 'pct_change'
        ? await getPriceMinutesAgo(regionCode, alert.threshold_timewindow_minutes || 5)
        : null;

      const { triggered, triggerData } = await evaluate(alert, priceRow, carbonRow, prevPriceRow);
      if (!triggered) continue;

      fired++;
      logger.info(`Alert triggered`, {
        alertId:   alert.id,
        alertType: alert.alert_type,
        region:    regionCode
      });

      // Deliver and record — both happen even if delivery fails
      const { delivered, deliveredAt, deliveryError, webhookStatus } = await deliver(alert, triggerData);

      await Promise.all([
        markAlertTriggered(alert.id),
        recordAlertHistory({
          alertId:                alert.id,
          regionCode,
          alertType:              alert.alert_type,
          priceAtTrigger:         triggerData.currentPrice,
          priceBefore:            triggerData.pctChange != null ? prevPriceRow?.price_per_mwh : null,
          pctChange:              triggerData.pctChange,
          carbonAtTrigger:        triggerData.carbonIntensity,
          renewablePctAtTrigger:  triggerData.renewablePct,
          thresholdThatTriggered: JSON.stringify({
            type:      alert.alert_type,
            threshold: triggerData.threshold ?? triggerData.pctChange
          }),
          deliveryMethod:     alert.delivery_method,
          delivered,
          deliveredAt,
          deliveryError,
          webhookResponseCode: webhookStatus
        })
      ]);

    } catch (err) {
      // One broken alert never stops the others
      logger.error('Alert evaluation failed', { alertId: alert.id, error: err.message });
    }
  }

  return fired;
}

/**
 * Run alert evaluation for all 8 tracked regions.
 * Runs them sequentially to avoid hammering the DB with parallel queries.
 */
const ALL_REGIONS = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];

async function run() {
  logger.info('=== Alert engine starting ===');
  let total = 0;
  for (const region of ALL_REGIONS) {
    try {
      const fired = await runForRegion(region);
      if (fired) logger.info(`${fired} alert(s) fired for ${region}`);
      total += fired;
    } catch (err) {
      logger.error(`Alert engine failed for ${region}`, { error: err.message });
    }
  }
  logger.info(`=== Alert engine complete — ${total} total alert(s) fired ===`);
  return total;
}

if (require.main === module) {
  run()
    .then((n) => { console.log(`Done: ${n} alerts fired`); process.exit(0); })
    .catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
}

module.exports = { run, runForRegion, evaluate };
