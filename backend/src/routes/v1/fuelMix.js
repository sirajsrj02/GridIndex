'use strict';

const { Router } = require('express');
const { query } = require('../../config/database');
const { requireRegionAccess } = require('../../middleware/auth');

const router = Router();

const VALID_REGIONS = ['CAISO','ERCOT','PJM','MISO','NYISO','ISONE','SPP','WECC'];
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
 * GET /api/v1/fuel-mix/latest?region=CAISO
 * Most recent fuel mix snapshot for a region.
 */
router.get('/latest', requireRegionAccess, async (req, res) => {
  const start = Date.now();
  const { region } = req.query;

  if (!validateRegion(region, res)) return;

  try {
    const { rows } = await query(
      `SELECT region_code, timestamp,
              natural_gas_mw, natural_gas_pct,
              coal_mw, coal_pct,
              nuclear_mw, nuclear_pct,
              wind_mw, wind_pct,
              solar_mw, solar_pct,
              hydro_mw, hydro_pct,
              battery_storage_mw, battery_storage_pct,
              petroleum_mw, petroleum_pct,
              other_renewables_mw, other_renewables_pct,
              other_mw, other_pct,
              total_generation_mw, renewable_total_pct, clean_total_pct, source
       FROM fuel_mix
       WHERE region_code = $1
       ORDER BY timestamp DESC
       LIMIT 1`,
      [region]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: `No fuel mix data found for ${region}`, code: 'NOT_FOUND' });
    }

    res.locals.responseRows = 1;
    res.json({
      success: true,
      data: rows[0],
      meta: { region, query_ms: Date.now() - start }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch fuel mix data', code: 'DB_ERROR' });
  }
});

/**
 * GET /api/v1/fuel-mix?region=CAISO&start=2025-04-24&end=2025-04-25&limit=24
 * Historical fuel mix series.
 */
router.get('/', requireRegionAccess, async (req, res) => {
  const start = Date.now();
  const { region, limit = 24 } = req.query;
  const startTs = req.query.start;
  const endTs = req.query.end;

  if (!validateRegion(region, res)) return;

  const rowLimit = Math.min(parseInt(limit) || 24, MAX_LIMIT);
  const historyDays = req.customer.history_days_allowed || 7;
  const earliestAllowed = new Date(Date.now() - historyDays * 24 * 3600 * 1000);

  const parsedStart = startTs ? new Date(startTs) : earliestAllowed;
  const parsedEnd = endTs ? new Date(endTs) : new Date();

  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid start or end date', code: 'INVALID_DATE' });
  }

  const clampedStart = parsedStart < earliestAllowed ? earliestAllowed : parsedStart;

  try {
    const { rows } = await query(
      `SELECT region_code, timestamp,
              natural_gas_mw, natural_gas_pct,
              coal_mw, coal_pct,
              nuclear_mw, nuclear_pct,
              wind_mw, wind_pct,
              solar_mw, solar_pct,
              hydro_mw, hydro_pct,
              battery_storage_mw, battery_storage_pct,
              petroleum_mw, petroleum_pct,
              other_renewables_mw, other_renewables_pct,
              other_mw, other_pct,
              total_generation_mw, renewable_total_pct, clean_total_pct, source
       FROM fuel_mix
       WHERE region_code = $1
         AND timestamp  >= $2
         AND timestamp  <= $3
       ORDER BY timestamp DESC
       LIMIT $4`,
      [region, clampedStart, parsedEnd, rowLimit]
    );

    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      data: rows,
      meta: {
        region,
        count: rows.length,
        start: clampedStart,
        end: parsedEnd,
        history_days_allowed: historyDays,
        query_ms: Date.now() - start
      }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch fuel mix data', code: 'DB_ERROR' });
  }
});

module.exports = router;
