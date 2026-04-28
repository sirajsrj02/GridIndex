'use strict';

/**
 * GET /api/v1/demand/latest         — most recent demand for one region
 * GET /api/v1/demand/latest/all     — most recent demand for every accessible region
 * GET /api/v1/demand                — historical demand series for one region
 *
 * All routes require the API key + region access middleware applied upstream.
 * Demand data is sourced from EIA hourly regional demand polls and stored in
 * the energy_prices table (demand_mw column).
 */

const { Router } = require('express');
const { requireRegionAccess } = require('../../middleware/auth');
const { getLatestDemand, getLatestDemandAll, getDemandHistory } = require('../../db/queries/prices');

const router = Router();

const VALID_REGIONS = ['CAISO', 'ERCOT', 'PJM', 'MISO', 'NYISO', 'ISONE', 'SPP', 'WECC'];
const MAX_LIMIT = 1000;

// ── GET /api/v1/demand/latest/all ─────────────────────────────────────────────
// Must be declared before /:region to avoid "latest" being treated as a region code

router.get('/latest/all', async (req, res) => {
  const start = Date.now();
  const allowedRegions = req.customer.allowed_regions || [];

  if (!allowedRegions.length) {
    return res.json({ success: true, count: 0, data: [], meta: { query_ms: 0 } });
  }

  try {
    const rows = await getLatestDemandAll(allowedRegions);
    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      count:   rows.length,
      data:    rows,
      meta:    { query_ms: Date.now() - start }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch demand data', code: 'DB_ERROR' });
  }
});

// ── GET /api/v1/demand/latest?region=CAISO ───────────────────────────────────

router.get('/latest', requireRegionAccess, async (req, res) => {
  const start  = Date.now();
  const region = req.query.region?.toUpperCase();

  if (!region || !VALID_REGIONS.includes(region)) {
    return res.status(400).json({
      success: false,
      error:   `region is required. Valid options: ${VALID_REGIONS.join(', ')}`,
      code:    'MISSING_REGION'
    });
  }

  try {
    const row = await getLatestDemand(region);
    if (!row) {
      return res.status(404).json({
        success: false,
        error:   `No demand data available for ${region} yet`,
        code:    'NOT_FOUND'
      });
    }
    res.locals.responseRows = 1;
    res.json({
      success: true,
      data:    row,
      meta:    { query_ms: Date.now() - start }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch demand data', code: 'DB_ERROR' });
  }
});

// ── GET /api/v1/demand?region=CAISO&start=...&end=...&limit=100 ──────────────

router.get('/', requireRegionAccess, async (req, res) => {
  const start  = Date.now();
  const region = req.query.region?.toUpperCase();

  if (!region || !VALID_REGIONS.includes(region)) {
    return res.status(400).json({
      success: false,
      error:   `region is required. Valid options: ${VALID_REGIONS.join(', ')}`,
      code:    'MISSING_REGION'
    });
  }

  const startTs = req.query.start ? new Date(req.query.start) : null;
  const endTs   = req.query.end   ? new Date(req.query.end)   : null;
  const limit   = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), MAX_LIMIT);

  if (startTs && isNaN(startTs.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid start date', code: 'INVALID_DATE' });
  }
  if (endTs && isNaN(endTs.getTime())) {
    return res.status(400).json({ success: false, error: 'Invalid end date', code: 'INVALID_DATE' });
  }

  try {
    const rows = await getDemandHistory({
      regionCode: region,
      start:      startTs || undefined,
      end:        endTs   || undefined,
      limit
    });
    res.locals.responseRows = rows.length;
    res.json({
      success: true,
      count:   rows.length,
      data:    rows,
      meta: {
        region,
        limit,
        start:    startTs?.toISOString() || null,
        end:      endTs?.toISOString()   || null,
        query_ms: Date.now() - start
      }
    });
  } catch (err) {
    res.locals.errorMessage = err.message;
    res.status(500).json({ success: false, error: 'Failed to fetch demand history', code: 'DB_ERROR' });
  }
});

module.exports = router;
