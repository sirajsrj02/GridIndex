'use strict';

const { Router } = require('express');
const { query } = require('../../config/database');
const { requireRegionAccess } = require('../../middleware/auth');

const router = Router();

const VALID_REGIONS = ['CAISO','ERCOT','PJM','MISO','NYISO','ISONE','SPP','WECC'];
const VALID_PRICE_TYPES = ['real_time_hourly','day_ahead_hourly','monthly_retail'];
const MAX_LIMIT = 500;

function validateRegion(region, res) {
  if (!region) {
    res.status(400).json({ success: false, error: 'region query parameter is required', code: 'MISSING_REGION' });
    return false;
  }
  if (!VALID_REGIONS.includes(region)) {
    res.status(400).json({ success: false, error: `Invalid region. Valid options: ${VALID_REGIONS.join(', ')}`, code: 'INVALID_REGION' });
    return false;
  }
  return true;
}

/**
 * GET /api/v1/prices/latest/all
 * Most recent price row for every region the customer has access to,
 * returned in a single request as a map keyed by region_code.
 * Counts as 1 API call regardless of how many regions are returned.
 */
router.get('/latest/all', async (req, res) => {
  const start = Date.now();
  const allowedRegions = req.customer.allowed_regions || [];

  if (!allowedRegions.length) {
    return res.json({ success: true, data: {}, meta: { count: 0, query_ms: 0 } });
  }

  try {
    // DISTINCT ON guarantees one row per region — the most recent by timestamp
    const placeholders = allowedRegions.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await query(
      `SELECT DISTINCT ON (region_code)
         region_code, timestamp, price_per_mwh, price_day_ahead_mwh,
         price_type, demand_mw, net_generation_mw, interchange_mw, source
       FROM energy_prices
       WHERE region_code IN (${placeholders})
         AND price_type = 'real_time_hourly'
       ORDER BY region_code, timestamp DESC`,
      allowedRegions
    );

    // Shape into a map: { CAISO: {...}, ERCOT: {...}, ... }
    const dataMap = {};
    for (const row of rows) {
      dataMap[row.region_code] = row;
    }

    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      data: dataMap,
      meta: { count: rows.length, regions: allowedRegions, query_ms: Date.now() - start }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch price data', code: 'DB_ERROR' });
  }
});

/**
 * GET /api/v1/prices/latest?region=CAISO&type=real_time_hourly
 * Most recent price row for a region.
 */
router.get('/latest', requireRegionAccess, async (req, res) => {
  const start = Date.now();
  const { region, type = 'real_time_hourly' } = req.query;

  if (!validateRegion(region, res)) return;

  try {
    const { rows } = await query(
      `SELECT region_code, timestamp, price_per_mwh, price_day_ahead_mwh,
              price_type, pricing_node, demand_mw, net_generation_mw,
              interchange_mw, source
       FROM energy_prices
       WHERE region_code = $1 AND price_type = $2
       ORDER BY timestamp DESC
       LIMIT 1`,
      [region, type]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: `No data found for ${region}`, code: 'NOT_FOUND' });
    }

    res.locals.responseRows = 1;
    res.json({
      success: true,
      data: rows[0],
      meta: { region, price_type: type, query_ms: Date.now() - start }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch price data', code: 'DB_ERROR' });
  }
});

/**
 * GET /api/v1/prices?region=CAISO&type=real_time_hourly&start=2025-04-24&end=2025-04-25&limit=24
 * Historical price series for a region.
 */
router.get('/', requireRegionAccess, async (req, res) => {
  const start = Date.now();
  const { region, type = 'real_time_hourly', limit = 24 } = req.query;
  const startTs = req.query.start;
  const endTs = req.query.end;

  if (!validateRegion(region, res)) return;

  if (!VALID_PRICE_TYPES.includes(type)) {
    return res.status(400).json({ success: false, error: `Invalid type. Valid options: ${VALID_PRICE_TYPES.join(', ')}`, code: 'INVALID_TYPE' });
  }

  const rowLimit = Math.min(parseInt(limit) || 24, MAX_LIMIT);

  // Enforce history window based on customer plan
  const historyDays = req.customer.history_days_allowed || 7;
  const earliestAllowed = new Date(Date.now() - historyDays * 24 * 3600 * 1000);

  const parsedStart = startTs ? new Date(startTs) : earliestAllowed;
  const parsedEnd = endTs ? new Date(endTs) : new Date();

  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid start or end date', code: 'INVALID_DATE' });
  }

  // Clamp to history window
  const clampedStart = parsedStart < earliestAllowed ? earliestAllowed : parsedStart;

  try {
    const { rows } = await query(
      `SELECT region_code, timestamp, price_per_mwh, price_day_ahead_mwh,
              price_type, pricing_node, demand_mw, net_generation_mw,
              interchange_mw, source
       FROM energy_prices
       WHERE region_code = $1
         AND price_type  = $2
         AND timestamp  >= $3
         AND timestamp  <= $4
       ORDER BY timestamp DESC
       LIMIT $5`,
      [region, type, clampedStart, parsedEnd, rowLimit]
    );

    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      data: rows,
      meta: {
        region,
        price_type: type,
        count: rows.length,
        start: clampedStart,
        end: parsedEnd,
        history_days_allowed: historyDays,
        query_ms: Date.now() - start
      }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch price data', code: 'DB_ERROR' });
  }
});

module.exports = router;
